const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const store=require('../assets/maps-offline-store.js');
const read=p=>fs.readFileSync(require.resolve('../'+p),'utf8');
function catalog(){return {schema:2,version:'offline-20261116000000',regions:store.presets.map(([id,name])=>({id,name,bounds:[-124,48,-123,49],components:{maps:{file:id+'-maps.pmtiles',format:'pmtiles',schema:'shortbread',bytes:12,minZoom:0,maxZoom:14,entries:{'chunk-0':[0,12,'a'.repeat(64)]}},routing:{file:id+'-routing.bin',version:'offline-20261115034348',bytes:12,entries:{overview:[0,12,'b'.repeat(64)]}}}}))};}
test('PMTiles catalogs validate contiguous blocks and preserve independently versioned routing',()=>{
 const c=catalog();assert.equal(store.catalog(c),c);assert.equal(c.regions[0].components.routing.version,'offline-20261115034348');
 for(const change of [p=>p.file='evil.pmtiles',p=>p.maxZoom=30,p=>p.entries['chunk-0'][0]=1,p=>p.entries['chunk-0'][1]=11,p=>p.entries={'chunk-1':[0,12,'a'.repeat(64)]},p=>p.version='../evil']){const bad=catalog();change(bad.regions[0].components.maps);assert.throws(()=>store.catalog(bad));}
});
test('local PMTiles reader returns tile bytes from browser storage without network access',async()=>{
 const bytes=new Uint8Array(16384),view=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('PMTiles'));bytes[7]=3;
 for(const [offset,value] of [[8,127],[16,5],[24,132],[32,2],[40,134],[48,0],[56,134],[64,3],[72,1],[80,1],[88,1]])view.setBigUint64(offset,BigInt(value),true);
 bytes.set([1,1,1,1,0,0],96);view.setInt32(102,-1800000000,true);view.setInt32(106,-850000000,true);view.setInt32(110,1800000000,true);view.setInt32(114,850000000,true);
 bytes.set([1,0,1,3,1],127);bytes.set(new TextEncoder().encode('{}'),132);bytes.set([10,20,30],134);
 const context=vm.createContext({GregleOfflineStore:store,Blob,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,DecompressionStream,Response,Map,Promise,Error,DOMException,fetch(){throw Error('network must not be used');}});
 vm.runInContext(read('assets/vendor/pmtiles/pmtiles.js'),context);vm.runInContext(read('assets/maps-offline-pmtiles.js'),context);
 const archive=context.GregleOfflineArchive({key:'fixture',version:'test',blob:new Blob([bytes])});
 const tile=await archive.getZxy(0,0,0);assert.deepEqual([...new Uint8Array(tile.data)],[10,20,30]);assert.equal(await archive.getZxy(1,0,0),undefined);
 await assert.rejects(store.range({blob:new Blob([bytes])},0,17*1024*1024),/Invalid/);
 const signal=AbortSignal.abort();await assert.rejects(store.range({blob:new Blob([bytes])},0,1,signal),{name:'AbortError'});
});
test('both offline styles include building and POI layers and only local dependencies',()=>{
 for(const theme of ['light','dark']){const s=JSON.parse(read('assets/maps-offline-style/'+theme+'.json'));assert(s.layers.some(l=>l['source-layer']==='buildings'));assert(s.layers.some(l=>l['source-layer']==='pois'));assert(s.glyphs.startsWith('/assets/'));assert(s.sprite.every(p=>p.url.startsWith('/assets/')));assert(s.sources['versatiles-shortbread'].tiles[0].startsWith('gregle-offline://'));}
 const shell=JSON.parse(read('assets/maps-offline-shell.js').split('self.GregleMapsShell=')[1].slice(0,-2));
 for(const path of ['/assets/vendor/maplibre/maplibre-gl.js','/assets/vendor/pmtiles/pmtiles.js','/assets/maps-offline-pmtiles.js','/assets/vendor/pmtiles/tile-search.js','/assets/maps-offline-style/base@2x.png','/assets/maps-offline-style/glyphs/noto_sans_regular/0-255.pbf','/assets/maps-offline-style/glyphs/noto_sans_bold/5120-5375.pbf'])assert(shell.assets.some(p=>p.split('?')[0]===path),path);
});
test('relay accepts versioned PMTiles and the new catalog without widening arbitrary asset access',async()=>{
 const {mapsOffline}=await import('../workers/site-router/maps-offline.mjs'),original=global.fetch,calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return new Response('bytes');};
 try{for(const path of ['catalog-v2.json','offline-20261116000000/greater-victoria-maps.pmtiles'])assert.equal((await mapsOffline(new Request('https://maps.gregle.uk/api/maps/offline/'+path))).status,200);
 assert(calls[0].url.endsWith('/offline-current/catalog-v2.json'));assert(calls[1].url.endsWith('/offline-20261116000000/greater-victoria-maps.pmtiles'));
 for(const path of ['offline-20261116000000/greater-victoria-routing.pmtiles','offline-20261116000000/random.pmtiles'])assert.equal((await mapsOffline(new Request('https://maps.gregle.uk/api/maps/offline/'+path))).status,404);
 }finally{global.fetch=original;}
});
test('renderer resolves local sprite URLs and preserves glyph substitution tokens',async()=>{
 let options,protocol;const gl={getCanvas:()=>({setAttribute(){}})},layer={addTo(){},getMaplibreMap:()=>gl},panes={};
 const context=vm.createContext({window:null,location:{origin:'https://maps.gregle.uk'},devicePixelRatio:3,structuredClone,URL,Map,Promise,Error,DOMException,
  maplibregl:{supported:()=>true,setWorkerCount(){},setMaxParallelImageRequests(){},addProtocol:(name,fn)=>{protocol=fn;}},MaplibreGLLeaflet:{maplibreGL:o=>{options=o;return layer;}},
  fetch:async()=>new Response(read('assets/maps-offline-style/light.json')),Response,GregleOfflineArchive:()=>({getZxy:async()=>({data:new Uint8Array([1,2,3])})}),Uint8Array});
 context.window=context;
 vm.runInContext(read('assets/maps-offline-vector.js'),context);
 const map={getPane:name=>panes[name],createPane:name=>panes[name]={style:{}},removeLayer(){},attributionControl:{addAttribution(){},removeAttribution(){}}};
 await context.GregleOfflineVector.show(map,{generation:'saved',bounds:[-124,48,-123,49]},false);
 assert(options.style.glyphs.endsWith('/{fontstack}/{range}.pbf'));assert.equal(options.style.sprite[0].url,'https://maps.gregle.uk/assets/maps-offline-style/base');assert.equal(options.maxTileCacheSize,24);assert.equal(options.pixelRatio,2);
 assert.deepEqual([...new Uint8Array((await protocol({url:'gregle-offline://saved/0/0/0'},new AbortController())).data)],[1,2,3]);
 context.GregleOfflineVector.clear(map);await assert.rejects(protocol({url:'gregle-offline://saved/0/0/0'},new AbortController()),{name:'AbortError'});
});
test('offline tile search prioritizes local streets and limits overview searches to place labels',()=>{
 const integer=n=>{const out=[];do{const b=n&127;n>>>=7;out.push(b|(n?128:0));}while(n);return Buffer.from(out);};
 const field=(id,type,bytes)=>Buffer.concat([integer(id*8+type),...(type===2?[integer(bytes.length),bytes]:[integer(bytes)])]);
 const layer=(name,label)=>{
  const feature=Buffer.concat([field(2,2,Buffer.from([0,0])),field(3,0,1),field(4,2,Buffer.concat([integer(9),integer(4096),integer(4096)]))]);
  return field(3,2,Buffer.concat([field(15,0,2),field(1,2,Buffer.from(name)),field(2,2,feature),field(3,2,Buffer.from('name')),field(4,2,field(1,2,Buffer.from(label))),field(5,0,4096)]));
 };
 const bytes=Buffer.concat([layer('street_labels','Douglas Street'),layer('public_transport','Douglas at Pandora'),layer('place_labels','Douglasville')]);
 const context=vm.createContext({Uint8Array,ArrayBuffer,DataView,TextDecoder,Math,Error,Object});vm.runInContext(read('assets/vendor/pmtiles/tile-search.js'),context);
 const detailed=context.GregleOfflineTileSearch.matches(bytes,0,0,0,'douglas');assert(detailed.some(p=>p.name==='Douglas Street'&&p.kind==='road'));assert(detailed.some(p=>p.kind==='transit stop'));assert(detailed.every(p=>p.lat===0&&p.lng===0));
 const overview=context.GregleOfflineTileSearch.matches(bytes,0,0,0,'douglas',true);assert.equal(overview.length,1);assert.equal(overview[0].name,'Douglasville');
});
