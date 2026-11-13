const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-navigation-core.js');
function setup(){
 const els=new Map(),events={};let view,failed=0,clock=1000,nextTimer=0;const timers=new Map();
 const el=id=>{if(!els.has(id))els.set(id,{hidden:false,classList:{contains:()=>false,add(){},remove(){}},getBoundingClientRect:()=>({width:1000,height:600})});return els.get(id);};
 class MapView{
  constructor(options){this.options=options;this.sources={};this.events={};this.jumps=[];this.layers=[];view=this;}
  once(name,fn){this.events[name]=fn;}
  on(name,fn){this.events[name]=fn;}
  isStyleLoaded(){return true;}
  getSource(id){return this.sources[id];}
  addSource(id,source){this.sources[id]=source;}
  addLayer(layer){this.layers.push(layer);}
  addControl(){} jumpTo(options){this.jumps.push(options);} easeTo(){throw Error('Tesla must avoid animated camera');}
  resize(){} remove(){this.removed=true;}
 }
 class Marker{setLngLat(){return this;}setRotation(){return this;}addTo(){return this;}remove(){}}
 const gl={Map:MapView,Marker,NavigationControl:class{},supported:()=>true};
 const document={hidden:false,getElementById:el,querySelector:()=>el('stage'),createElement:()=>({}),documentElement:el('html'),addEventListener:(name,fn)=>events[name]=fn};
 const ctx={window:{mapboxgl:gl,GregleNavigation:core,GregleMapRouting:{mapboxEndpoint:'https://map.example'},matchMedia:()=>({matches:false}),addEventListener(){}},document,navigator:{userAgent:'Mozilla/5.0 Tesla/2026'},fetch:async()=>({ok:true,json:async()=>({publicToken:'pk.test'})}),AbortSignal,Date:class extends Date {static now(){return clock;}},setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-navigation-3d.js'),'utf8'),ctx);
 const api=ctx.window.GregleNavigation3D({onBrowse(){},onError(){failed++;api.exit();}});
 return {api,gl,document,view:()=>view,failed:()=>failed,timers,advance:ms=>clock+=ms};
}
const route={points:[[48.42,-123.36],[48.43,-123.35]]};
test('Tesla uses lighter rendering and recovers context loss before a bounded fallback',async()=>{
 const h=setup(),pending=h.api.enter(route);await new Promise(setImmediate);const v=h.view();
 assert.match(v.options.style,/navigation-day-v1/);assert.equal(v.options.maxTileCacheSize,16);assert.equal(h.gl.workerCount,1);assert.equal(v.options.pitch,35);
 v.events.load();assert.equal(await pending,true);assert(!('slot' in v.layers[0]));
 h.advance(1001);h.api.update({lat:48.425,lng:-123.355},{heading:90,speed:10});assert.equal(v.jumps.at(-1).bearing,90);
 h.document.hidden=true;const count=v.jumps.length;h.api.update({lat:48.426,lng:-123.355},{speed:10});assert.equal(v.jumps.length,count);
 v.events.webglcontextlost();assert.equal(h.failed(),0);assert(h.api.active);
 v.events.webglcontextrestored();assert.equal(h.failed(),0);assert(![...h.timers.values()].some(t=>t.ms===12000));
 v.events.webglcontextlost();[...h.timers.values()].find(t=>t.ms===12000).fn();assert.equal(h.failed(),1);assert(v.removed);assert.equal(h.api.active,false);
});
test('cancelling an unfinished 3D load clears its wait and removes the map',async()=>{
 const h=setup(),pending=h.api.enter(route);await new Promise(setImmediate);h.api.exit();
 assert.equal(await pending,false);assert(h.view().removed);assert.equal(h.failed(),0);
});

test('recoverable map data errors do not force 2D during startup or live navigation',async()=>{
 const h=setup(),pending=h.api.enter(route);await new Promise(setImmediate);const v=h.view();
 v.events.error();assert.equal(h.failed(),0);v.events.load();assert.equal(await pending,true);
 v.events.error();assert.equal(h.failed(),0);assert(h.api.active);
 h.api.exit();v.events.webglcontextlost();assert.equal(h.failed(),0);
});
test('Tesla camera updates are capped at one per second and repeated graphics loss is bounded',async()=>{
 const h=setup(),pending=h.api.enter(route);await new Promise(setImmediate);const v=h.view();v.events.load();await pending;
 const count=v.jumps.length;h.api.update({lat:48.42,lng:-123.35},{speed:10});assert.equal(v.jumps.length,count);
 h.advance(1001);h.api.update({lat:48.43,lng:-123.35},{speed:10});assert.equal(v.jumps.length,count+1);
 for(let i=0;i<2;i++){v.events.webglcontextlost();v.events.webglcontextrestored();}
 v.events.webglcontextlost();assert.equal(h.failed(),1);assert(v.removed);
});


test('destination-free 3D starts at GPS without a route line or destination marker',async()=>{
 const h=setup(),pending=h.api.enter(null,{lat:48.425,lng:-123.355});await new Promise(setImmediate);
 const v=h.view();v.events.load();assert.equal(await pending,true);
 assert.equal(v.options.center[0],-123.355);assert.equal(v.options.center[1],48.425);
 assert.equal(v.layers.length,0);assert.equal(Object.keys(v.sources).length,0);
 h.advance(1001);h.api.update({lat:48.426,lng:-123.356},{heading:110,speed:10});
 assert.equal(v.jumps.at(-1).center[0],-123.356);assert.equal(v.jumps.at(-1).bearing,110);
 h.api.exit();await assert.rejects(h.api.enter(null),/current location/);
});
