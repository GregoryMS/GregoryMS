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
  const next=await h.request('/aircraft?lat=50&lon=-122&radius=10');assert.equal(next.status,429);assert.equal(h.calls.length,1);
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
