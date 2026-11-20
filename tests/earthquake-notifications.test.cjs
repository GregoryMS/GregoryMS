const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cryptoNode = require('node:crypto');
const vm = require('node:vm');
const {DatabaseSync} = require('node:sqlite');
const modulePath = '../workers/weather-notifications/earthquakes.mjs';
const basePrefs = {quakeNotifyEnabled:true,quakeNotifyRegional:true,quakeRegionalMagnitude:3,quakeNotifyWorldwide:true,quakeWorldwideMagnitude:6,quakeNotifyTsunami:true};
async function setup() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['schema.sql','earthquakes-schema.sql']) sql.exec(fs.readFileSync(path.join(__dirname,'../workers/weather-notifications',name),'utf8'));
  const DB={prepare(query){let params=[];const statement={bind(...values){params=values;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...params).changes)}};},async all(){return {results:sql.prepare(query).all(...params)};},async first(){return sql.prepare(query).get(...params)||null;}};return statement;},batch(statements){return Promise.all(statements.map(s=>s.run()));}};
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey);
  const receiver=cryptoNode.createECDH('prime256v1');receiver.generateKeys();
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test-gregle-earthquakes',keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:cryptoNode.randomBytes(16).toString('base64url')}};
  return {sql,sub,env:{DB,VAPID_PRIVATE:JSON.stringify(privateKey),VAPID_PUBLIC:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url')}};
}
function request(route,data,origin='https://earthquakes.gregle.uk') {return new Request('https://push.example/earthquakes'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});}
const bulletin=(kind='Warning',product='PHEBWEPA40')=>({TWCID:product.slice(0,4),WMOID:product.slice(4),bulletinIssueTime:'2026-11-19T12:00:00Z',eventDir:'/events/test/',quakeLocation:'Pacific',alerts:{areaList:[[{category:kind,headline:'Affected coast'}]]}});

test('regional and worldwide thresholds independently match, with one event for overlapping regions',async()=>{
  const {earthquakeEvents,preferences,inRegional}=await import(modulePath),now=Date.now(),event={id:'bc',magnitude:3,latitude:49,longitude:-126,time:now,place:'Offshore BC',url:'https://earthquake.usgs.gov/earthquakes/eventpage/bc'};
  const events=[event,{...event,id:'world',latitude:-40,longitude:170,magnitude:6}];
  assert.equal(inRegional(event),true);assert.equal(inRegional({...event,longitude:170}),false);
  assert.deepEqual(earthquakeEvents(events,basePrefs,now-1,now).map(e=>e.id),['quake:bc','quake:world']);
  assert.equal(earthquakeEvents([{...event,magnitude:7}],basePrefs,now-1,now).length,1);
  assert.equal(earthquakeEvents(events,{...basePrefs,quakeNotifyRegional:false},now-1,now).length,1);
  assert.equal(earthquakeEvents(events,{...basePrefs,quakeNotifyWorldwide:false},now-1,now).length,1);
  assert.equal(earthquakeEvents(events,{...basePrefs,quakeNotifyEnabled:false},now-1,now).length,0);
  assert.equal(earthquakeEvents(events,basePrefs,now+1,now).length,0);
  assert.equal(earthquakeEvents([{...event,time:now+120000}],basePrefs,now-1,now).length,0);
  for(const value of [0,9.5,NaN,3.2,'no'])assert.throws(()=>preferences({quakeRegionalMagnitude:value}));
  assert.equal(preferences({quakeRegionalMagnitude:'4.5'}).quakeRegionalMagnitude,4.5);
});
test('NOAA data assignments are parsed without executing code; tsunami alerts ignore quake thresholds',async()=>{
  const {parseBulletinScript,tsunamiEvents}=await import(modulePath);
  const script='// Generated bulletin\nvar PHEBWEPA40 = '+JSON.stringify(bulletin())+';\n';
  const active=parseBulletinScript(script,'PHEBWEPA40');
  assert.equal(tsunamiEvents([active],{...basePrefs,quakeNotifyRegional:false,quakeNotifyWorldwide:false}).length,1);
  assert.equal(tsunamiEvents([active],{...basePrefs,quakeNotifyTsunami:false}).length,0);
  const numeric = JSON.stringify({...bulletin(),eventLat:28,quakeLocation:'Text 28. stays literal'}).replace('\"eventLat\":28','\"eventLat\":28.');
  const parsed = parseBulletinScript('var PHEBWEPA40 = '+numeric+';','PHEBWEPA40');
  assert.equal(parsed.latitude,28);assert.equal(parsed.place,'Text 28. stays literal');
  assert.equal(tsunamiEvents([parseBulletinScript('var PHEBWEPA40 = '+JSON.stringify(bulletin('Cancellation'))+';','PHEBWEPA40')],basePrefs).length,0);
  for(const bad of ['alert(1);'+script,script+'fetch("https://evil.example")','var PHEBWEPA40 = (()=>({}))();'])assert.throws(()=>parseBulletinScript(bad,'PHEBWEPA40'));
});
test('subscription routes validate origin and auth, preserve activation date, and remove disabled devices',async()=>{
  const {env,sub,sql}=await setup(),{default:worker}=await import('../workers/weather-notifications/worker.mjs');
  assert.equal((await worker.fetch(request('/subscribe',{subscription:sub,preferences:basePrefs}),env)).status,200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,0);
  const started=sql.prepare('SELECT started_at FROM quake_subscriptions').get().started_at;
  assert.equal((await worker.fetch(request('/subscribe',{subscription:sub,preferences:{...basePrefs,quakeRegionalMagnitude:4}}),env)).status,200);
  assert.equal(sql.prepare('SELECT started_at FROM quake_subscriptions').get().started_at,started);
  assert.equal((await worker.fetch(request('/subscribe',{subscription:sub,preferences:basePrefs},'https://evil.example'),env)).status,403);
  const wrong={...sub,keys:{...sub.keys,auth:cryptoNode.randomBytes(16).toString('base64url')}};
  assert.equal((await worker.fetch(request('/subscribe',{subscription:wrong,preferences:basePrefs}),env)).status,403);
  await worker.fetch(request('/unsubscribe',{subscription:wrong}),env);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM quake_subscriptions').get().n,1);
  await worker.fetch(request('/subscribe',{subscription:sub,preferences:{...basePrefs,quakeNotifyEnabled:false}}),env);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM quake_subscriptions').get().n,0);
});
test('background checks deduplicate earthquake alerts, retry delivery failures, and remove expired devices',async()=>{
  const {env,sub,sql}=await setup(),{default:worker,tick}=await import(modulePath),now=Date.now();
  await worker.fetch(request('/subscribe',{subscription:sub,preferences:basePrefs}),env);
  sql.prepare('UPDATE quake_subscriptions SET started_at=?').run(now-60000);
  const native=global.fetch;let pushes=0,status=201;
  global.fetch=async(url,options)=>{
    if(url instanceof Request){pushes++;return new Response(null,{status});}
    if(url.includes('earthquake.usgs.gov'))return Response.json({type:'FeatureCollection',metadata:{generated:now},features:[{id:'bc',geometry:{type:'Point',coordinates:[-126,49,10]},properties:{mag:7,time:now-1000,place:'BC',type:'earthquake'}}]});
    assert.match(options.headers['User-Agent'],/GregleEarthquakeNotifications/);
    const product=url.match(/([A-Z0-9]+)\.js$/)[1];return new Response('var '+product+' = '+JSON.stringify(bulletin('Information',product))+';');
  };
  try {
    status=503;await tick(env,now);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM quake_deliveries').get().n,0);
    status=201;await tick(env,now);await tick(env,now);assert.equal(pushes,2);
    const health=JSON.parse(sql.prepare("SELECT value FROM service_state WHERE key='earthquake_check'").get().value);assert.equal(health.tsunamiProducts,15);assert.equal(health.failures,0);
    sql.prepare('DELETE FROM quake_deliveries').run();status=410;await tick(env,now);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM quake_subscriptions').get().n,0);
  } finally {global.fetch=native;}
});
function settingsPage({ios=false, granted=false, installed=false, savedEnabled=false, failFirst=false, failTest=false}={}) {
  const ids=['quakeSettingsPanel','quakeSettingsTrigger','quakeSettingsClose','quakeSettingsTitle','quakePushStatus','quakePushActionStatus','quakePushEnable','quakePushRetry','quakePushTest','gregleAppMenu','quakeNotifyEnabled','quakeNotifyRegional','quakeRegionalMagnitude','quakeNotifyWorldwide','quakeWorldwideMagnitude','quakeNotifyTsunami'];
  const nodes=Object.fromEntries(ids.map(id=>[id,{id,hidden:['quakeSettingsPanel','quakePushRetry'].includes(id),type:/quakeNotify(Enabled|Regional|Worldwide|Tsunami)$/.test(id)?'checkbox':'select',value:'',listeners:{},style:{setProperty(){}},setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.listeners[name]=fn;},contains(target){return target===this;},focus(){},getBoundingClientRect(){return {bottom:60};}}]));
  const events={},requests=[],permissions=[]; let sub=null, gesture=false, attempts=0;
  const publicKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url');
  const Notification={permission:granted?'granted':'default',requestPermission(){permissions.push(gesture); Notification.permission='granted';return Promise.resolve('granted');}};
  const manager={async getSubscription(){return sub;},async subscribe(){permissions.push(gesture);if(!gesture)throw Error('subscribe requires a user gesture');if(failFirst && attempts++===0)throw Error('Push service unavailable');Notification.permission='granted';sub={options:{applicationServerKey:Buffer.from(publicKey,'base64url')},toJSON(){return {endpoint:'https://fcm.googleapis.com/fake',keys:{p256dh:'test',auth:'test'}};},async unsubscribe(){sub=null;return true;}};return sub;}};
  const window={isSecureContext:true,PushManager:{},Notification,matchMedia(){return {matches:false};},addEventListener(name,fn){events[name]=fn;},};
  const document={readyState:'complete',getElementById(id){return nodes[id];},addEventListener(){}};
  const context={window,globalThis:window,document,navigator:{standalone:installed,userAgent:ios?'iPhone':'Chrome',platform:ios?'iPhone':'Linux',serviceWorker:{async register(){},ready:Promise.resolve({pushManager:manager})}},Notification,localStorage:{getItem(){return savedEnabled?JSON.stringify({quakeNotifyEnabled:true}):null;},setItem(){}},fetch:async(url,options)=>{requests.push({url,data:options.body?JSON.parse(options.body):null});if(failTest && url.endsWith('/test'))return Response.json({error:'Test delivery unavailable',code:'PUSH_DELIVERY_FAILED'},{status:503});return Response.json({ready:true,publicKey,ok:true});},AbortSignal,setTimeout,clearTimeout,atob,Uint8Array};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/earthquake-notification-settings.js'),'utf8'),context);
  return {nodes,events,requests,permissions,window,async click(id){gesture=true;nodes[id].listeners.click();gesture=false;await new Promise(resolve=>setImmediate(resolve));},async change(id,value){gesture=true;if(nodes[id].type==='checkbox')nodes[id].checked=value;else nodes[id].value=value;nodes[id].listeners.change();gesture=false;await new Promise(resolve=>setImmediate(resolve));},async flush(){await new Promise(resolve=>setImmediate(resolve));}};
}


test('settings subscribes from an iPhone tap, saves independent thresholds, and turns notifications off', async()=>{
  const page=settingsPage({ios:true,installed:true});await page.flush();
  assert.equal(page.nodes.quakePushEnable.disabled,false);
  await page.click('quakePushEnable');assert.deepEqual(page.permissions,[true]);
  await page.change('quakeRegionalMagnitude','4.5');await page.change('quakeWorldwideMagnitude','7');
  const data=page.requests.filter(r=>r.url.endsWith('/subscribe')).at(-1).data;
  assert.equal(data.preferences.quakeRegionalMagnitude,'4.5');assert.equal(data.preferences.quakeWorldwideMagnitude,'7');
  await page.change('quakeNotifyRegional',false);assert.equal(page.nodes.quakeRegionalMagnitude.disabled,true);
  await page.change('quakeNotifyEnabled',false);assert.ok(page.requests.some(r=>r.url.endsWith('/unsubscribe')));assert.equal(page.nodes.quakePushTest.disabled,true);
});
test('iPhone browser explains installation without requesting notification permission',async()=>{
  const page=settingsPage({ios:true});await page.flush();await page.change('quakeNotifyEnabled',true);
  assert.equal(page.permissions.length,0);assert.equal(page.nodes.quakeNotifyEnabled.checked,false);assert.match(page.nodes.quakePushStatus.textContent,/Home Screen/);
});
test('theme control moves between desktop app menu and mobile settings without replacing the control',()=>{
  const {placeTheme}=require('../assets/earthquake-theme-placement.js');
  const toggle={},menu={hidden:false},row={},menuHome={append(el){el.parentElement=this;}},settingsHome={append(el){el.parentElement=this;}};
  const nodes={themeToggle:toggle,gregleAppMenu:menu,quakeMenuThemeHome:menuHome,quakeSettingsThemeHome:settingsHome,quakeSettingsThemeRow:row};
  const mobile={matches:false,addEventListener(name,fn){this.change=fn;}};
  placeTheme({document:{getElementById:id=>nodes[id]},matchMedia:()=>mobile,addEventListener(){}});
  assert.equal(toggle.parentElement,menuHome);assert.equal(row.hidden,true);
  mobile.matches=true;mobile.change();assert.equal(toggle.parentElement,settingsHome);assert.equal(row.hidden,false);
  mobile.matches=false;menu.hidden=true;mobile.change();assert.equal(toggle.parentElement,settingsHome);
  menu.hidden=false;mobile.change();assert.equal(toggle.parentElement,menuHome);
});
test('earthquake SW is isolated on its origin and shows earthquake icons with a safe click URL',async()=>{
  const listeners={},notifications=[];
  const self={location:{origin:'https://earthquakes.gregle.uk'},addEventListener(name,fn){listeners[name]=fn;},registration:{async showNotification(title,options){notifications.push({title,...options});}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../earthquakes-sw.js'),'utf8'),{self,URL});
  await new Promise((resolve,reject)=>listeners.push({data:{json:()=>({title:'M6 earthquake',url:'https://evil.example/'})},waitUntil:p=>p.then(resolve,reject)}));
  assert.equal(notifications[0].icon,'/assets/earthquakes-app/icon-192.png');assert.equal(notifications[0].data.url,'https://earthquakes.gregle.uk/');
});
test('combined scheduler checks earthquakes each minute and preserves the five-minute weather cadence',async()=>{
  const {env,sql}=await setup(),{default:worker}=await import('../workers/weather-notifications/worker.mjs');
  const now=Math.floor(Date.now()/300000)*300000,original=global.fetch;
  global.fetch=async url=>{
    if(url.includes('earthquake.usgs.gov'))return Response.json({type:'FeatureCollection',metadata:{generated:now},features:[]});
    const product=url.match(/([A-Z0-9]+)\.js$/)[1];return new Response('var '+product+' = '+JSON.stringify(bulletin('Information',product))+';');
  };
  try{
    let tasks=[];await worker.scheduled({scheduledTime:now+60000},env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);
    assert.equal(tasks.length,1);assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM service_state WHERE key='last_check'").get().n,0);
    tasks=[];await worker.scheduled({scheduledTime:now},env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);assert.equal(tasks.length,2);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM service_state WHERE key='last_check'").get().n,1);
  }finally{global.fetch=original;}
});
