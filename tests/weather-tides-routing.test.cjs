const {test}=require('node:test');
const assert=require('node:assert/strict');

test('Weather Tides stays on the Weather origin, streams the existing page, and keeps legacy routes',async()=>{
 const worker=(await import('../workers/site-router/worker.mjs')).default;
 const savedFetch=global.fetch,savedRewriter=global.HTMLRewriter;
 const calls=[],handlers=new Map();
 global.HTMLRewriter=class {
  on(selector,handler){handlers.set(selector,handler);return this;}
  transform(response){return response;}
 };
 global.fetch=async(url,options)=>{
  calls.push({url:String(url),options});
  return new Response(options.method==='HEAD'?null:'<html>Tides</html>',{headers:{
   'Content-Type':'text/html','ETag':'old','Content-Length':'18','Set-Cookie':'private=1','Last-Modified':'yesterday'
  }});
 };
 try {
  const query='?lat=48.43&lon=-123.36&name=Victoria&tz=America%2FVancouver';
  const url='https://weather.gregle.uk/tides/';
  const response=await worker.fetch(new Request(url+query));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Location'),null);
  assert.equal(calls[0].url,'https://gregle.uk/tides.html'+query);
  assert.equal(response.headers.get('Cache-Control'),'no-cache');
  for(const header of ['ETag','Content-Length','Last-Modified','Set-Cookie'])assert.equal(response.headers.get(header),null);
  const rewritten=selector=>{
   const attrs={};const el={setAttribute(k,v){attrs[k]=v;},after(v){attrs.after=v;},setInnerContent(v){attrs.html=v;}};
   handlers.get(selector).element(el);return attrs;
  };
  assert.equal(rewritten('meta[charset]').after,'<base href="/">');
  assert.match(rewritten('link[rel="manifest"]').href,/^\/weather.webmanifest/);
  assert.equal(rewritten('body')['data-weather-app-tides'],'');
  const back=rewritten('#weatherLink');assert.equal(back.href,'/'+query);
  assert.equal(back['aria-label'],'Back to Weather');assert.match(back.html,/Back to /);
  const head=await worker.fetch(new Request(url+query,{method:'HEAD'}));
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  const canonical=await worker.fetch(new Request('https://weather.gregle.uk/tides'+query));
  assert.equal(canonical.headers.get('Location'),url+query);
  for(const source of ['https://weather.gregle.uk/tides.html','https://maps.gregle.uk/tides']){
   assert.equal((await worker.fetch(new Request(source+query))).headers.get('Location'),'https://tides.gregle.uk/'+query);
  }
  assert.equal((await worker.fetch(new Request(url,{method:'POST'}))).status,405);
  assert.equal((await worker.fetch(new Request(url.replace('https:','http:')))).headers.get('Location'),url);
 } finally {global.fetch=savedFetch;global.HTMLRewriter=savedRewriter;}
});
