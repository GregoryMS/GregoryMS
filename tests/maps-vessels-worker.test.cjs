const {test}=require('node:test'),assert=require('node:assert/strict');
const feature=(props={},point=[-123.36,48.43])=>({type:'Feature',geometry:{type:'Point',coordinates:point},properties:{mmsi:316001234,kind:'vessel',msg_type:'PositionReport',name:'Test',type:52,flag:'CA',heading:511,cog:90,sog:0,seen:new Date().toISOString(),source:'aishub',destination:'VICTORIA',...props}});
const payload=(features=[feature()])=>({type:'FeatureCollection',features,attribution:{aishub:'Open Waters AIS (https://openwaters.io/ais/). AISHub (https://www.aishub.net)'}});
async function setup(){
 if (!global.crypto) global.crypto=require('node:crypto').webcrypto;
 const {default:worker}=await import('../workers/vessels/worker.mjs');
 const store=new Map(),calls=[],pending=[];let impl=async()=>new Response(JSON.stringify(payload())), now=Date.now();
 const oldFetch=global.fetch,oldCaches=global.caches,OldDate=global.Date;
 class Clock extends OldDate { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
 global.Date=Clock;
 global.caches={default:{
  match:async key=>{const entry=store.get(key.url);return entry&&entry.expires>now?entry.response.clone():undefined;},
  put:async(key,res)=>{const ttl=Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control')||'')?.[1]||0);store.set(key.url,{response:res.clone(),expires:now+ttl*1000});},
  delete:async key=>store.delete(key.url)
 }};
 global.fetch=async(url,opts)=>{calls.push({url,...opts});return impl(url,opts);};
 const ask=(query='bbox=-123.5,48.3,-123.2,48.5',origin='https://gregle.uk',method='GET')=>worker.fetch(new Request('https://vessels.test/vessels?'+query,{headers:{Origin:origin},method}),{}, {waitUntil:p=>pending.push(p)});
 const done=async()=>{for(let i=0;i<pending.length;i++)await pending[i];};
 return {ask,calls,setFetch:f=>impl=f,advance:ms=>now+=ms,done,async cleanup(){await done();global.fetch=oldFetch;global.caches=oldCaches;global.Date=OldDate;}};
}
test('regional relay rejects invalid origins, methods, parameters and oversized anonymous areas',async()=>{
 const h=await setup();try{
 assert.equal((await h.ask(undefined,'https://elsewhere.test')).status,403);assert.equal((await h.ask(undefined,undefined,'POST')).status,405);
 for(const q of ['bbox=0,0,360,90','bbox=-9,0,9,10','bbox=-123.5,48.3,-123.2,48.5&url=https://evil.test','bbox=-123.5,48.3,-123.2,48.5&cursor=5000&snapshot=bad'])assert.equal((await h.ask(q)).status,400);
 assert.equal(h.calls.length,0);
 }finally{await h.cleanup();}
});
test('one regional request replaces global pagination and keeps provider attribution',async()=>{
 const h=await setup();try{
 const r=await h.ask();assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://gregle.uk');const d=await r.json();assert.equal(d.pages,1);assert.equal(d.cursor,'');assert.match(d.snapshotId,/^[a-f0-9]{24}$/);assert.equal(d.ships.length,1);assert.equal(d.ships[0].source,'openwaters');assert.equal(d.ships[0].sourceLabel,'Open Waters / AISHub');assert.equal(d.ships[0].type,'Tug');assert.equal(d.ships[0].speed,0);assert(d.credits[0].includes('AISHub'));
 const url=new URL(h.calls[0].url);assert.equal(url.hostname,'ais.openwaters.io');assert.equal(url.pathname,'/v1/vessels');assert.equal(url.searchParams.get('bbox'),'48.3,-123.5,48.5,-123.2');assert.equal(url.searchParams.get('kind'),'vessel');assert.equal(url.searchParams.get('max_age'),'600');assert.equal(url.searchParams.get('max_age_moving'),'600');assert.equal(h.calls[0].redirect,'manual');
 await h.ask('bbox=-123.5000,48.3000,-123.2000,48.5000');assert.equal(h.calls.length,1);
 await h.ask('bbox=-123.5,48.3,-123.2,48.5&cursor=5000&snapshot='+d.snapshotId);assert.equal(h.calls.length,1);
 }finally{await h.cleanup();}
});
test('timestamps only advance on actual position reports, not static messages, invalid fixes or other AIS objects',async()=>{
 const h=await setup();try{
 const now=Date.now();h.setFetch(async()=>new Response(JSON.stringify(payload([feature(),feature({mmsi:316001235,msg_type:'StaticDataReport'}),feature({mmsi:316001236,kind:'aton'}),feature({mmsi:316001237,seen:new Date(now-600000).toISOString()}),feature({mmsi:316001238,seen:new Date(now+31000).toISOString()}),feature({mmsi:316001239},[null,48.43]),feature({mmsi:316001240},[0,0]),feature({name:'OLDER',seen:new Date(now-1000).toISOString()})]))));
 const d=await(await h.ask()).json();assert.equal(d.ships.length,1);assert.equal(d.ships[0].name,'Test');assert.equal(d.ships[0].observed,new Date(now).toISOString());
 }finally{await h.cleanup();}
});
test('dateline views use two ORed boxes in one source request',async()=>{
 const h=await setup();try{
 h.setFetch(async()=>new Response(JSON.stringify(payload([feature({},[-179.95,0])]))));const d=await(await h.ask('bbox=179.8,-1,180.2,1')).json();assert.equal(d.ships.length,1);const p=new URL(h.calls[0].url).searchParams;assert.deepEqual(p.getAll('bbox'),['-1,179.8,1,180','-1,-180,1,-179.8']);assert.equal(h.calls.length,1);
 }finally{await h.cleanup();}
});
test('a transient cold miss retries once',async()=>{
 const h=await setup();try{let attempts=0;h.setFetch(async()=>++attempts===1?new Response('temporary',{status:503}):new Response(JSON.stringify(payload())));assert.equal((await h.ask()).status,200);assert.equal(h.calls.length,2);}finally{await h.cleanup();}
});
test('provider throttling honours Retry-After without retrying',async()=>{
 const h=await setup();try{h.setFetch(async()=>new Response('slow',{status:429,headers:{'Retry-After':'120'}}));const r=await h.ask();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'120');assert.equal((await h.ask('bbox=0,0,1,1')).status,503);assert.equal(h.calls.length,1);}finally{await h.cleanup();}
});
test('provider cooldowns allow cached reports while preventing new source requests',async()=>{
 const h=await setup();try{await h.ask();h.setFetch(async()=>new Response('slow',{status:429,headers:{'Retry-After':'120'}}));assert.equal((await h.ask('bbox=0,0,1,1')).status,429);assert.equal((await h.ask()).status,200);h.advance(46000);assert.equal((await(await h.ask()).json()).cached,true);await h.done();assert.equal(h.calls.length,2);}finally{await h.cleanup();}
});
test('a failed background refresh keeps original report times and does not extend the backup',async()=>{
 const h=await setup();try{
 const first=await(await h.ask()).json();h.advance(46000);h.setFetch(async()=>new Response('unavailable',{status:503}));const saved=await(await h.ask()).json();assert.equal(saved.cached,true);assert.equal(saved.cacheAgeSeconds,46);assert.equal(saved.ships[0].observed,first.ships[0].observed);await h.done();assert.equal(h.calls.length,3);
 h.advance(260000);assert.equal((await h.ask()).status,503);assert.equal(h.calls.length,5);
 }finally{await h.cleanup();}
});
test('a successful background refresh replaces old observations',async()=>{
 const h=await setup();try{const first=await(await h.ask()).json();h.advance(46000);assert.equal((await(await h.ask()).json()).cached,true);await h.done();const fresh=await(await h.ask()).json();assert.equal(fresh.cached,false);assert.notEqual(fresh.snapshotId,first.snapshotId);assert.notEqual(fresh.ships[0].observed,first.ships[0].observed);assert.equal(h.calls.length,2);}finally{await h.cleanup();}
});
test('a pending refresh is reused by repeated requests to the same area',async()=>{
 const h=await setup();let release;try{await h.ask();h.advance(46000);h.setFetch(()=>new Promise(resolve=>release=resolve));assert.equal((await h.ask()).status,200);assert.equal((await h.ask()).status,200);assert.equal(h.calls.length,2);release(new Response(JSON.stringify(payload())));await h.done();assert.equal((await(await h.ask()).json()).cached,false);assert.equal(h.calls.length,2);}finally{if(release)release(new Response('{}'));await h.cleanup();}
});
test('malformed source responses fail without caching fabricated vessels',async()=>{
 const h=await setup();try{h.setFetch(async()=>new Response('{}'));assert.equal((await h.ask()).status,503);assert.equal(h.calls.length,1);}finally{await h.cleanup();}
});
test('large views return a bounded newest-first result with a limit notice',async()=>{
 const h=await setup();try{const now=Date.now(),features=Array.from({length:5001},(_,i)=>feature({mmsi:316000000+i,seen:new Date(now-i).toISOString()}));h.setFetch(async()=>new Response(JSON.stringify(payload(features))));const d=await(await h.ask()).json();assert.equal(d.ships.length,5000);assert.equal(d.limited,true);assert.equal(d.ships[0].mmsi,'316000000');}finally{await h.cleanup();}
});
