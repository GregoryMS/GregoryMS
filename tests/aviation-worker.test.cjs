const {test}=require('node:test');
const assert=require('node:assert/strict');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTuYAAAAASUVORK5CYII=','base64');
const base='https://gregle-aviation.square-rain-5ded.workers.dev';
const secret='test-only-openaip-secret';
async function setup() {
 const worker=(await import('../workers/aviation/worker.mjs')).default;
 const entries=new Map(),calls=[],pending=[];let allow=true,upstream=()=>new Response(png,{headers:{'Content-Type':'image/png','Set-Cookie':'must-not-forward'}});
 const originalFetch=global.fetch,originalCaches=global.caches;
 global.caches={default:{async match(key){return entries.get(key.url)?.clone();},async put(key,response){entries.set(key.url,response.clone());}}};
 global.fetch=async(url,options)=>{calls.push({url,options});return upstream();};
 const env={OPENAIP_API_KEY:secret,TILE_LIMITER:{async limit(){return {success:allow};}}};
 const ctx={waitUntil(p){pending.push(p);}};
 async function run(path='/tiles/9/81/177.png',headers={},method='GET'){
  const r=await worker.fetch(new Request(base+path,{method,headers:{Origin:'https://gregle.uk',...headers}}),env,ctx);
  await Promise.all(pending.splice(0));return r;
 }
 return {run,calls,env,entries,setUpstream(fn){upstream=fn;},limit(value){allow=value;},restore(){global.fetch=originalFetch;global.caches=originalCaches;}};
}
test('aviation relay uses only the secret header and caches PNGs across allowed origins',async()=>{
 const h=await setup();try{
  const r=await h.run(undefined,{Cookie:'private',Authorization:'private','x-openaip-api-key':'ignored'});
  assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://gregle.uk');assert.equal(r.headers.get('Set-Cookie'),null);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);assert.equal(h.calls.length,1);
  const call=h.calls[0];assert.equal(call.url,'https://api.tiles.openaip.net/api/data/openaip/9/81/177.png');
  assert(!call.url.includes(secret));assert.equal(call.options.headers['x-openaip-api-key'],secret);assert.equal(call.options.headers.Cookie,undefined);assert.equal(call.options.headers.Authorization,undefined);assert.equal(call.options.redirect,'manual');
  const cached=await h.run(undefined,{Origin:'https://www.gregle.uk'});assert.equal(cached.status,200);assert.equal(cached.headers.get('Access-Control-Allow-Origin'),'https://www.gregle.uk');assert.equal(h.calls.length,1);
 }finally{h.restore();}
});
test('aviation relay rejects foreign origins, unbounded coordinates, query overrides and extra methods',async()=>{
 const h=await setup();try{
  for(const origin of ['', 'null','https://evil.example','https://gregle.uk.evil.example'])assert.equal((await h.run(undefined,{Origin:origin})).status,403);
  for(const path of ['/tiles/1/0/0.png','/tiles/15/0/0.png','/tiles/9/512/0.png','/tiles/9/0/512.png','/tiles/9/-1/0.png','/tiles/9/0/0.png?apiKey=override','/proxy?url=https://example.com'])assert((await h.run(path)).status>=400,path);
  assert.equal((await h.run(undefined,{},'POST')).status,405);
  assert.equal((await h.run(undefined,{},'OPTIONS')).status,204);assert.equal(h.calls.length,0);
  h.env.OPENAIP_API_KEY='';assert.equal((await h.run()).status,503);assert.equal(h.calls.length,0);
 }finally{h.restore();}
});
test('empty tiles are cached and source errors are sanitized with a shared cooldown',async()=>{
 const h=await setup();try{
  h.setUpstream(()=>new Response(null,{status:204}));assert.equal((await h.run()).status,204);assert.equal((await h.run()).status,204);assert.equal(h.calls.length,1);
  h.setUpstream(()=>new Response(secret,{status:429,headers:{'Retry-After':'90'}}));
  const limited=await h.run('/tiles/9/82/177.png');assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'90');assert(!(await limited.text()).includes(secret));
  assert.equal((await h.run('/tiles/9/83/177.png')).status,429);assert.equal(h.calls.length,2);
  assert.equal((await h.run()).status,204);assert.equal(h.calls.length,2);
 }finally{h.restore();}
});
test('the relay bounds source requests and rejects non-PNG, oversized, and redirected responses',async()=>{
 const h=await setup();try{
  h.limit(false);assert.equal((await h.run()).status,429);assert.equal(h.calls.length,0);h.limit(true);
  for(const response of [new Response('<html>',{headers:{'Content-Type':'image/png'}}),new Response(png,{headers:{'Content-Type':'text/html'}}),new Response(png,{headers:{'Content-Type':'image/png','Content-Length':'999999999'}}),new Response(new Uint8Array(2*1024*1024+1),{headers:{'Content-Type':'image/png'}})]){
   h.entries.clear();h.setUpstream(()=>response);assert.equal((await h.run()).status,503);
  }
  h.setUpstream(()=>new Response(null,{status:302,headers:{Location:'https://elsewhere.example'}}));assert.equal((await h.run()).status,503);
 }finally{h.restore();}
});
