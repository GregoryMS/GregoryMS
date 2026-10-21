const {test}=require('node:test'),assert=require('node:assert/strict');
const wire=(now=Date.now())=>({flight_fields:['icao24','lat','lng','last_contact','source','alt','velocity','vertical_rate','cache_stale','privateUnusedField'],flight_rows:[['a12345',48,-123,now/1000-10,'adsbfi',3048,51.44444444,5,false,'omit']]});
const origin='https://gregle.uk',base='https://gregle-aircraft.square-rain-5ded.workers.dev';
async function setup(){
 const worker=(await import('../workers/aircraft/worker.mjs')).default,store=new Map(),calls=[];let impl=async()=>new Response(JSON.stringify(wire()));
 const saved={fetch:global.fetch,caches:global.caches};
 global.caches={default:{match:async key=>store.get(key.url)?.clone(),put:async(key,value)=>{store.set(key.url,value.clone());}}};
 global.fetch=async(url,opts)=>{calls.push({url,...opts});return impl(url,opts);};
 const pending=[];const request=(path='/aircraft?lat=48.43&lon=-123.37&radius=20',headers={Origin:origin},method='GET')=>worker.fetch(new Request(base+path,{headers,method}),{}, {waitUntil:p=>pending.push(p)});
 return {calls,store,request,setFetch:f=>impl=f,close:async()=>{await Promise.all(pending);Object.assign(global,saved);}};
}
test('relay rejects other origins, invalid areas and arbitrary destinations before contacting a source',async()=>{
 const h=await setup();try{
  assert.equal((await h.request(undefined,{Origin:'https://evil.example'})).status,403);
  for(const path of ['/aircraft?lat=&lon=0&radius=10','/aircraft?lat=91&lon=0&radius=10','/aircraft?lat=0&lon=0&radius=251','/aircraft?lat=0&lon=0&radius=10&url=https://evil.example','/elsewhere'])assert([400,404].includes((await h.request(path)).status));
  assert.equal((await h.request(undefined,{Origin:origin},'POST')).status,405);assert.equal((await h.request(undefined,{Origin:origin},'OPTIONS')).status,204);assert.equal(h.calls.length,0);
 }finally{await h.close();}
});
test('relay restricts upstream requests, strips unused fields and caches identical areas',async()=>{
 const h=await setup();try{
  const r=await h.request();assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(r.headers.get('Cache-Control'),'no-store');
  const query=new URL(h.calls[0].url);assert.equal(query.origin+query.pathname,'https://pocketworld.org/api/flights');assert.equal(query.searchParams.get('wire'),'1');const bounds=query.searchParams.get('bbox').split(',').map(Number);assert(bounds[0]<-123.37&&bounds[2]>-123.37&&bounds[1]<48.43&&bounds[3]>48.43);assert.equal(h.calls[0].redirect,'manual');assert(!('Cookie' in h.calls[0].headers));assert(!('Authorization' in h.calls[0].headers));const aircraft=(await r.json()).ac[0];assert.equal(aircraft.privateUnusedField,undefined);assert.equal(aircraft.provider,'adsbfi');assert(Math.abs(aircraft.alt_baro-10000)<.01);assert(Math.abs(aircraft.gs-100)<.01);assert(aircraft.seen_pos>=10&&aircraft.seen_pos<11);
  await h.request();assert.equal(h.calls.length,1);
 }finally{await h.close();}
});
test('upstream throttles produce a shared bounded cooldown rather than requests from each pan',async()=>{
 const h=await setup();try{
  h.setFetch(async()=>new Response('Limited',{status:429,headers:{'Retry-After':'120'}}));const r=await h.request();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'120');
  const next=await h.request('/aircraft?lat=50&lon=-122&radius=10');assert.equal(next.status,429);assert.equal(h.calls.length,2);
 }finally{await h.close();}
});

test('PocketWorld timeout falls back to fresh ADSB.lol positions within the browser deadline',async()=>{
 const h=await setup();try{
  const now=Date.now(), plane={hex:'a12345',lat:48.4,lon:-123.4,alt_baro:12000,gs:210,seen_pos:5,category:'A3',privateField:'omit'};
  h.setFetch(async url=>{if(url.startsWith('https://pocketworld.org/'))throw new DOMException('Timed out','TimeoutError');return new Response(JSON.stringify({now,ac:[plane,{...plane,hex:'b12345',seen_pos:121},{...plane,hex:'c12345',category:'C1'}]}));});
  const response=await h.request();assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.now,now);assert.equal(data.ac.length,1);assert.equal(data.ac[0].provider,'adsblol');assert.equal(data.ac[0].seen_pos,5);assert.equal(data.ac[0].alt_baro,12000);assert.equal(data.ac[0].privateField,undefined);
  assert.equal(h.calls[1].url,'https://api.adsb.lol/v2/point/48.43/-123.37/20');assert.equal(h.calls[1].redirect,'manual');assert(!h.calls[1].headers.Cookie);assert(!h.calls[1].headers.Authorization);
  await h.request();assert.equal(h.calls.length,2);
  await h.request('/aircraft?lat=50&lon=-122&radius=10');assert.equal(h.calls.length,3);assert(h.calls[2].url.startsWith('https://api.adsb.lol/'));
 }finally{await h.close();}
});

test('valid fallback observations survive a cache read or write failure',async()=>{
 const h=await setup();try{
  global.caches.default.match=async()=>{throw Error('cache unavailable');};
  global.caches.default.put=async()=>{throw Error('cache unavailable');};
  h.setFetch(async()=>new Response(JSON.stringify({now:Date.now(),ac:[{hex:'a12345',lat:48,lon:-123,seen_pos:0}]})));
  const response=await h.request();assert.equal(response.status,200);assert.equal((await response.json()).ac[0].provider,'adsblol');
 }finally{await h.close();}
});

test('fallback does not refresh old timestamps and shares failure cooldowns across map areas',async()=>{
 for(const data of [{now:Date.now()-121000,ac:[]},{now:Date.now()+60000,ac:[]},{now:Date.now(),ac:null}]){
  const h=await setup();try{
   h.setFetch(async url=>url.startsWith('https://pocketworld.org/')?new Response('Unavailable',{status:503}):new Response(JSON.stringify(data)));
   assert.equal((await h.request()).status,503);assert.equal(h.calls.length,2);
   assert.equal((await h.request('/aircraft?lat=50&lon=-122&radius=10')).status,503);assert.equal(h.calls.length,2);
  }finally{await h.close();}
 }
});

test('a fallback outage respects Retry-After without suppressing recovered primary data',async()=>{
 const h=await setup();try{
  h.setFetch(async()=>new Response('Limited',{status:429,headers:{'Retry-After':'240'}}));
  assert.equal((await h.request()).status,429);
  const fallbackPause=[...h.store.entries()].find(([key])=>key.endsWith('/cooldown/adsblol'))[1];assert.equal(fallbackPause.headers.get('Cache-Control'),'public, max-age=240');
  h.store.delete(base+'/cooldown/pocketworld');h.setFetch(async()=>new Response(JSON.stringify(wire())));
  assert.equal((await h.request()).status,200);assert.equal(h.calls.length,3);
 }finally{await h.close();}
});
test('source errors, malformed and oversized payloads fail without passing source bodies to clients',async()=>{
 for(const impl of [async()=>{throw Error('private diagnostics');},async()=>new Response('not json'),async()=>new Response(JSON.stringify({now:Date.now(),ac:null})),async()=>new Response('x'.repeat(4*1024*1024+1))]){
  const h=await setup();try{h.setFetch(impl);const r=await h.request();assert.equal(r.status,503);assert.equal(r.headers.get('Retry-After'),'30');assert.equal((await r.json()).error,'Aircraft source temporarily unavailable');}finally{await h.close();}
 }
});

test('dateline query boxes stay valid and stale/unknown provider records are not relabelled as new observations',async()=>{
 const h=await setup();try{
  h.setFetch(async()=>{const data=wire();data.flight_rows.push(['b12345',48,-123,Date.now()/1000,'unverified',0,0,0,false,'omit']);data.flight_rows.push(['c12345',48,-123,Date.now()/1000,'adsbfi',0,0,0,true,'omit']);return new Response(JSON.stringify(data));});
  const response=await h.request('/aircraft?lat=0&lon=179.99&radius=30');const data=await response.json();assert.equal(h.calls.length,2);assert(data.ac.every(p=>p.hex==='a12345'));
  for(const call of h.calls){const b=new URL(call.url).searchParams.get('bbox').split(',').map(Number);assert(b[0]>=-180&&b[2]<=180&&b[0]<b[2]);}
 }finally{await h.close();}
});

test('selected aircraft history is bounded, cached and limited to actual telemetry from the canonical endpoint',async()=>{
 const h=await setup();try{
  h.setFetch(async()=>new Response(JSON.stringify({icao24:'a12345',synthetic:false,reliable_track:true,source:'pocketworld_live_history',waypoints:[{time:Date.now()/1000,lat:48,lng:-123,alt:1000,telemetry:true,synthetic:false,reliable_track:true},{lat:0,lng:0,synthetic:true,telemetry:false}],route:{privateField:'omit'}})));
  const response=await h.request('/aircraft/track/a12345');assert.equal(response.status,200);const data=await response.json();assert.equal(data.waypoints.length,1);assert.equal(data.route,undefined);assert.equal(h.calls[0].url,'https://pocketworld.org/api/flights/track/a12345');assert.equal(h.calls[0].redirect,'manual');
  await h.request('/aircraft/track/a12345');assert.equal(h.calls.length,1);
  for(const path of ['/aircraft/track/invalid','/aircraft/track/a12345?url=https://evil.example','/aircraft/track/~a12345'])assert.equal((await h.request(path)).status,404);
  assert.equal(h.calls.length,1);
 }finally{await h.close();}
});
test('history never treats synthetic routes as telemetry, and source throttles do not stop live positions',async()=>{
 const h=await setup();try{
  h.setFetch(async()=>new Response(JSON.stringify({icao24:'a12345',synthetic:true,reliable_track:false,waypoints:[{lat:0,lng:0}]})));
  const result=await (await h.request('/aircraft/track/a12345')).json();assert(result.track_unavailable);assert.deepEqual(result.waypoints,[]);
  h.setFetch(async()=>new Response('private upstream detail',{status:429,headers:{'Retry-After':'90'}}));const response=await h.request('/aircraft/track/b12345');assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'90');assert(!(await response.text()).includes('private'));
  await h.request('/aircraft/track/c12345');assert.equal(h.calls.length,2);
  h.setFetch(async()=>new Response(JSON.stringify(wire())));assert.equal((await h.request()).status,200);assert.equal(h.calls.length,3);
 }finally{await h.close();}
});
