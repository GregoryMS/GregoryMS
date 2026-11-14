const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-core.js');
function setup({dark=false}={}){
 const nodes=new Map(),maps=[],markers=[],mapEvents={},events={},errors=[],frames=new Map(),timers=new Map();let observer;
 let center={lat:48.42,lng:-123.36},zoom=16,bearing=30,next=0,layers=[];
 class El{constructor(){this.hidden=true;this.style={};this.events={};this.children=[];const classes=new Set();this.classList={add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n)};}addEventListener(n,fn){this.events[n]=fn;}append(...items){this.children.push(...items);}setAttribute(n,v){this[n]=v;}getBoundingClientRect(){return {left:10,top:20};}}
 const el=id=>{if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id);};
 const fire=(n,e={})=>(mapEvents[n]||[]).forEach(fn=>fn(e));
 const map={on(names,fn){for(const n of names.split(' '))(mapEvents[n]??=[]).push(fn);},fire,getCenter:()=>center,getZoom:()=>zoom,getBearing:()=>bearing,getSize:()=>({x:1000,y:700}),eachLayer:fn=>layers.forEach(fn),setView(p,z){center={lat:p[0],lng:p[1]};zoom=z;fire('moveend');},setBearing(b){bearing=(b+360)%360;fire('rotate');},fitBounds(){this.oldFit=true;}};
 class View{constructor(options){this.options=options;this.center={lat:options.center[1],lng:options.center[0]};this.zoom=options.zoom;this.bearing=options.bearing;this.events={};this.sources={};this.jumps=[];this.layers=[];this.styles=[];this.zoomRanges=[];this.doubleClickZoom={disable(){}};maps.push(this);}once(n,fn){this.events[n]=fn;}on(n,fn){this.events[n]=fn;}addControl(){}getCenter(){return this.center;}getZoom(){return this.zoom;}getBearing(){return this.bearing;}getPitch(){return 55;}jumpTo(o){this.jumps.push(o);this.center={lat:o.center[1],lng:o.center[0]};this.zoom=o.zoom;this.bearing=o.bearing;this.events.moveend?.();}getSource(n){return this.sources[n];}addSource(n,s){this.sources[n]={...s,setData(d){this.data=d;}};}addLayer(layer,before){this.layers.push({...layer,before});}getLayer(id){return this.layers.find(layer=>layer.id===id)||this.getStyle().layers.find(layer=>layer.id===id);}setPaintProperty(){}getStyle(){return {layers:[{id:'water_name',type:'symbol'},{id:'building',type:'fill'},{id:'road',type:'line'},{id:'labels',type:'symbol'}]};}setLayerZoomRange(...args){this.zoomRanges.push(args);}setStyle(style){this.styles.push(style);this.sources={};this.layers=[];}project(p){return {x:p[0],y:p[1]};}unproject(p){return {lng:p[0],lat:p[1]};}getCanvas(){return {focus(){}};}resize(){}remove(){this.removed=true;}}
 class Marker{constructor(o){this.element=o.element;markers.push(this);}setLngLat(p){this.point=p;return this;}addTo(){return this;}remove(){this.removed=true;}}
 const window={GregleMaps:core,maplibregl:{Map:View,Marker,ScaleControl:class{},supported:()=>true},addEventListener:(n,f)=>events[n]=f,dispatchEvent(){}},document={hidden:false,documentElement:{classList:{contains:()=>dark}},getElementById:el,querySelector:()=>el('stage'),createElement:()=>new El(),head:el('head'),addEventListener(){}};
 const L={latLng:(lat,lng)=>({lat,lng}),Circle:class{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-native-3d.js'),'utf8'),{window,document,navigator:{userAgent:'Browser'},L,CustomEvent:class{},MutationObserver:class{constructor(fn){observer=fn;}observe(){}},setTimeout:(f,ms)=>{timers.set(++next,{f,ms});return next;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:f=>{frames.set(++next,f);return next;},cancelAnimationFrame:id=>frames.delete(id)});
 const api=window.GregleNative3D({map,onError:m=>errors.push(m)});
 return {api,map,maps,markers,errors,el,events,timers,fire,theme:value=>{dark=value;observer();},getBearing:()=>bearing,layers:value=>layers=value,flush:()=>{for(const [id,fn] of frames){frames.delete(id);fn();}}};
}
const settle=()=>new Promise(setImmediate);
test('native 3D is opt-in, uses OpenFreeMap without a key and synchronises cameras without loops',async()=>{
 const h=setup();assert.equal(h.maps.length,0);h.api.setEnabled(true);await settle();const view=h.maps[0];view.events.load();
 assert.equal(view.options.style,'https://tiles.openfreemap.org/styles/liberty');assert.equal(view.options.accessToken,undefined);assert.equal(view.options.bearing,-30);
 h.map.setView([49,-124],12);assert.equal(view.jumps.at(-1).center[0],-124);
 view.center={lat:50,lng:-125};view.zoom=14;view.bearing=90;view.events.moveend();
 assert.equal(h.map.getCenter().lat,50);assert.equal(h.getBearing(),270);assert(view.jumps.length<5);
 h.api.setEnabled(false);assert(view.removed);assert(h.el('gregle-map-3d').hidden);
});
test('native map actions use 3D coordinates and selected pins retain their existing click handler',async()=>{
 const h=setup();h.api.setEnabled(true);await settle();const view=h.maps[0];view.events.load();let clicked,context;
 const layer={options:{alt:'Map pin'},toGeoJSON(){},getLatLng:()=>({lat:48.4,lng:-123.4}),getElement:()=>({innerHTML:'<svg></svg>'}),fire:(name,e)=>{clicked=e.originalEvent;}};
 h.layers([layer]);h.fire('layeradd');h.flush();assert.equal(h.markers.length,1);const event={stopPropagation(){}};h.markers[0].element.events.click(event);assert.equal(clicked,event);
 h.map.on('contextmenu',e=>context=e);view.events.contextmenu({lngLat:{lat:48.4,lng:-123.4},point:{x:100,y:200},originalEvent:{preventDefault(){}}});assert.equal(context.latlng.lng,-123.4);assert.equal(context.containerPoint.x,100);
 h.layers([]);h.fire('layerremove');h.flush();assert(h.markers[0].removed);
});
test('cancelled startup cannot recreate a map and a failed startup returns control to 2D',async()=>{
 const h=setup();h.api.setEnabled(true);h.api.setEnabled(false);await settle();assert.equal(h.maps.length,0);
 h.api.setEnabled(true);await settle();const view=h.maps[0];[...h.timers.values()].find(t=>t.ms===20000).f();assert.equal(h.errors.length,1);assert(view.removed);assert.equal(h.api.active,false);
});


test('dark startup retains 3D buildings and theme changes restore UI geometry without moving the camera or pin',async()=>{
 const h=setup({dark:true});h.api.setEnabled(true);await settle();const view=h.maps[0];
 const layer={options:{alt:'Map pin'},toGeoJSON(){},getLatLng:()=>({lat:48.4,lng:-123.4}),getElement:()=>({innerHTML:'<svg></svg>'}),fire(){}};h.layers([layer]);
 view.events.load();assert.equal(view.options.style,'https://tiles.openfreemap.org/styles/dark');
 assert.equal(view.getLayer('gregle-dark-buildings').type,'fill-extrusion');assert.equal(view.getLayer('gregle-dark-buildings').before,'labels');assert.deepEqual(view.zoomRanges[0],['building',12,14]);assert.equal(h.markers.length,1);
 const center=JSON.stringify(view.center),bearing=view.bearing;
 h.theme(false);view.events['style.load']();assert.equal(view.styles.at(-1),'https://tiles.openfreemap.org/styles/liberty');assert(view.getSource('gregle-ui'));assert(!view.getLayer('gregle-dark-buildings'));
 h.theme(true);view.events['style.load']();assert(view.getLayer('gregle-dark-buildings'));assert.equal(h.markers.length,1);assert.equal(JSON.stringify(view.center),center);assert.equal(view.bearing,bearing);
 h.api.setEnabled(false);const calls=view.styles.length;h.theme(false);assert.equal(view.styles.length,calls);
});
