const {test}=require('node:test'),assert=require('node:assert/strict');
const sign=()=>({id:'12_5',name:'Sproat Lake',location:{type:'Point',coordinates:[-124.909,49.2931]},message_display_1:'WATCH FOR CHANGING\nROAD CONDITIONS',message_display_2:'CHECK DRIVEBC.CA',is_on:true,status:'Has Error(s)',cache_datetime_utc:new Date().toISOString(),privateField:'omit'});
async function setup(){
 const worker=(await import('../workers/drivebc/worker.mjs')).default,store=new Map(),calls=[],pending=[];
 const saved={fetch:global.fetch,caches:global.caches};let impl=async()=>new Response(JSON.stringify([sign()]));
 global.caches={default:{match:async k=>store.get(k.url)?.clone(),put:async(k,r)=>store.set(k.url,r.clone())}};
 global.fetch=async(url,opts)=>{calls.push({url,...opts});return impl(url,opts);};
 const ask=(path='/messages',origin='https://gregle.uk',method='GET')=>worker.fetch(new Request('https://gregle-drivebc.square-rain-5ded.workers.dev'+path,{method,headers:{Origin:origin}}),{}, {waitUntil:p=>pending.push(p)});
 return {ask,calls,setFetch:f=>impl=f,close:async()=>{await Promise.all(pending);Object.assign(global,saved);}};
}
test('DriveBC relay only accepts the fixed message route and approved website origins',async()=>{
 const h=await setup();try{
  assert.equal((await h.ask('/messages','https://example.org')).status,403);
  assert.equal((await h.ask('/messages?url=https://example.org')).status,404);
  assert.equal((await h.ask('/speed')).status,404);
  assert.equal((await h.ask('/messages','https://gregle.uk','POST')).status,405);
  assert.equal((await h.ask('/messages','https://gregle.uk','OPTIONS')).status,204);assert.equal(h.calls.length,0);
 }finally{await h.close();}
});
test('live messages preserve text and source timestamps, omit unused data and reuse the cached snapshot',async()=>{
 const h=await setup();try{
  const item=sign();h.setFetch(async()=>new Response(JSON.stringify([item])));
  const r=await h.ask(),data=await r.json();assert.equal(r.status,200);assert.equal(data.source,'https://www.drivebc.ca/api/dms/');assert(Date.now()-Date.parse(data.fetchedAt)<1000);
  assert.equal(data.signs[0].cache_datetime_utc,item.cache_datetime_utc);assert.equal(data.signs[0].message_display_1,item.message_display_1);assert.equal(data.signs[0].privateField,undefined);
  assert.equal(h.calls[0].url,data.source);assert.equal(h.calls[0].redirect,'manual');assert.equal(h.calls[0].headers.Authorization,undefined);
  const next=await h.ask('/messages','https://www.gregle.uk');assert.equal(next.headers.get('Access-Control-Allow-Origin'),'https://www.gregle.uk');assert.equal((await next.json()).fetchedAt,data.fetchedAt);assert.equal(h.calls.length,1);
 }finally{await h.close();}
});
test('bad feeds fail safely and upstream throttling is shared across requests',async()=>{
 for(const payload of ['not JSON','[]','x'.repeat(2000001),JSON.stringify([{...sign(),location:{type:'Point',coordinates:[0,0]}}])]){
  const h=await setup();try{h.setFetch(async()=>new Response(payload));const r=await h.ask();assert.equal(r.status,503);assert.equal((await r.json()).error,'DriveBC messages temporarily unavailable');}finally{await h.close();}
 }
 const h=await setup();try{h.setFetch(async()=>new Response('private failure',{status:429,headers:{'Retry-After':'120'}}));assert.equal((await h.ask()).status,429);const r=await h.ask();assert.equal(r.headers.get('Retry-After'),'120');assert.equal(h.calls.length,1);}finally{await h.close();}
});
