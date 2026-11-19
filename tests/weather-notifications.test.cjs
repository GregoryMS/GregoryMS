const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cryptoNode = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const workerPath = '../workers/weather-notifications/worker.mjs';
const loc = {name:'Victoria', latitude:48.421, longitude:-123.393, country:'CA', timezone:'America/Vancouver', id:'bc-75'};
const prefs = {weatherNotifyEnabled:true, weatherNotifySunrise:false, weatherSunriseLead:15, weatherNotifySunset:false, weatherSunsetLead:15, weatherNotifyRain:false, weatherNotifyWarnings:true};
async function setup() {
  const sql = new DatabaseSync(':memory:'); sql.exec(fs.readFileSync(path.join(__dirname,'../workers/weather-notifications/schema.sql'),'utf8'));
  const DB = {
    prepare(query) {
      let params = [];
      const statement = {
        bind(...values) { params = values; return statement; },
        async run() { const r=sql.prepare(query).run(...params); return {meta:{changes:Number(r.changes)}}; },
        async all() { return {results:sql.prepare(query).all(...params)}; },
        async first() { return sql.prepare(query).get(...params) || null; },
      }; return statement;
    },
    batch(statements) { return Promise.all(statements.map(s=>s.run())); },
  };
  const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey = await crypto.subtle.exportKey('jwk',pair.privateKey);
  const push = await import('../workers/weather-notifications/webpush.mjs');
  const VAPID_PUBLIC = push.encode(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)));
  const receiver = cryptoNode.createECDH('prime256v1'); receiver.generateKeys();
  const sub = {endpoint:'https://fcm.googleapis.com/fcm/send/test-gregle-weather', keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:cryptoNode.randomBytes(16).toString('base64url')}};
  return {sql, env:{DB,VAPID_PUBLIC,VAPID_PRIVATE:JSON.stringify(privateKey)}, pair, receiver, sub};
}
function request(route, data, origin='https://weather.gregle.uk') { return new Request('https://push.example'+route, {method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)}); }

test('push payload independently decrypts and VAPID signature verifies', async () => {
  const {env,receiver,sub,pair} = await setup();
  const {pushRequest} = await import('../workers/weather-notifications/webpush.mjs');
  const message = {title:'Rain expected soon',body:'Victoria: about 10–25 minutes.'};
  const req = await pushRequest(env,{endpoint:sub.endpoint,...sub.keys},message);
  const body = Buffer.from(await req.arrayBuffer()), salt=body.subarray(0,16), publicKey=body.subarray(21,86), cipher=body.subarray(86);
  assert.equal(body.readUInt32BE(16),4096); assert.equal(body[20],65);
  const shared=receiver.computeSecret(publicKey);
  const hkdf=(key,salt,info,n)=>Buffer.from(cryptoNode.hkdfSync('sha256',key,salt,info,n));
  const ikm=hkdf(shared,Buffer.from(sub.keys.auth,'base64url'),Buffer.concat([Buffer.from('WebPush: info\0'),receiver.getPublicKey(),publicKey]),32);
  const aes=hkdf(ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16), nonce=hkdf(ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
  const decipher=cryptoNode.createDecipheriv('aes-128-gcm',aes,nonce); decipher.setAuthTag(cipher.subarray(-16));
  const decoded=Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]);
  assert.equal(decoded.at(-1),2); assert.deepEqual(JSON.parse(decoded.subarray(0,-1).toString()),message);
  const auth=req.headers.get('Authorization').match(/^vapid t=([^,]+), k=(.+)$/);
  const [head,claims,signature]=auth[1].split('.'); assert.equal(auth[2],env.VAPID_PUBLIC);
  assert.equal(JSON.parse(Buffer.from(claims,'base64url')).aud,'https://fcm.googleapis.com');
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(signature,'base64url'),Buffer.from(head+'.'+claims)),true);
});

test('subscription lifecycle saves preferences and protects deletion with the device auth key', async () => {
  const {env,sql,sub}=await setup(), {default:worker}=await import(workerPath);
  assert.equal((await worker.fetch(request('/subscribe',{subscription:sub,preferences:prefs,location:loc}),env)).status,200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,1);
  const wrong={...sub,keys:{...sub.keys,auth:cryptoNode.randomBytes(16).toString('base64url')}};
  assert.equal((await worker.fetch(request('/subscribe',{subscription:wrong,preferences:prefs,location:loc}),env)).status,403);
  await worker.fetch(request('/unsubscribe',{subscription:wrong}),env);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,1);
  await worker.fetch(request('/unsubscribe',{subscription:sub}),env);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,0);
});

test('invalid locations, push endpoints and foreign origins are rejected', async () => {
  const {env,sub}=await setup(), {default:worker}=await import(workerPath);
  for (const endpoint of ['https://localhost/push','https://fcm.googleapis.com.evil.example/push','https://fcm.googleapis.com:8443/push','http://fcm.googleapis.com/push']) {
    assert.equal((await worker.fetch(request('/subscribe',{subscription:{...sub,endpoint},location:loc}),env)).status,400);
  }
  assert.equal((await worker.fetch(request('/subscribe',{subscription:sub,location:{...loc,latitude:999}}),env)).status,400);
  assert.equal((await worker.fetch(request('/subscribe',{subscription:sub,location:loc},'https://evil.example'),env)).status,403);
  const config=await (await worker.fetch(new Request('https://push.example/public-key'),env)).json();
  assert.equal(config.ready,true); assert.equal('VAPID_PRIVATE' in config,false);
});

test('sunrise scheduling handles Victoria longitude and delivery window without early alerts', async () => {
  const {sunEvents}=await import(workerPath);
  const SunCalc=require('../assets/vendor/suncalc.js');
  const sunrise=SunCalc.getTimes(new Date('2026-11-19T12:00Z'),loc.latitude,loc.longitude).sunrise.getTime();
  assert.ok(sunrise>Date.parse('2026-11-19T15:20Z') && sunrise<Date.parse('2026-11-19T15:40Z'));
  const p={...prefs,weatherNotifySunrise:true};
  assert.equal(sunEvents(loc,p,sunrise-16*60000).length,0);
  assert.equal(sunEvents(loc,p,sunrise-14*60000).length,1);
  assert.equal(sunEvents(loc,p,sunrise-8*60000).length,0);
  const polar={...loc,latitude:89}; assert.equal(sunEvents(polar,p,Date.parse('2026-12-19T12:00Z')).length,0);
});

test('rain transitions report a forecast interval and ignore ongoing rain or null data', async () => {
  const {rainEvent,rainModel,weatherURL}=await import(workerPath);
  const now=Date.parse('2026-11-19T16:00Z'), t=now/1000;
  const data={minutely_15:{time:[t,t+900,t+1800,t+2700],rain:[0,0,.2,.3]}};
  assert.match(rainEvent(data,loc,now,true).body,/15–30 minutes \(15-minute forecast\)/);
  data.minutely_15.rain=[.2,.2,.2,.3]; assert.equal(rainEvent(data,loc,now,true),null);
  data.minutely_15.rain=[0,null,.2,.3]; assert.equal(rainEvent(data,loc,now,true),null);
  assert.equal(rainModel(loc),'ncep_rrfs_conus'); assert.equal(rainModel({...loc,latitude:59,longitude:10}),null);
  const linked=require('../assets/tide-core.js').locationFromURL(weatherURL(loc));
  assert.equal(linked.timezone,loc.timezone); assert.equal(linked.latitude,loc.latitude);
});

test('warning delivery deduplicates cron overlaps and reports a withdrawn warning once', async () => {
  const {env,sub}=await setup(), {default:worker,tick}=await import(workerPath);
  await worker.fetch(request('/subscribe',{subscription:sub,preferences:prefs,location:loc}),env);
  const now=Date.now(); let active=true, sends=0;
  const original=global.fetch;
  global.fetch=async input=>{
    if (input instanceof Request) { sends++; return new Response(null,{status:201}); }
    return Response.json({properties:{lastUpdated:new Date().toISOString(),warnings:active?[{type:'warning',description:'Rainfall warning',eventIssue:new Date(now-60000).toISOString(),expiryTime:new Date(now+3600000).toISOString(),url:'https://weather.gc.ca/'}]:[]}});
  };
  try {
    await tick(env,now); await tick(env,now+1000); assert.equal(sends,1);
    active=false; await tick(env,now+300000); await tick(env,now+301000); assert.equal(sends,2);
    const health=await (await worker.fetch(new Request('https://push.example/health'),env)).json();
    assert.equal(health.lastCheck.failures,0); assert.equal(health.lastCheck.checked,1);
  } finally { global.fetch=original; }
});

test('expired push subscriptions are removed; failed sends remain retryable', async () => {
  const {env,sql,sub}=await setup(), {default:worker}=await import(workerPath);
  await worker.fetch(request('/subscribe',{subscription:sub,preferences:prefs,location:loc}),env);
  const original=global.fetch; let code=503;
  global.fetch=async()=>new Response(null,{status:code});
  try {
    assert.equal((await worker.fetch(request('/test',{subscription:sub}),env)).status,503);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n,0);
    code=410;
    assert.equal((await worker.fetch(request('/test',{subscription:sub}),env)).status,410);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,0);
  } finally { global.fetch=original; }
});

const vm = require('node:vm');
function settingsPage({ios=false, granted=false}={}) {
  const ids=['weatherSettingsPanel','weatherSettingsTrigger','weatherSettingsClose','weatherSettingsTitle','weatherPushStatus','weatherNotifyLocationStatus','weatherPushRetry','weatherPushTest','gregleAppMenu','weatherNotifyEnabled','weatherNotifyCity','weatherNotifySunrise','weatherSunriseLead','weatherNotifySunset','weatherSunsetLead','weatherNotifyRain','weatherNotifyWarnings'];
  const nodes=Object.fromEntries(ids.map(id=>[id,{id,hidden:id==='weatherSettingsPanel',type:/weatherNotify(Enabled|Sunrise|Sunset|Rain|Warnings)$/.test(id)?'checkbox':'select',value:'',listeners:{},style:{setProperty(){}},setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.listeners[name]=fn;},contains(target){return target===this;},focus(){},getBoundingClientRect(){return {bottom:60};}}]));
  const events={},requests=[],permissions=[]; let sub=null, gesture=false;
  const publicKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url');
  const Notification={permission:granted?'granted':'default',requestPermission(){permissions.push(gesture); Notification.permission='granted';return Promise.resolve('granted');}};
  const manager={async getSubscription(){return sub;},async subscribe(){sub={options:{applicationServerKey:Buffer.from(publicKey,'base64url')},toJSON(){return {endpoint:'https://fcm.googleapis.com/fake',keys:{p256dh:'test',auth:'test'}};},async unsubscribe(){sub=null;return true;}};return sub;}};
  const window={isSecureContext:true,PushManager:{},Notification,matchMedia(){return {matches:false};},addEventListener(name,fn){events[name]=fn;},GregleWeatherSelectedLocation:loc};
  const document={readyState:'complete',getElementById(id){return nodes[id];},addEventListener(){}};
  const context={window,globalThis:window,document,navigator:{userAgent:ios?'iPhone':'Chrome',platform:ios?'iPhone':'Linux',serviceWorker:{async register(){},ready:Promise.resolve({pushManager:manager})}},Notification,localStorage:{getItem(){return null;},setItem(){}},fetch:async(url,options)=>{requests.push({url,data:options.body?JSON.parse(options.body):null});return Response.json({ready:true,publicKey,ok:true});},AbortSignal,setTimeout,clearTimeout,atob,Uint8Array};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/weather-notification-settings.js'),'utf8'),context);
  return {nodes,events,requests,permissions,window,async change(id,value){gesture=true;if(nodes[id].type==='checkbox')nodes[id].checked=value;else nodes[id].value=value;nodes[id].listeners.change();gesture=false;await new Promise(resolve=>setImmediate(resolve));},async flush(){await new Promise(resolve=>setImmediate(resolve));}};
}

test('settings requests permission in the enabling gesture, syncs selected cities, and unregisters when disabled', async () => {
  const page=settingsPage(); await page.flush();
  await page.change('weatherNotifyEnabled',true);
  assert.deepEqual(page.permissions,[true]);
  const subscribed=page.requests.find(r=>r.url.endsWith('/subscribe')); assert.equal(subscribed.data.location.name,'Victoria');
  page.window.GregleWeatherNotifications.setLocation({...loc,name:'Vancouver',latitude:49.24,longitude:-123.12}); await page.flush();
  assert.equal(page.requests.filter(r=>r.url.endsWith('/subscribe')).at(-1).data.location.name,'Vancouver');
  await page.change('weatherNotifyEnabled',false);
  assert.ok(page.requests.some(r=>r.url.endsWith('/unsubscribe')));
  assert.match(page.nodes.weatherPushStatus.textContent,/Notifications are off/);
});

test('iPhone browser explains Home Screen installation without requesting permission', async () => {
  const page=settingsPage({ios:true}); await page.flush(); await page.change('weatherNotifyEnabled',true);
  assert.equal(page.permissions.length,0); assert.equal(page.requests.length,0);
  assert.equal(page.nodes.weatherNotifyEnabled.checked,false);
  assert.match(page.nodes.weatherPushStatus.textContent,/Home Screen/);
});
