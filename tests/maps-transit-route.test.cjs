const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-transit-core.js'),fixture=require('./fixtures/transit-route-trip.json');
const row={tripId:fixture.selectedTripId,routeId:fixture.selectedRouteId,route:'21',headsign:'Interurban to Camosun only'},stop={id:'ca-bc-Victoria-Transit_100025',code:'100025',lat:48.42189,lng:-123.36409,modes:['BUS'],scope:'bc'};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function setup(){
 const elements=new Map(),events={},calls=[],groups=[],fits=[],classes=new Set();let impl=async()=>fixture;
 const get=id=>{if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',events:{},setAttribute(){},removeAttribute(){},addEventListener(k,f){this.events[k]=f;}});return elements.get(id);};
 const container={classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},focus(){}};
 const map={getContainer:()=>container,getSize:()=>({x:390,y:844}),closePopup(){},fitBounds:(points,options)=>fits.push({points,options}),removeLayer(){}};
 const layer=(kind,points,options)=>({kind,points,options,bindTooltip(label){this.label=label;return this;},addTo(group){group.children.push(this);return this;}});
 const L={layerGroup(){const group={children:[],clearLayers(){this.children=[];},addTo(){return this;}};groups.push(group);return group;},polyline:(p,o)=>layer('line',p,o),circleMarker:(p,o)=>layer('stop',p,o),latLngBounds:p=>p};
 const document={hidden:false,getElementById:get,createElement:()=>({textContent:''}),addEventListener:(k,f)=>events[k]=f};
 const context={L,document,AbortController,Map,Date,window:{GregleTransitCore:core,addEventListener:(k,f)=>events[k]=f}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-transit-route.js'),'utf8'),context);
 const api=context.window.GregleTransitRoute({map,canRequest:()=>true,requestJSON:(url,signal)=>{calls.push({url,signal});return impl(url,signal);}});
 return {api,get,calls,fits,classes,document,events,layers:()=>groups[0].children,setRequest:f=>impl=f};
}
test('route selection draws the matching trip, labelled stops and a contrasting line, then clears cleanly',async()=>{
 const h=setup();await h.api.show(row,stop);assert.equal(h.calls.length,0);
 h.api.setEnabled(true);await h.api.show(row,stop);
 assert.equal(h.calls.length,1);assert.equal(h.layers().filter(l=>l.kind==='line').length,2);assert(h.layers().some(l=>l.kind==='stop'&&l.options.radius===8));assert(h.classes.has('transit-route-active'));assert.equal(h.get('transit-route-title').textContent,'Route 21');assert(h.fits.length);
 await h.api.show(row,stop);assert.equal(h.calls.length,1,'reuse the selected trip cache');
 h.get('transit-route-clear').events.click();assert.equal(h.layers().length,0);assert.equal(h.get('transit-route-card').hidden,true);assert.equal(h.classes.size,0);
});
test('switching maps or hiding the page aborts loading and ignores late route data',async()=>{
 const h=setup();let release;h.setRequest(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);const pending=h.api.show(row,stop);await flush();assert.equal(h.calls.length,1);
 h.api.setEnabled(false);assert(h.calls[0].signal.aborted);release(fixture);await pending;assert.equal(h.layers().length,0);assert.equal(h.get('transit-route-card').hidden,true);
 const hidden=setup();hidden.setRequest(()=>new Promise(resolve=>release=resolve));hidden.api.setEnabled(true);const task=hidden.api.show(row,stop);await flush();hidden.document.hidden=true;hidden.events.visibilitychange();assert(hidden.calls[0].signal.aborted);release(fixture);await task;assert.equal(hidden.layers().length,0);assert.equal(hidden.get('transit-route-retry').hidden,false);
});
test('missing geometry gives a retry state without inventing a straight-line route',async()=>{
 const h=setup();h.setRequest(async()=>({legs:[]}));h.api.setEnabled(true);await h.api.show(row,stop);assert.equal(h.layers().length,0);assert.equal(h.get('transit-route-retry').hidden,false);assert.match(h.get('transit-route-status').textContent,/could not load/);assert.equal(h.classes.size,0);
});
