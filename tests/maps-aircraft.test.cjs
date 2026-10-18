const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-aircraft-core.js'),maps=require('../assets/maps-core.js');
const start=Date.parse('2026-10-18T04:00:00Z');
const aircraft=(values={})=>({hex:'a12345',flight:'TEST123 ',r:'N123',t:'B738',desc:'Test aircraft',lat:48.4284,lon:-123.3656,alt_baro:30000,gs:400,track:90,seen_pos:1,...values});
const packet=(now=start,items=[aircraft()])=>({now,ac:items});
test('aircraft queries cover the viewport, handle wrapped worlds and stop at the source limit',()=>{
 const box=[-123.5,48.3,-123.2,48.5],a=core.area(box,13);assert(a);assert(core.covers(a,box));assert(a.radius>=10&&a.radius<=250);assert.equal(a.radius%10,0);
 const wrapped=core.area(box.map((x,i)=>i%2===0?x+360:x),13);assert.deepEqual(wrapped,a);
 const dateline=core.area([179.9,-.1,180.1,.1],13);assert(dateline);assert(core.covers(dateline,[179.9,-.1,180.1,.1]));assert(core.visible([0,-179.99],[179.9,-.1,180.1,.1]));assert(!core.visible([0,0],[179.9,-.1,180.1,.1]));
 for(const b of [[-180,-80,180,80],[0,0,20,20],[0,1,1,0],[NaN,0,1,1]])assert.equal(core.area(b,13),null);
 assert.equal(core.area(box,6),null);assert(!core.covers(a,[0,0,1,1]));
});
test('feed validation rejects stale positions and vehicles, preserves zero values, deduplicates and bounds results',()=>{
 const result=core.read(packet(start,[aircraft(),aircraft({seen_pos:0,track:0,gs:0,alt_baro:0}),aircraft({hex:'a12346',category:'C1'}),aircraft({hex:'bad'}),aircraft({hex:'a12347',lat:null}),aircraft({hex:'a12348',seen_pos:121}),aircraft({hex:'~a12349',alt_baro:'ground'})]),start);
 assert.equal(result.aircraft.length,2);assert.equal(result.aircraft[0].callsign,'TEST123');assert.equal(result.aircraft[0].altitude,0);assert.equal(result.aircraft[0].heading,0);assert.equal(result.aircraft[0].speed,0);assert(result.aircraft[1].ground);
 assert.throws(()=>core.read(packet(start-130000),start));assert.throws(()=>core.read({now:start,ac:null},start));assert.throws(()=>core.read(packet(start+60000),start));
 assert.equal(core.read(packet(start,[aircraft({seen_pos:70})]),start+51000).aircraft.length,0);
 const many=core.read(packet(start,Array.from({length:1600},(_,i)=>aircraft({hex:i.toString(16).padStart(6,'0')}))),start);assert(many.limited);assert.equal(many.aircraft.length,1500);
});
test('live aircraft preferences stay independent of aviation charts and round-trip in shared links',()=>{
 const state=maps.normalizeLayers({aircraft:true,aviation:false,google:true});assert(state.aircraft);assert(!state.aviation);assert(!maps.normalizeLayers({aircraft:'true'}).aircraft);
 assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView,null,state)),state);
 assert(maps.readLayers('#base=plugshare&overlays=aircraft,aviation').aircraft);
});
test('aircraft symbols use model codes rather than flight names, speed or altitude',()=>{
 const cases=[
  [{t:'R44',desc:'ROBINSON R-44 Raven'},'helicopter'],[{t:'B407',desc:'BELL 407'},'helicopter'],[{t:'EC35'},'helicopter'],
  [{t:'',desc:'AIRBUS HELICOPTERS H145'},'helicopter'],[{t:'',desc:'H2T'},'helicopter'],[{t:'',category:'A7'},'helicopter'],
  [{t:'C172',desc:''},'small-plane'],[{t:'P28A'},'small-plane'],[{t:'DHC2'},'small-plane'],[{t:'C208'},'small-plane'],[{t:'PC12'},'small-plane'],
  [{t:'',desc:'CESSNA 182 Skylane'},'small-plane'],[{t:'',desc:'L1P'},'small-plane'],[{t:' c152 '},'small-plane'],
  [{t:'B738',desc:'BOEING 737-800',gs:65,alt_baro:500},'airliner'],[{t:'C700',desc:'CESSNA 700 Citation Longitude'},'airliner'],
  [{t:'PC24'},'airliner'],[{t:'',desc:'',flight:'HELICOPTER C172',gs:50,alt_baro:1000},'airliner'],[{t:'<script>bad</script>',desc:''},'airliner']
 ];
 for(const [values,kind] of cases)assert.equal(core.read(packet(start,[aircraft(values)]),start).aircraft[0].kind,kind,JSON.stringify(values));
});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(){
 let now=start,box=[-123.5,48.3,-123.2,48.5],zoom=13,nextTimer=0,impl=async()=>({ok:true,json:async()=>packet(now)});
 const calls=[],timers=new Map(),events={},groups=[],credits=new Set(),nodes={};
 const element=()=>({style:{},children:[],events:{},dataset:{},textContent:'',append(...items){this.children.push(...items);},addEventListener(k,f){this.events[k]=f;}});
 const output=nodes['aircraft-layer-status']=element(),refresh=nodes['aircraft-refresh']=element();
 const map={getBounds:()=>({getWest:()=>box[0],getSouth:()=>box[1],getEast:()=>box[2],getNorth:()=>box[3]}),getCenter:()=>({lng:(box[0]+box[2])/2}),getZoom:()=>zoom,getSize:()=>({x:390,y:700}),on:(k,f)=>events[k]=f,removeLayer(){},attributionControl:{addAttribution:c=>credits.add(c),removeAttribution:c=>credits.delete(c)}};
 const L={layerGroup(){const g={children:new Set(),removeLayer(m){this.children.delete(m);},clearLayers(){this.children.clear();},addTo(){return this;}};groups.push(g);return g;},divIcon:o=>o,marker:(point,options)=>({point,options,pop:{options:{}},bindPopup(fn){this.popup=fn;return this;},getPopup(){return this.pop;},setLatLng(p){this.point=p;return this;},setIcon(icon){this.options.icon=icon;return this;},setPopupContent(fn){this.popup=fn;return this;},addTo(g){g.children.add(this);return this;}})};
 class Clock extends Date{static now(){return now;}}
 const c={L,Date:Clock,URL,URLSearchParams,AbortController,Map,Set,Math,Number,JSON,GregleMaps:maps,GregleAircraftCore:core,document:{hidden:false,getElementById:id=>nodes[id],createElement:element,addEventListener:(k,f)=>events[k]=f},addEventListener:(k,f)=>events[k]=f,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout:id=>timers.delete(id),fetch(url,opts){calls.push({url,...opts,time:now});return impl(url,opts);}};
 c.window=c;vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-aircraft.js'),'utf8'),c);const api=c.GregleAircraft({map,notify(){}});
 async function advance(ms){const end=now+ms;for(let i=0;i<1000;i++){const due=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!due){now=end;await flush();return;}now=due[1].due;timers.delete(due[0]);due[1].fn();await flush();}throw Error('Timer loop');}
 return {api,calls,output,refresh,events,credits,document:c.document,setFetch:fn=>impl=fn,advance,markers:()=>[...groups[0].children],async move(b,z=zoom){box=b;zoom=z;events.moveend();await advance(650);}};
}
test('aircraft stay opt-in, update markers in place and rate-limit panning/refreshes',async()=>{
 const h=setup();await h.advance(60000);assert.equal(h.calls.length,0);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);assert.equal(h.markers().length,1);const marker=h.markers()[0];assert.equal(h.credits.size,1);
 await h.move([-123.45,48.3,-123.15,48.5]);h.refresh.events.click();await flush();assert.equal(h.calls.length,1);await h.advance(15000);assert.equal(h.calls.length,2);assert.equal(h.markers()[0],marker);assert(h.calls[1].time-h.calls[0].time>=15000);
 for(const call of h.calls){assert.equal(new URL(call.url).hostname,'gregle-aircraft.square-rain-5ded.workers.dev');assert.equal(call.credentials,'omit');assert(+new URL(call.url).searchParams.get('radius')<=250);}
 h.api.setEnabled(false);assert.equal(h.markers().length,0);assert.equal(h.credits.size,0);const count=h.calls.length;await h.advance(60000);assert.equal(h.calls.length,count);
});
test('moving during a request keeps a single flight query and schedules the latest view',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);await h.move([-.1,51,.1,51.2]);assert.equal(h.calls.length,1);assert(!h.calls[0].signal.aborted);
 release({ok:true,json:async()=>packet(start)});await flush();assert.equal(h.markers().length,0);await h.advance(15000);assert.equal(h.calls.length,2);assert.equal(new URL(h.calls[1].url).searchParams.get('lat'),'51.1');h.api.setEnabled(false);assert(h.calls[1].signal.aborted);
});
test('rate limits survive toggles, stale markers expire during outages and recovery resumes polling',async()=>{
 const h=setup();h.api.setEnabled(true);await flush();h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '120'}}));await h.advance(15000);assert.equal(h.calls.length,2);assert.equal(h.markers().length,1);assert.match(h.output.textContent,/unavailable/);
 h.api.setEnabled(false);h.api.setEnabled(true);h.refresh.events.click();await flush();assert.equal(h.calls.length,2);await h.advance(119000);assert.equal(h.calls.length,2);
 h.setFetch(async()=>({ok:true,json:async()=>packet(start+135000)}));await h.advance(1000);assert.equal(h.calls.length,3);assert.equal(h.markers().length,1);
 const stale=setup();stale.api.setEnabled(true);await flush();stale.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '600'}}));await stale.advance(125000);assert.equal(stale.markers().length,0);assert.equal(stale.calls.length,2);
});
test('hidden, disabled and bfcache pages cancel in-flight requests and ignore late results',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);h.document.hidden=true;h.events.visibilitychange();assert(h.calls[0].signal.aborted);release({ok:true,json:async()=>packet(start)});await flush();assert.equal(h.markers().length,0);await h.advance(60000);assert.equal(h.calls.length,1);
 h.setFetch(async()=>({ok:true,json:async()=>packet(start+60000)}));h.document.hidden=false;h.events.visibilitychange();await flush();assert.equal(h.calls.length,2);h.events.pagehide();await h.advance(60000);assert.equal(h.calls.length,2);h.events.pageshow({persisted:true});await flush();assert.equal(h.calls.length,3);
});
test('zoomed-out maps pause queries and position details use safe text and reported units',async()=>{
 const h=setup();await h.move([-180,-80,180,80],3);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,0);assert.match(h.output.textContent,/Zoom in/);
 h.setFetch(async()=>({ok:true,json:async()=>packet(start,[aircraft({flight:'<img src=x onerror=alert(1)>',baro_rate:500,squawk:'1200'})])}));await h.move([-123.5,48.3,-123.2,48.5],13);assert.equal(h.calls.length,1);
 const marker=h.markers()[0],box=marker.popup();const text=e=>e.textContent+' '+e.children.map(text).join(' ');const content=text(box);assert(content.includes('<img src=x onerror=alert(1)>'));assert(content.includes('30,000 ft'));assert(content.includes('400 kn'));assert(content.includes('90°'));assert.equal(box.children.filter(x=>x.tagName==='IMG').length,0);assert.equal(marker.options.bubblingMouseEvents,false);
});
test('live markers show distinct helicopter and small-plane shapes and update type and heading in place',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>packet(start,[aircraft({t:'R44',track:0}),aircraft({hex:'a12346',t:'C172',track:180}),aircraft({hex:'a12347',t:'B738',track:null})])}));
 h.api.setEnabled(true);await flush();const [helicopter,small,jet]=h.markers();
 assert.match(helicopter.options.icon.className,/aircraft-helicopter/);assert.match(helicopter.options.title,/^Helicopter:/);assert.match(helicopter.options.icon.html,/rotate\(0deg\)/);
 assert.match(small.options.icon.className,/aircraft-small-plane/);assert.match(small.options.title,/^Small plane:/);assert.match(small.options.icon.html,/rotate\(180deg\)/);
 assert.match(jet.options.icon.className,/aircraft-airliner/);assert.match(jet.options.icon.html,/rotate\(0deg\)/);assert.notEqual(helicopter.options.icon.html,small.options.icon.html);
 h.setFetch(async()=>({ok:true,json:async()=>packet(start+15000,[aircraft({t:'C172',track:270})])}));await h.advance(15000);
 assert.equal(h.markers()[0],helicopter);assert.match(helicopter.options.icon.className,/aircraft-small-plane/);assert.match(helicopter.options.title,/^Small plane:/);assert.match(helicopter.options.icon.html,/rotate\(270deg\)/);
});
