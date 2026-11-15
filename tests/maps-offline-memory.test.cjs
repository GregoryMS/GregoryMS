const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const store=require('../assets/maps-offline-store.js');
function stream(text,step=1){const bytes=new TextEncoder().encode(text);let offset=0;return new ReadableStream({pull(c){if(offset>=bytes.length)return c.close();c.enqueue(bytes.slice(offset,offset+=step));}});}
test('streamed map parser handles fragmented UTF-8, nesting and escaped strings',async()=>{
 const data=[['place','École ["雪"] \\ centre',[48,-123]],['road','A',{nested:[1,2]},false]];
 for(const step of [1,2,7,65536]){const result=[];await store.scanFeatures(stream(JSON.stringify(data),step),f=>result.push(f));assert.deepEqual(result,data);}
 for(const text of ['[]',' \n []  '])await store.scanFeatures(stream(text),()=>assert.fail());
 for(const text of ['[[1]','[["unfinished','{}','[]junk'])await assert.rejects(store.scanFeatures(stream(text),()=>{}));
 let count=0;await store.scanFeatures(stream(JSON.stringify(data)),()=>{count++;return false;});assert.equal(count,1);
 await assert.rejects(store.scanFeatures(stream(JSON.stringify(data)),()=>{},()=>{throw Error('cancelled');}),/cancelled/);
});
test('render worker bounds province geometry and excludes distant features',async()=>{
 const pack={};let output;
 const features=[['residential','Far',[[60,-130],[60.1,-130]]],...Array.from({length:6000},(_,i)=>['primary','Road '+i,[[48,-123],[48.1,-123.1]]]),['park','Tiny',[[48,-123],[48.001,-123],[48.001,-123.001],[48,-123]],true]];
 const context=vm.createContext({self:{GregleOfflineStore:{get:async()=>pack,eachFeature:async(p,k,consume)=>features.forEach(consume)},postMessage:m=>output=m},importScripts(){},DOMException,Map,Math,Number,Error});
 vm.runInContext(fs.readFileSync(require.resolve('../assets/maps-offline-data-worker.js'),'utf8'),context);
 context.self.onmessage({data:{id:1,type:'render',packKey:'bc',keys:['overview'],zoom:8,bounds:[-124,47,-122,49]}});
 for(let i=0;i<20&&!output;i++)await new Promise(r=>setImmediate(r));
 assert(!output.error);assert.equal(output.result.truncated,true);assert(output.result.features.length<=4500);assert(!output.result.features.some(f=>f[1]==='Far'));
 const ring=output.result.features.find(f=>f[1]==='Tiny')[2];assert.equal(ring.length,4);assert.deepEqual(ring[0],ring.at(-1));
});
test('relay forwards bounded Range requests and rejects unsafe whole BC downloads',async()=>{
 const {mapsOffline}=await import('../workers/site-router/maps-offline.mjs');const original=global.fetch;let sent;
 global.fetch=async(url,options)=>{sent=options;return new Response('part',{status:206,headers:{'Content-Range':'bytes 0-3/100'}});};
 const url='https://maps.gregle.uk/api/maps/offline/offline-20261115034348/british-columbia-maps.bin';
 try{
  assert.equal((await mapsOffline(new Request(url))).status,409);
  for(const range of ['bytes=0-','bytes=4-0','bytes=0-8388608','bytes=0-2,5-6'])assert.equal((await mapsOffline(new Request(url,{headers:{Range:range}}))).status,416);
  const r=await mapsOffline(new Request(url,{headers:{Range:'bytes=0-3'}}));assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 0-3/100');assert.equal(sent.headers.Range,'bytes=0-3');assert.equal(sent.cache,'no-store');assert.match(r.headers.get('Access-Control-Expose-Headers'),/Content-Range/);
  const preflight=await mapsOffline(new Request(url,{method:'OPTIONS'}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Headers'),'Range');
 }finally{global.fetch=original;}
});
