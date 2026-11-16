const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function environment(host='maps.gregle.uk',{storage=new Map(),fail='',version=''}={}){
  const origin='https://'+host,listeners={},requests=[];
  const key=x=>new URL(typeof x==='string'?x:x.url||x.href,origin).href;
  const caches={async open(name){if(!storage.has(name))storage.set(name,new Map());const files=storage.get(name);return{async put(k,r){files.set(key(k),r.clone());},async match(k,{ignoreSearch=false}={}){const target=key(k);if(!ignoreSearch)return files.get(target)?.clone();for(const [url,response] of files)if(url.split('?')[0]===target.split('?')[0])return response.clone();},async keys(){return[...files.keys()];}};},async keys(){return[...storage.keys()];},async delete(k){return storage.delete(k);}};
  let claims=0;
  const self={clients:{async claim(){claims++;}},location:new URL(origin+'/gregle-sw.js'),addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
  const context=vm.createContext({self,caches,URL,Request,Response,Set,Promise,Error,fetch:async input=>{
    const url=new URL(key(input));requests.push(url.href);if(url.pathname===fail)throw Error('Interrupted connection');
    const file=path.join(root,url.pathname==='/'?(host==='maps.gregle.uk'?'maps.html':'calc.html'):url.pathname);
    const type=file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.wasm')?'application/wasm':'application/octet-stream';
    const response=new Response(fs.readFileSync(file),{headers:{'content-type':type}});Object.defineProperty(response,'url',{value:url.href});return response;
  }});
  context.importScripts=(...files)=>files.forEach(file=>{let source=fs.readFileSync(path.join(root,file),'utf8');if(version&&file.endsWith('maps-offline-shell.js'))source=source.replace(/"version":"[^"]+"/,`"version":"${version}"`);vm.runInContext(source,context);});
  vm.runInContext(fs.readFileSync(path.join(root,'gregle-sw.js'),'utf8'),context);
  return {storage,requests,get claims(){return claims;},async lifecycle(type){const work=[];for(const fn of listeners[type]||[])fn({waitUntil:p=>work.push(p)});await Promise.all(work);},async request(url,{mode='navigate',method='GET'}={}){let response,count=0;for(const fn of listeners.fetch||[])fn({request:{url:new URL(url,origin).href,mode,method},respondWith(p){if(++count>1)throw Error('Duplicate respondWith');response=p;}});return response&&await response;},async status(type='maps-offline-status'){const work=[];let data;for(const fn of listeners.message||[])fn({data:{type},ports:[{postMessage:p=>data=p}],waitUntil:p=>work.push(p)});await Promise.all(work);return data;}};
}
test('maps shell installs locally and opens all Maps launch paths without a network request',async()=>{
  const app=environment();await app.lifecycle('install');await app.lifecycle('activate');assert.equal((await app.status()).ready,true);assert.equal(app.claims,1);
  const count=app.requests.length;for(const url of ['/','/maps.html?offline=1','/maps#pin=48,-123'])assert.match(await(await app.request(url)).text(),/Maps · Gregle/);
  for(const url of ['/assets/maps-offline-worker.js','/assets/maps-navigation-core.js','/assets/maps-offline-store.js'])assert(await app.request(url,{mode:'cors'}));assert.equal(app.requests.length,count);
  assert.equal(await app.request('/weather.html'),undefined);assert.equal(await app.request('https://tile.openstreetmap.org/13/1/1.png'),undefined);
});
test('maps shell install failure keeps previous complete app cache and downloaded data untouched',async()=>{
  const previous=environment();await previous.lifecycle('install');const old=[...previous.storage.keys()][0];previous.storage.set('unrelated',new Map());
  const update=environment('maps.gregle.uk',{storage:previous.storage,fail:'/assets/maps-offline-worker.js',version:'new'});await assert.rejects(update.lifecycle('install'));assert(previous.storage.has(old));assert(previous.storage.has('unrelated'));assert(!previous.storage.has('gregle-maps-shell-new'));
});
test('shared apex service worker preserves Maps, Calculator and common assets without double handling',async()=>{
  const app=environment('gregle.uk');await app.lifecycle('install');assert.equal((await app.status()).ready,true);assert.equal((await app.status('calculator-offline-status')).ready,true);
  for(const url of ['/maps.html','/calc.html','/assets/tools.css'])assert(await app.request(url,{mode:url.endsWith('html')?'navigate':'cors'}));assert.equal(await app.request('/'),undefined);
  const calculator=environment('calc.gregle.uk');await calculator.lifecycle('install');assert.equal(await calculator.status(),undefined);assert.equal((await calculator.status('calculator-offline-status')).ready,true);
});
test('package relay allows only known public assets and streams without forwarding visitor headers',async()=>{
  const {mapsOffline}=await import('../workers/site-router/maps-offline.mjs');const original=global.fetch;let calls=[];
  global.fetch=async(url,options)=>{calls.push({url,options});return new Response('bytes');};
  try{
    for(const pathname of ['/api/maps/offline/https://example.com','/api/maps/offline/offline-20261115/unknown.bin','/api/maps/offline/catalog.json?url=evil'])assert.equal((await mapsOffline(new Request('https://maps.gregle.uk'+pathname))).status,404);
    assert.equal((await mapsOffline(new Request('https://maps.gregle.uk/api/maps/offline/catalog.json',{method:'POST'}))).status,405);
    const response=await mapsOffline(new Request('https://maps.gregle.uk/api/maps/offline/offline-20261115000000/victoria-routing.bin',{headers:{Cookie:'private',Authorization:'private'}}));assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(await response.text(),'bytes');assert.equal(calls.length,1);assert(!calls[0].options.headers.Cookie);assert(calls[0].url.startsWith('https://github.com/GregoryMS/GregoryMS/releases/download/offline-'));
  }finally{global.fetch=original;}
});
