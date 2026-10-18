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
function setup(options={}){
 let now=options.now??Date.parse('2026-10-18T02:30:00Z'),bounds=[-123.4,48.4,-123.3,48.5],zoom=13,nextTimer=0,fetchImpl=async()=>({ok:true,json:async()=>packet});
 const storage=options.storage||new Map(),localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(options.storageFails)throw Error('storage full');storage.set(key,value);},removeItem:key=>storage.delete(key)};
 const calls=[],timers=new Map(),listeners={},groups=[],output={dataset:{}},retry={addEventListener:(type,fn)=>listeners.retry=fn};
 const map={getBounds:()=>({getWest:()=>bounds[0],getSouth:()=>bounds[1],getEast:()=>bounds[2],getNorth:()=>bounds[3]}),getZoom:()=>zoom,getSize:()=>({x:1440,y:900}),on:(type,fn)=>listeners[type]=fn,removeLayer(){},attributionControl:{addAttribution(){},removeAttribution(){}}};
 const L={layerGroup(){const g={children:new Set(),removeLayer(m){this.children.delete(m);},clearLayers(){this.children.clear();},addTo(){return this;}};groups.push(g);return g;},divIcon:o=>o,marker:(point,options)=>({point,options,bindPopup(fn){this.popup=fn;return this;},setLatLng(p){this.point=p;return this;},setIcon(icon){this.options.icon=icon;return this;},setPopupContent(fn){this.popup=fn;return this;},addTo(g){g.children.add(this);return this;}})};
 class Clock extends Date{static now(){return now;}}
 const c={L,localStorage,Date:Clock,URL,URLSearchParams,AbortController,Map,Set,Math,Number,JSON,GregleMaps:maps,GregleEVCore:core,document:{hidden:false,getElementById:id=>id==='ev-retry'?retry:output,addEventListener:(type,fn)=>listeners[type]=fn},addEventListener:(type,fn)=>listeners[type]=fn,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},fetch(url,options){calls.push({url,...options});return fetchImpl(url,options);}};
 c.window=c;vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-ev.js'),'utf8'),c);const api=c.GregleEVCharging({map,config:{evURL:options.endpoint||'https://overpass-api.de/api/interpreter',evProvider:options.provider,evOSMURL:options.osmEndpoint,evSource:options.source},notify(){}});
 async function advance(ms){const target=now+ms;for(let i=0;i<200;i++){const due=[...timers.entries()].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!due){now=target;await flush();return;}now=due[1].due;timers.delete(due[0]);due[1].fn();await flush();}throw Error('Timer loop');}
 return {api,storage,calls,output,retry,advance,listeners,document:c.document,setFetch:fn=>fetchImpl=fn,markers:()=>[...groups[0].children],async move(b,z=zoom){bounds=b;zoom=z;listeners.moveend();await advance(650);}};
}
test('charging is opt-in, zoom-gated and cached panning preserves markers without polling',async()=>{
 const h=setup();assert.equal(h.calls.length,0);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'POST');const marker=h.markers()[0];await h.move([-123.39,48.41,-123.31,48.49]);assert.equal(h.markers()[0],marker);assert.equal(h.calls.length,1);await h.advance(300000);assert.equal(h.calls.length,1);await h.move([-180,-85,180,85],5);assert.equal(h.markers().length,0);h.api.setEnabled(false);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);
});
test('panning during a query keeps one request and then loads the newest view',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);await h.move([-.1,51,.1,51.1]);assert.equal(h.calls.length,1);assert(!h.calls[0].signal.aborted);release({ok:true,json:async()=>packet});await flush();assert.equal(h.markers().length,0);await h.advance(10000);assert.equal(h.calls.length,2);assert(h.calls[1].body.get('data').includes('51'));h.api.setEnabled(false);assert(h.calls[1].signal.aborted);
});
test('EV failures preserve cached stations, respect Retry-After across toggles and retry manually',async()=>{
 const h=setup();h.api.setEnabled(true);await flush();await h.advance(86401000);h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '600'}}));await h.move([-123.39,48.41,-123.31,48.49]);assert.equal(h.calls.length,2);assert.equal(h.markers().length,2);assert(!h.retry.hidden);h.api.setEnabled(false);h.api.setEnabled(true);await flush();h.listeners.retry();await flush();assert.equal(h.calls.length,2);await h.advance(900000);assert.equal(h.calls.length,2);h.setFetch(async()=>({ok:true,json:async()=>packet}));h.listeners.retry();await flush();assert.equal(h.calls.length,3);assert(h.retry.hidden);
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

test('saved charging areas load on a new page without a network request and reuse all-station coverage for Tesla',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>teslaPacket}));h.api.setSelection(true,true);await flush();assert(h.storage.get('gregle-maps-ev-cache-v1'));
 const restored=setup({storage:h.storage});restored.api.setSelection(true,true);await flush();assert.equal(restored.calls.length,0);assert.equal(restored.markers().length,3);assert(restored.markers().some(m=>m.options.icon.className.includes('supercharger')));assert.match(restored.output.textContent,/saved locations/);
 restored.api.setSelection(false,true);await flush();assert.equal(restored.calls.length,0);assert.equal(restored.markers().length,1);
});

test('a saved area refreshes after a day, keeps locations on failure and expires after seven days',async()=>{
 const h=setup();h.api.setEnabled(true);await flush();const before=h.storage.get('gregle-maps-ev-cache-v1'),initial=Date.parse('2026-10-18T02:30:00Z');
 const old=setup({storage:h.storage,now:initial+86401000});let release;old.setFetch(()=>new Promise(resolve=>release=resolve));old.api.setEnabled(true);assert.equal(old.markers().length,2);assert.equal(old.calls.length,1);
 release({ok:false,status:503,headers:{get:()=>null}});await flush();assert.equal(old.markers().length,2);assert.match(old.output.textContent,/Cached locations/);assert.equal(old.storage.get('gregle-maps-ev-cache-v1'),before);
 const expired=setup({storage:h.storage,now:initial+604800000});expired.setFetch(()=>new Promise(()=>{}));expired.api.setEnabled(true);assert.equal(expired.markers().length,0);assert.equal(expired.calls.length,1);expired.api.setEnabled(false);
});

test('invalid caches, changed providers and unavailable storage never prevent a new query',async()=>{
 for(const value of ['{broken',JSON.stringify({endpoint:'https://elsewhere.test',entries:[]}),JSON.stringify({endpoint:'https://overpass-api.de/api/interpreter',entries:[{data:packet,area:[0,0,360,90],scope:'all',time:Date.now()}]})]){
  const h=setup({storage:new Map([['gregle-maps-ev-cache-v1',value]])});h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);assert.equal(h.markers().length,2);
 }
 const h=setup({storageFails:true});h.api.setEnabled(true);await flush();assert.equal(h.markers().length,2);assert.equal(h.output.dataset.state,'ready');
});

test('saved Tesla-only areas cannot supply all chargers after a page reload',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>teslaPacket}));h.api.setSelection(false,true);await flush();
 const restored=setup({storage:h.storage});restored.api.setSelection(true,true);await flush();assert.equal(restored.calls.length,1);assert(!restored.calls[0].body.get('data').includes('Q17089620'));
});

test('saved cache validation rejects future times, expired data and invalid scopes; query areas use reusable grid bounds',()=>{
 const now=Date.parse('2026-10-18T02:30:00Z'),entry={data:packet,area:[-123.5,48.3,-123.2,48.6],scope:'all',time:now};
 assert.equal(core.readCache(entry,now).stations.length,2);
 for(const bad of [{...entry,time:now+1},{...entry,time:now-604800000},{...entry,scope:'anything'},{...entry,area:['-123.5',48.3,-123.2,48.6]},{...entry,data:{elements:[],remark:'incomplete'}}])assert.throws(()=>core.readCache(bad,now));
 const a=core.area([-123.399,48.401,-123.301,48.499],13),b=core.area([-123.398,48.402,-123.302,48.498],13);assert.deepEqual(a,b);assert(core.contains(a,[-123.399,48.401,-123.301,48.499]));
 const close=core.area([-123.366,48.429,-123.364,48.431],18);assert(close[2]-close[0]<.01);assert(close[3]-close[1]<.01);
});
const ocmPacket=(time=Date.parse('2026-10-18T02:30:00Z'))=>({source:'openchargemap',fetchedAt:time,locations:[{ID:123,AddressInfo:{Title:'Tesla Supercharger',Latitude:48.43,Longitude:-123.36,RelatedURL:'javascript:alert(1)'},DataProvider:{Title:'Open Charge Map Contributors',WebsiteURL:'https://openchargemap.org',License:'CC BY 4.0',IsOpenDataLicensed:true},OperatorInfo:{Title:'Tesla (Supercharger)'},UsageType:{Title:'Public - Membership Required'},Connections:[{Quantity:12,PowerKW:250,ConnectionType:{Title:'NACS'}}]}]});
test('OCM station parsing retains licences, rejects unsafe URLs and distinguishes Superchargers from Destination sites',()=>{
 const data=ocmPacket(),s=core.read(data).stations[0];assert.equal(s.id,'ocm/123');assert(s.supercharger);assert.equal(s.connectors[0].output,'250 kW');assert.equal(s.provider.licenseURL,'https://creativecommons.org/licenses/by/4.0/');assert.equal(s.tags.website,'');assert.equal(s.provider.name,'Open Charge Map Contributors');
 const destination=structuredClone(data);destination.locations[0].AddressInfo.Title='Tesla Destination';destination.locations[0].OperatorInfo.Title='Tesla (Destination)';assert(!core.read(destination).stations[0].supercharger);
 const restricted=structuredClone(data);restricted.locations[0].UsageType.Title='Private - For Staff, Visitors or Customers';assert(core.read(restricted).stations[0].restricted);
 const noLicense=structuredClone(data);delete noLicense.locations[0].DataProvider.License;assert.equal(core.read(noLicense).stations.length,0);
 const entry={area:[-123.4,48.4,-123.3,48.5],time:data.fetchedAt,scope:'all',data};assert.equal(core.readCache(entry,data.fetchedAt).stations.length,1);assert.throws(()=>core.readCache({...entry,time:data.fetchedAt-1},data.fetchedAt));
});
test('OCM browser requests use the relay without credentials or polling, share Tesla coverage and retain fetch times',async()=>{
 const h=setup({provider:'openchargemap',endpoint:'https://gregle-ev.square-rain-5ded.workers.dev/charging'});
 // The source-credit panel is absent from this focused map harness.
 h.document.getElementById=id=>id==='ev-retry'?h.retry:id==='ev-layer-status'?h.output:null;
 h.setFetch(async()=>({ok:true,json:async()=>ocmPacket()}));h.api.setSelection(false,true);await flush();assert.equal(h.calls[0].method,'GET');assert.equal(h.calls[0].credentials,'omit');assert(!h.calls[0].body);assert(!h.calls[0].headers);assert.equal(new URL(h.calls[0].url).searchParams.get('scope'),'all');assert.equal(h.markers().length,1);
 h.api.setSelection(true,true);await flush();await h.advance(300000);assert.equal(h.calls.length,1);
 const saved=JSON.parse(h.storage.get('gregle-maps-ev-cache-v1'));assert.equal(saved.entries[0].time,ocmPacket().fetchedAt);assert.equal(saved.entries[0].data.locations[0].DataProvider.License,'CC BY 4.0');
});
test('switching EV sources keeps marker data and saved caches separate and reuses earlier coverage',async()=>{
 const h=setup({provider:'openchargemap',endpoint:'https://gregle-ev.square-rain-5ded.workers.dev/charging',osmEndpoint:'https://gregle-ev.square-rain-5ded.workers.dev/charging?source=osm'});
 h.document.getElementById=id=>id==='ev-retry'?h.retry:id==='ev-layer-status'?h.output:null;
 h.setFetch(async url=>({ok:true,json:async()=>new URL(url).searchParams.get('source')==='osm'?{...packet,fetchedAt:ocmPacket().fetchedAt}:ocmPacket()}));
 h.api.setSelection(true,true);await flush();assert.equal(h.markers().length,1);assert(h.markers()[0].options.title.includes('Tesla Supercharger'));
 h.api.setSource('openstreetmap');assert.equal(h.markers().length,0);await flush();assert.equal(h.markers().length,2);assert(h.markers().every(m=>!m.options.title.includes('Tesla Supercharger')));assert.equal(new URL(h.calls[1].url).searchParams.get('source'),'osm');
 assert(h.storage.has('gregle-maps-ev-cache-v1'));assert(h.storage.has('gregle-maps-ev-cache-v1-osm'));assert.notEqual(JSON.parse(h.storage.get('gregle-maps-ev-cache-v1')).endpoint,JSON.parse(h.storage.get('gregle-maps-ev-cache-v1-osm')).endpoint);
 h.api.setSource('openchargemap');await flush();assert.equal(h.markers().length,1);assert(h.markers()[0].options.title.includes('Tesla Supercharger'));assert.equal(h.calls.length,2);
 h.api.setSource('openstreetmap');await flush();assert.equal(h.markers().length,2);assert.equal(h.calls.length,2);
});
test('switching EV sources aborts pending requests and ignores late results from the previous source',async()=>{
 const h=setup({provider:'openchargemap',endpoint:'https://gregle-ev.square-rain-5ded.workers.dev/charging',osmEndpoint:'https://gregle-ev.square-rain-5ded.workers.dev/charging?source=osm'});
 h.document.getElementById=id=>id==='ev-retry'?h.retry:id==='ev-layer-status'?h.output:null;
 let release;h.setFetch(url=>new URL(url).searchParams.has('source')?Promise.resolve({ok:true,json:async()=>({...packet,fetchedAt:ocmPacket().fetchedAt})}):new Promise(resolve=>release=resolve));
 h.api.setEnabled(true);h.api.setSource('openstreetmap');assert(h.calls[0].signal.aborted);await flush();assert.equal(h.markers().length,2);
 release({ok:true,json:async()=>ocmPacket()});await flush();assert.equal(h.markers().length,2);assert(h.markers().every(m=>!m.options.title.includes('Tesla Supercharger')));
});
