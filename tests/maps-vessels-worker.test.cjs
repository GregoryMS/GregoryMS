const { test } = require('node:test'), assert = require('node:assert/strict');
const sid='1234567890abcdef12345678';
const fields=['mmsi','lat','lng','name','heading','cog','sog','type_name','country','destination','source','observed_at'];
function payload(){return {payload:'ship_map_wire_v1',snapshot_id:sid,fields,ship_rows:[[316001234,48.43,-123.36,'Test',511,90,0,'Tug','Canada','VICTORIA','aisstream',new Date().toISOString()],[257123456,60,5,'Outside']],cursor:'5000',connected:true};}
async function setup(){
 const {default:worker}=await import('../workers/vessels/worker.mjs');
 const store=new Map(),calls=[],pending=[];let impl=async()=>new Response(JSON.stringify(payload()));
 const oldFetch=global.fetch,oldCaches=global.caches;
 global.caches={default:{match:async key=>store.get(key.url)?.clone(),put:async(key,res)=>{store.set(key.url,res.clone());}}};
 global.fetch=async(url,opts)=>{calls.push({url,...opts});return impl(url,opts);};
 const ask=(query='bbox=-123.5,48.3,-123.2,48.5',origin='https://gregle.uk',method='GET')=>worker.fetch(new Request('https://vessels.test/vessels?'+query,{headers:{Origin:origin},method}),{}, {waitUntil:p=>pending.push(p)});
 return {ask,calls,setFetch:f=>impl=f,done:()=>Promise.all(pending),cleanup(){global.fetch=oldFetch;global.caches=oldCaches;}};
}
test('vessel relay validates requests, fixes upstream, filters regions and reuses source pages',async()=>{
 const h=await setup();try{
 assert.equal((await h.ask(undefined,'https://elsewhere.test')).status,403);
 assert.equal((await h.ask('bbox=0,0,360,90')).status,400);assert.equal((await h.ask('bbox=-123.5,48.3,-123.2,48.5&mock=true')).status,400);
 assert.equal((await h.ask('bbox=-123.5,48.3,-123.2,48.5&cursor=5000&snapshot=evil')).status,400);
 assert.equal((await h.ask(undefined,undefined,'POST')).status,405);assert.equal(h.calls.length,0);
 const r=await h.ask();assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://gregle.uk');const d=await r.json();assert.equal(d.ships.length,1);assert.equal(d.ships[0].speed,0);assert.equal(d.cursor,'5000');assert.equal(d.snapshotId,sid);await h.done();
 await h.ask('bbox=-123.6,48.2,-123.1,48.6');assert.equal(h.calls.length,1);assert.equal(new URL(h.calls[0].url).hostname,'pocketworld.org');assert.equal(new URL(h.calls[0].url).searchParams.get('limit'),'5000');assert.equal(h.calls[0].redirect,'manual');
 }finally{h.cleanup();}
});
test('relay handles dateline views and rejects a mismatched snapshot',async()=>{
 const h=await setup();try{
 h.setFetch(async()=>new Response(JSON.stringify({...payload(),ship_rows:[[316001234,0,-179.95,'Dateline']],cursor:null,truncated:false})));
 const d=await(await h.ask('bbox=179.8,-1,180.2,1')).json();assert.equal(d.ships.length,1);assert.equal(d.cursor,'');
 h.setFetch(async()=>new Response(JSON.stringify({...payload(),snapshot_id:'aaaaaaaaaaaaaaaaaaaaaaaa'})));
 assert.equal((await h.ask('bbox=179.8,-1,180.2,1&cursor=5000&snapshot='+sid)).status,503);
 }finally{h.cleanup();}
});
test('upstream throttling is shared across areas and malformed JSON fails closed',async()=>{
 const h=await setup();try{
 h.setFetch(async()=>new Response('slow',{status:429,headers:{'Retry-After':'120'}}));const r=await h.ask();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'120');await h.done();assert.equal((await h.ask('bbox=0,0,1,1')).status,503);assert.equal(h.calls.length,1);
 }finally{h.cleanup();}
 const broken=await setup();try{broken.setFetch(async()=>new Response('{}'));assert.equal((await broken.ask()).status,503);}finally{broken.cleanup();}
});

test('a transient page error does not pause unrelated pages and observation age uses the position report',async()=>{
 const h=await setup();try{
 h.setFetch(async()=>new Response('temporary',{status:503}));assert.equal((await h.ask()).status,503);await h.done();
 const data=payload();data.fields.push('position_observed_at');data.ship_rows[0].push('2026-10-18T18:00:00Z');data.total_available=35815;
 h.setFetch(async()=>new Response(JSON.stringify(data)));const r=await h.ask();assert.equal(r.status,200);const d=await r.json();assert.equal(d.pages,8);assert.equal(d.ships[0].observed,'2026-10-18T18:00:00Z');assert.equal(h.calls.length,2);
 }finally{h.cleanup();}
});
