const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'calc-sw.js'),'utf8');
function environment({host='calc.gregle.uk',fail='',storage=new Map(),version,staleHTML=false}={}) {
  const origin='https://'+host, listeners={}, requests=[];
  const key=input => new URL(typeof input==='string' ? input : input.url || input.href,origin).href;
  const caches={
    async open(name) {
      if (!storage.has(name)) storage.set(name,new Map());
      const entries=storage.get(name);
      return {async put(input,response) {entries.set(key(input),response.clone());},async match(input) {return entries.get(key(input))?.clone();}};
    },
    async keys() {return [...storage.keys()];},async delete(name) {return storage.delete(name);}
  };
  const fetch=async input => {
    const url=new URL(key(input)); requests.push(url.href);
    if (url.pathname===fail) throw Error('Interrupted connection');
    const file=path.join(root,url.pathname==='/' ? 'calc.html' : url.pathname);
    let content=fs.readFileSync(file);
    if (staleHTML && file.endsWith('calc.html')) content=content.toString().replace('calc-offline.js?v=20261102-ti89-6','calc-offline.js?v=another-release');
    const type=/\.wasm$/.test(file) ? 'application/wasm' : /\.(?:m?js)$/.test(file) ? 'text/javascript' : /\.html$/.test(file) ? 'text/html' : 'application/octet-stream';
    const response=new Response(content,{headers:{'content-type':type}});
    Object.defineProperty(response,'url',{value:url.href});
    return response;
  };
  const self={location:new URL(origin+'/calc-sw.js'),addEventListener(type,fn) {listeners[type]=fn;}};
  vm.runInNewContext(version ? source.replace(/const VERSION='[^']+'/,`const VERSION='${version}'`) : source,{self,caches,fetch,URL,Request,Response,Set,Promise,Error});
  return {storage,requests,async lifecycle(type) {let work; listeners[type]({waitUntil(value) {work=value;}}); await work;},async request(url,{mode='navigate',method='GET'}={}) {
    let response;
    listeners.fetch({request:{url:new URL(url,origin).href,mode,method},respondWith(value) {response=value;}});
    return response && await response;
  },async status() {
    let work,data; listeners.message({data:{type:'calculator-offline-status'},ports:[{postMessage(value) {data=value;}}],waitUntil(value) {work=value;}}); await work; return data;
  }};
}
test('offline install saves the complete calculator including a never-opened emulator',async () => {
  const app=environment(); await app.lifecycle('install'); await app.lifecycle('activate');
  assert.equal((await app.status()).ready,true);
  for (const file of ['worker.mjs','cemu.mjs','cemu.wasm']) assert(app.requests.some(url => url.endsWith('/assets/ti84/'+file)));
  for (const file of ['worker.js','ti68k.js','rom-source.mjs?v=20261102-ti89-6']) assert(app.requests.some(url => url.endsWith('/assets/ti89/'+file)));
  assert(app.requests.every(url => url.startsWith('https://calc.gregle.uk/')),'no ROM or other third-party resource in the service-worker cache');
  const count=app.requests.length;
  for (const url of ['/?engine=ti89','/calc.html?engine=ti89','/?engine=ti84','/?popout=1','/calc.html?engine=ti84','/calc.html?popout=1']) assert.match(await (await app.request(url)).text(),/Calculator · Gregle/);
  assert.equal(app.requests.length,count,'all launch URLs work without network');
});
test('calculator caching leaves other Gregle apps and unknown asset versions alone',async () => {
  const app=environment(); await app.lifecycle('install');
  for (const url of ['/weather.html','/assets/weather.js','https://files.catbox.moe/5cc8ln.rom','/assets/calc.js?v=future']) assert.equal(await app.request(url),undefined);
  assert.equal(await app.request('/calc.html',{method:'POST'}),undefined);
  const apex=environment({host:'gregle.uk'}); await apex.lifecycle('install');
  assert.equal(await apex.request('/'),undefined,'Gregle homepage is never replaced by the calculator');
  assert.match(await (await apex.request('/calc.html?popout=1')).text(),/Calculator · Gregle/);
});
test('an interrupted update keeps the previous offline calculator and other apps intact',async () => {
  const app=environment(); await app.lifecycle('install');
  const cache=[...app.storage.keys()][0]; app.storage.set('another-app',new Map());
  const update=environment({storage:app.storage,version:'next',fail:'/assets/ti84/cemu.wasm'});
  await assert.rejects(update.lifecycle('install'),/could not finish/);
  assert(app.storage.has(cache)); assert(app.storage.has('another-app'));
  assert(!app.storage.has('gregle-calculator-next'));
  assert.equal((await app.status()).ready,true);
  assert.match(await (await app.request('/?engine=ti84')).text(),/Calculator · Gregle/);
});
test('a complete update retires old calculator files only on activation',async () => {
  const app=environment(); await app.lifecycle('install'); app.storage.set('another-app',new Map());
  const previous=[...app.storage.keys()][0];
  const update=environment({storage:app.storage,version:'next'}); await update.lifecycle('install');
  assert(app.storage.has(previous),'running calculators retain their complete version');
  assert.equal((await app.status()).ready,true);
  await update.lifecycle('activate');
  assert(!app.storage.has(previous)); assert(app.storage.has('another-app'));
  assert.equal((await update.status()).ready,true);
});

test('partial deployments cannot activate HTML referring to another release’s files',async () => {
  const app=environment(); await app.lifecycle('install');
  const current=[...app.storage.keys()][0];
  const update=environment({storage:app.storage,version:'partial',staleHTML:true});
  await assert.rejects(update.lifecycle('install'),/could not finish/);
  assert(app.storage.has(current)); assert(!app.storage.has('gregle-calculator-partial'));
  assert.equal((await app.status()).ready,true);
});
