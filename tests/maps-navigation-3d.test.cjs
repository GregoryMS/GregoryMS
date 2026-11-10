const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-navigation-core.js');
function setup(){
 const els=new Map(),events={};let view,failed=0;
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
 const ctx={window:{mapboxgl:gl,GregleNavigation:core,GregleMapRouting:{mapboxEndpoint:'https://map.example'},matchMedia:()=>({matches:false}),addEventListener(){}},document,navigator:{userAgent:'Mozilla/5.0 Tesla/2026'},fetch:async()=>({ok:true,json:async()=>({publicToken:'pk.test'})}),AbortSignal,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-navigation-3d.js'),'utf8'),ctx);
 const api=ctx.window.GregleNavigation3D({onBrowse(){},onError(){failed++;api.exit();}});
 return {api,gl,document,view:()=>view,failed:()=>failed};
}
const route={points:[[48.42,-123.36],[48.43,-123.35]]};
test('Tesla uses lighter perspective, pauses hidden camera and falls back on GPU loss',async()=>{
 const h=setup(),pending=h.api.enter(route);await new Promise(setImmediate);const v=h.view();
 assert.match(v.options.style,/navigation-day-v1/);assert.equal(v.options.maxTileCacheSize,32);assert.equal(h.gl.workerCount,1);assert.equal(v.options.pitch,45);
 v.events.load();assert.equal(await pending,true);assert(!('slot' in v.layers[0]));
 h.api.update({lat:48.425,lng:-123.355},{heading:90,speed:10});assert.equal(v.jumps.at(-1).bearing,90);
 h.document.hidden=true;const count=v.jumps.length;h.api.update({lat:48.426,lng:-123.355},{speed:10});assert.equal(v.jumps.length,count);
 v.events.webglcontextlost();assert.equal(h.failed(),1);assert(v.removed);assert.equal(h.api.active,false);
});
test('cancelling an unfinished 3D load clears its wait and removes the map',async()=>{
 const h=setup(),pending=h.api.enter(route);await new Promise(setImmediate);h.api.exit();
 assert.equal(await pending,false);assert(h.view().removed);assert.equal(h.failed(),0);
});
