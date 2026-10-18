const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-ferries-core.js'),maps=require('../assets/maps-core.js');
const NOW=Date.parse('2026-10-18T02:30:00Z');
const packet={sources:{inland:'https://www.drivebc.ca/api/ferries/',coastal:'https://www.drivebc.ca/api/ferries/coastal/'},fetchedAt:new Date(NOW).toISOString(),ferries:[{id:'coastal/1',kind:'coastal',name:'Swartz Bay',point:[48.688614,-123.411361],routes:[{name:'Vancouver',url:'https://www.bcferries.com/schedule'}]},{id:'inland/2',kind:'inland',name:'Adams Lake',point:[50.956,-119.672],phone:'2502652105',vessels:[{schedule:'05:00 – 03:00',crossing_time_min:6}]}]};

test('ferry snapshot preserves both categories, service data, safe links and unique identities',()=>{
 const parsed=core.read(packet,NOW);assert.equal(parsed.ferries.length,2);assert.equal(parsed.ferries[1].vessels[0].crossing_time_min,6);assert.equal(parsed.ferries[1].phoneURL,'tel:2502652105');
 const unsafe=core.read({...packet,ferries:[{...packet.ferries[0],routes:[{name:'<img onerror=alert(1)>',url:'javascript:alert(1)'}]},packet.ferries[0],{...packet.ferries[1],point:[0,0]}]},NOW);
 assert.equal(unsafe.ferries.length,1);assert.equal(unsafe.ferries[0].routes[0].url,null);assert.equal(unsafe.ferries[0].routes[0].name,'<img onerror=alert(1)>');
 assert.throws(()=>core.read({...packet,fetchedAt:'2099-01-01T00:00Z'},NOW));assert.throws(()=>core.read({...packet,sources:{}},NOW));
});

test('ferries are opt-in and saved/shared independently from road reports and other DriveBC sublayers',()=>{
 assert.equal(maps.normalizeLayers(null).ferries,false);assert.equal(maps.normalizeLayers({ferries:'true'}).ferries,false);
 const layers=maps.normalizeLayers({ferries:true,webcams:true,messages:true});assert.equal(layers.drivebc,false);
 assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView,null,layers)),layers);
});

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function setup(){
 let now=NOW,bounds=[-123.6,48.5,-123.2,48.9],nextTimer=0,fetchImpl=async()=>({ok:true,json:async()=>packet});
 const calls=[],timers=new Map(),listeners={},groups=[],output={dataset:{}};
 const map={getBounds:()=>({getWest:()=>bounds[0],getSouth:()=>bounds[1],getEast:()=>bounds[2],getNorth:()=>bounds[3]}),getSize:()=>({x:1440,y:900}),on:(type,fn)=>listeners[type]=fn,removeLayer(){},attributionControl:{addAttribution(){},removeAttribution(){}}};
 const L={layerGroup(){const group={children:new Set(),removeLayer(marker){this.children.delete(marker);},clearLayers(){this.children.clear();},addTo(){return this;}};groups.push(group);return group;},divIcon:options=>options,marker:(point,options)=>({point,options,bindPopup(fn){this.popup=fn;return this;},setLatLng(point){this.point=point;return this;},setPopupContent(fn){this.popup=fn;return this;},addTo(group){group.children.add(this);return this;}})};
 class Clock extends Date{static now(){return now;}}
 const context={L,Date:Clock,URL,AbortController,Map,Set,Math,Number,JSON,GregleFerriesCore:core,document:{hidden:false,getElementById:()=>output,addEventListener:(type,fn)=>listeners[type]=fn},addEventListener:(type,fn)=>listeners[type]=fn,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},fetch(url,options){calls.push({url,signal:options.signal});return fetchImpl(url,options);}};
 context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-ferries.js'),'utf8'),context);
 const api=context.GregleDriveBCFerries({map,config:{ferriesURL:'/data/drivebc-ferries.json'},notify(){}});
 async function advance(ms){const target=now+ms;for(let i=0;i<200;i++){const due=[...timers.entries()].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!due){now=target;await flush();return;}now=due[1].due;timers.delete(due[0]);due[1].fn();await flush();}throw Error('Timer loop');}
 return {api,calls,output,advance,listeners,document:context.document,setFetch:fn=>fetchImpl=fn,markers:()=>[...groups[0].children],async move(next){bounds=next;listeners.moveend();await advance(150);}};
}

test('ferries stay idle until selected and panning reuses one snapshot while preserving marker identity',async()=>{
 const h=setup();assert.equal(h.calls.length,0);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);const marker=h.markers()[0];
 await h.move([-123.59,48.51,-123.21,48.89]);assert.equal(h.markers()[0],marker);
 await h.move([-119.8,50.8,-119.5,51.1]);assert.match(h.markers()[0].options.title,/Adams/);assert.equal(h.calls.length,1);
 await h.move([-.1,51,.1,52]);assert.equal(h.markers().length,0);await h.move([236.4,48.5,236.8,48.9]);assert.match(h.markers()[0].options.title,/Swartz/);assert.equal(h.calls.length,1);
});

test('ferry backoff survives toggles and cached coverage recovers after a rate limit',async()=>{
 const h=setup();h.api.setEnabled(true);await flush();h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '600'}}));await h.advance(300000);assert.equal(h.calls.length,2);
 h.api.setEnabled(false);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,2);assert.equal(h.markers().length,1);
 h.setFetch(async()=>({ok:true,json:async()=>packet}));await h.advance(599999);assert.equal(h.calls.length,2);await h.advance(1);assert.equal(h.calls.length,3);assert.equal(h.output.dataset.state,'ready');
});

test('hidden or disabled ferry layers abort pending work and ignore late responses',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);h.document.hidden=true;h.listeners.visibilitychange();assert(h.calls[0].signal.aborted);
 h.api.setEnabled(false);release({ok:true,json:async()=>packet});await flush();assert.equal(h.markers().length,0);await h.advance(300000);assert.equal(h.calls.length,1);
});
