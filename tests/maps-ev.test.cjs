const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-ev-core.js'),maps=require('../assets/maps-core.js');
const packet={elements:[{type:'node',id:1,lat:48.4284,lon:-123.3656,tags:{amenity:'charging_station',name:'Test EV',access:'customers','socket:type1':'2','socket:type1:output':'7.2 kW','socket:chademo':'0'}},{type:'way',id:2,center:{lat:48.43,lon:-123.36},tags:{amenity:'charging_station','socket:type1_combo':'yes'}}]};
test('EV requests are bounded and split dateline areas into valid boxes',()=>{
 assert.equal(core.area([-123.4,48.4,-123.3,48.5],11),null);assert.equal(core.area([-180,-85,180,85],12),null);assert.equal(core.area([0,2,1,1],14),null);
 const a=core.area([179.9,0,180.1,.1],13),q=core.query(a);assert(a[2]>180);assert(q.includes(',180);'));assert(q.includes(',-180,'));assert(q.endsWith('out center 751;'));
 assert(core.contains(a,[-180.01,.02,-179.99,.08]));assert(!core.contains(a,[-100,.02,-99,.08]));
});
test('EV data validates identities/centres, records connectors and rejects partial server results',()=>{
 const p=core.read(packet);assert.equal(p.stations.length,2);assert.equal(p.stations[0].id,'node/1');assert(p.stations[0].restricted);assert.deepEqual(p.stations[0].connectors,[{name:'J1772 (Type 1)',count:2,output:'7.2 kW'}]);assert.equal(p.stations[1].connectors[0].count,null);
 const dirty=core.read({elements:[packet.elements[0],packet.elements[0],{...packet.elements[1],center:{lat:100,lon:0}},{...packet.elements[0],id:3,tags:{amenity:'charging_station',motorcar:'no'}},{...packet.elements[0],id:4,tags:{amenity:'cafe'}}]});assert.equal(dirty.stations.length,1);assert.throws(()=>core.read({elements:[],remark:'runtime error: timeout'}));assert.throws(()=>core.read({}));
 const many=core.read({elements:Array.from({length:751},(_,i)=>({...packet.elements[0],id:i+1}))});assert(many.truncated);assert.equal(many.stations.length,750);
});
test('PlugShare links preserve visible centre/spans and EV choices round-trip independently',()=>{
 const a=new URL(maps.plugshareURL({lat:48.4284,lng:-123.3656},[-123.4,48.4,-123.3,48.5]));assert.equal(a.origin,'https://www.plugshare.com');assert.equal(+a.searchParams.get('latitude'),48.4284);assert.equal(+a.searchParams.get('spanLat'),.1);assert.equal(+a.searchParams.get('spanLng'),.1);
 const b=new URL(maps.plugshareURL({lat:0,lng:540},[179,-.01,181,.01]));assert.equal(+b.searchParams.get('longitude'),-180);assert.equal(+b.searchParams.get('spanLng'),2);assert.equal(+b.searchParams.get('spanLat'),.02);
 const layers=maps.normalizeLayers({ev:true});assert.equal(layers.drivebc,false);assert.equal(maps.normalizeLayers(null).ev,false);assert.equal(maps.normalizeLayers({ev:'true'}).ev,false);assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView,null,layers)),layers);
});
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function setup(){
 let now=Date.parse('2026-10-18T02:30:00Z'),bounds=[-123.4,48.4,-123.3,48.5],zoom=13,nextTimer=0,fetchImpl=async()=>({ok:true,json:async()=>packet});
 const calls=[],timers=new Map(),listeners={},groups=[],output={dataset:{}},retry={addEventListener:(type,fn)=>listeners.retry=fn};
 const map={getBounds:()=>({getWest:()=>bounds[0],getSouth:()=>bounds[1],getEast:()=>bounds[2],getNorth:()=>bounds[3]}),getZoom:()=>zoom,getSize:()=>({x:1440,y:900}),on:(type,fn)=>listeners[type]=fn,removeLayer(){},attributionControl:{addAttribution(){},removeAttribution(){}}};
 const L={layerGroup(){const g={children:new Set(),removeLayer(m){this.children.delete(m);},clearLayers(){this.children.clear();},addTo(){return this;}};groups.push(g);return g;},divIcon:o=>o,marker:(point,options)=>({point,options,bindPopup(fn){this.popup=fn;return this;},setLatLng(p){this.point=p;return this;},setIcon(icon){this.options.icon=icon;return this;},setPopupContent(fn){this.popup=fn;return this;},addTo(g){g.children.add(this);return this;}})};
 class Clock extends Date{static now(){return now;}}
 const c={L,Date:Clock,URL,URLSearchParams,AbortController,Map,Set,Math,Number,JSON,GregleMaps:maps,GregleEVCore:core,document:{hidden:false,getElementById:id=>id==='ev-retry'?retry:output,addEventListener:(type,fn)=>listeners[type]=fn},addEventListener:(type,fn)=>listeners[type]=fn,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},fetch(url,options){calls.push({url,...options});return fetchImpl(url,options);}};
 c.window=c;vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-ev.js'),'utf8'),c);const api=c.GregleEVCharging({map,config:{evURL:'https://overpass-api.de/api/interpreter'},notify(){}});
 async function advance(ms){const target=now+ms;for(let i=0;i<200;i++){const due=[...timers.entries()].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!due){now=target;await flush();return;}now=due[1].due;timers.delete(due[0]);due[1].fn();await flush();}throw Error('Timer loop');}
 return {api,calls,output,retry,advance,listeners,document:c.document,setFetch:fn=>fetchImpl=fn,markers:()=>[...groups[0].children],async move(b,z=zoom){bounds=b;zoom=z;listeners.moveend();await advance(650);}};
}
test('charging is opt-in, zoom-gated and cached panning preserves markers without polling',async()=>{
 const h=setup();assert.equal(h.calls.length,0);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'POST');const marker=h.markers()[0];await h.move([-123.39,48.41,-123.31,48.49]);assert.equal(h.markers()[0],marker);assert.equal(h.calls.length,1);await h.advance(300000);assert.equal(h.calls.length,1);await h.move([-180,-85,180,85],5);assert.equal(h.markers().length,0);h.api.setEnabled(false);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);
});
test('panning during a query keeps one request and then loads the newest view',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);await h.move([-.1,51,.1,51.1]);assert.equal(h.calls.length,1);assert(!h.calls[0].signal.aborted);release({ok:true,json:async()=>packet});await flush();assert.equal(h.markers().length,0);await h.advance(10000);assert.equal(h.calls.length,2);assert(h.calls[1].body.get('data').includes('51'));h.api.setEnabled(false);assert(h.calls[1].signal.aborted);
});
test('EV failures preserve cached stations, respect Retry-After across toggles and retry manually',async()=>{
 const h=setup();h.api.setEnabled(true);await flush();await h.advance(601000);h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '600'}}));await h.move([-123.39,48.41,-123.31,48.49]);assert.equal(h.calls.length,2);assert.equal(h.markers().length,2);assert(!h.retry.hidden);h.api.setEnabled(false);h.api.setEnabled(true);await flush();h.listeners.retry();await flush();assert.equal(h.calls.length,2);await h.advance(900000);assert.equal(h.calls.length,2);h.setFetch(async()=>({ok:true,json:async()=>packet}));h.listeners.retry();await flush();assert.equal(h.calls.length,3);assert(h.retry.hidden);
});
test('hidden/disabled requests are aborted and late results cannot repopulate charging markers',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);h.document.hidden=true;h.listeners.visibilitychange();assert(h.calls[0].signal.aborted);h.api.setEnabled(false);release({ok:true,json:async()=>packet});await flush();assert.equal(h.markers().length,0);await h.advance(900000);assert.equal(h.calls.length,1);
});
test('zooming into truncated coverage requests a smaller area rather than keeping incomplete data',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>({elements:Array.from({length:751},(_,i)=>({...packet.elements[0],id:i+1}))})}));h.api.setEnabled(true);await flush();await h.advance(10000);assert.equal(h.calls.length,1);await h.move([-123.37,48.42,-123.36,48.44],16);assert.equal(h.calls.length,2);
});

test('Tesla classification recognises Superchargers and excludes Destination/third-party NACS chargers',()=>{
 const positive=[{brand:'Tesla Supercharger'},{network:'Tesla Supercharger'},{name:'Uptown Supercharger',operator:'Tesla'},{'brand:wikidata':'Q17089620'},{'ref:supercharge_info':'1234'},{website:'https://www.tesla.com/en_CA/findus/location/supercharger/victoriabcsupercharger'},{operator:'Tesla','socket:tesla_supercharger':'8'}];
 positive.forEach(tags=>assert.equal(core.isSupercharger(tags),true,JSON.stringify(tags)));
 const negative=[{}, {operator:'Tesla'},{brand:'Tesla','socket:nacs':'12'},{operator:'FLO','socket:nacs':'4'},{brand:'Tesla',network:'Tesla Destination','socket:tesla_supercharger':'2'},{brand:'Tesla','socket:tesla_supercharger':'0'},{website:'https://www.tesla.com.evil.example/findus/location/supercharger/fake'}];
 negative.forEach(tags=>assert.equal(core.isSupercharger(tags),false,JSON.stringify(tags)));
 const q=core.query([-123.4,48.4,-123.3,48.5],true);assert(q.includes('Q17089620'));assert(q.includes('ref:supercharge_info'));assert(!core.query([-123.4,48.4,-123.3,48.5]).includes('Q17089620'));
 const layers=maps.normalizeLayers({tesla:true});assert.equal(layers.ev,false);assert.equal(maps.normalizeLayers(null).tesla,false);assert.equal(maps.normalizeLayers({tesla:'true'}).tesla,false);assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView,null,layers)),layers);
});
const teslaPacket={elements:[...packet.elements,{type:'node',id:3,lat:48.432,lon:-123.367,tags:{amenity:'charging_station',name:'Uptown Supercharger',brand:'Tesla Supercharger','socket:nacs':'16','socket:nacs:output':'72 kW',opening_hours:'24/7'}}]};

test('Tesla can be shown alone, or highlighted among all chargers without duplicates or a second query',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>teslaPacket}));h.api.setEnabled(true);await flush();const marker=h.markers().find(m=>m.options.title.includes('Uptown'));assert.equal(h.markers().length,3);assert(!marker.options.icon.className.includes('supercharger'));
 h.api.setSuperchargers(true);await flush();assert.equal(h.calls.length,1);assert.equal(h.markers().length,3);assert.equal(h.markers().find(m=>m.options.title.includes('Uptown')),marker);assert(marker.options.icon.className.includes('supercharger'));
 h.api.setEnabled(false);await flush();assert.equal(h.markers().length,1);assert.equal(h.markers()[0],marker);assert.equal(h.calls.length,1);assert.match(h.output.textContent,/1 Tesla Supercharger/);
 h.api.setSelection(false,false);assert.equal(h.markers().length,0);
});

test('Tesla-only coverage cannot suppress a later request for all charging stations',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>teslaPacket}));h.api.setSuperchargers(true);await flush();assert(h.calls[0].body.get('data').includes('Q17089620'));assert.equal(h.markers().length,1);
 h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);await h.advance(10000);assert.equal(h.calls.length,2);assert(!h.calls[1].body.get('data').includes('Q17089620'));assert.equal(h.markers().length,3);
});

test('switching selection during a Tesla request preserves request scope and loads complete all-station coverage',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setSuperchargers(true);h.api.setEnabled(true);assert.equal(h.calls.length,1);assert(!h.calls[0].signal.aborted);
 release({ok:true,json:async()=>teslaPacket});await flush();await h.advance(10000);assert.equal(h.calls.length,2);assert(!h.calls[1].body.get('data').includes('Q17089620'));h.api.setSelection(false,false);assert(h.calls[1].signal.aborted);
});

test('truncated all-station coverage does not hide Superchargers behind the general result limit',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>({elements:Array.from({length:751},(_,i)=>({...packet.elements[0],id:i+1}))})}));h.api.setEnabled(true);await flush();h.setFetch(async()=>({ok:true,json:async()=>teslaPacket}));h.api.setSelection(false,true);await h.advance(10000);assert.equal(h.calls.length,2);assert(h.calls[1].body.get('data').includes('Q17089620'));assert.equal(h.markers().length,1);
});
