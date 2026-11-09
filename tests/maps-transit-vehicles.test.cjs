const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('../assets/maps-transit-core.js');
const NOW=1794255617000,routeId='ca-bc-Victoria-Transit_4-VIC',route={routeId,route:'4'};
const payload=(extra={})=>({supported:true,routeId,source:'BC Transit',maxAgeSeconds:120,now:NOW,timestamp:NOW,vehicles:[{id:'bus1',label:'1234',routeId:'4-VIC',lat:48.43,lng:-123.36,observed:NOW-5000}],...extra});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(){
 let now=NOW,impl=async()=>new Response(JSON.stringify(payload()));const elements=new Map(),events={},timers=new Map(),calls=[],children=[];let timerId=0;
 const element=()=>({textContent:'',hidden:true,children:[],append(...nodes){this.children.push(...nodes);},setAttribute(){}});
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const group={addTo(){return this;},clearLayers(){children.length=0;},removeLayer(marker){children.splice(children.indexOf(marker),1);}};
 const marker=(point,options)=>({point,options,bindPopup(p){this.popup=p;return this;},bindTooltip(t){this.tooltip=t;return this;},setPopupContent(p){this.popup=p;return this;},setTooltipContent(t){this.tooltip=t;return this;},setLatLng(p){this.point=p;return this;},addTo(){children.push(this);return this;}});
 const document={hidden:false,getElementById:get,createElement:element,addEventListener:(k,f)=>events[k]=f};
 class Clock extends Date{static now(){return now;}}
 const context={document,Date:Clock,Map,Set,AbortController,AbortSignal,Math,URL,window:{GregleTransitCore:core,addEventListener:(k,f)=>events[k]=f},L:{layerGroup:()=>group,divIcon:options=>options,marker},fetch:(url,options)=>{calls.push({url,options});return impl(url,options);},setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-transit-vehicles.js'),'utf8'),context);
 const api=context.window.GregleTransitVehicles({map:{removeLayer(){}}});
 return {api,get,document,events,children,calls,timers,setFetch:f=>impl=f,async advance(ms){const end=now+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();await flush();}now=end;await flush();}};
}
test('vehicle normalization matches complete route IDs and rejects stale, future, wrong-route and invalid GPS positions',()=>{
 assert.equal(core.vehiclesURL('gb-london_4'),null);assert.equal(core.vehiclesURL('https://evil.test'),null);assert.equal(new URL(core.vehiclesURL(routeId)).searchParams.get('route'),routeId);
 const good=payload().vehicles[0],d=core.readVehiclePositions(payload({vehicles:[good,{...good,id:'old',observed:NOW-121000},{...good,id:'future',observed:NOW+31000},{...good,id:'wrong',routeId:'4-COW'},{...good,id:'zero',lat:0},{...good,id:'missing',observed:null},good]}),routeId);assert.equal(d.vehicles.length,1);assert.throws(()=>core.readVehiclePositions(payload({routeId:'other'}),routeId));assert.throws(()=>core.readVehiclePositions(payload({maxAgeSeconds:9999}),routeId));
});
test('vehicle markers poll only after selection, preserve popup identity and clear on route removal',async()=>{
 const h=setup();assert.equal(h.calls.length,0);h.api.show(route);await flush();assert.equal(h.calls.length,1);assert.equal(h.children.length,1);assert.match(h.get('transit-vehicle-status').textContent,/1 live bus/);assert.match(h.get('transit-vehicle-credit').textContent,/BC Transit/);const marker=h.children[0];await h.advance(30000);assert.equal(h.calls.length,2);assert.equal(h.children[0],marker,'refresh updates the current popup instead of closing it');h.api.clear();assert.equal(h.children.length,0);assert.equal(h.timers.size,0);await h.advance(60000);assert.equal(h.calls.length,2);
});
test('stale positions expire during an outage and Retry-After prevents rapid polling',async()=>{
 const h=setup();h.api.show(route);await flush();h.setFetch(async()=>new Response('slow',{status:503,headers:{'Retry-After':'180'}}));await h.advance(30000);assert.equal(h.calls.length,2);assert.equal(h.children.length,1);await h.advance(100000);assert.equal(h.children.length,0);assert.equal(h.calls.length,2);assert.match(h.get('transit-vehicle-status').textContent,/unavailable/);
});
test('route changes, hiding and leaving the page abort requests and ignore late data',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.show(route);h.api.clear();assert(h.calls[0].options.signal.aborted);release(new Response(JSON.stringify(payload())));await flush();assert.equal(h.children.length,0);
 const v=setup();v.api.show(route);await flush();v.document.hidden=true;v.events.visibilitychange();assert.equal(v.children.length,0);assert.equal(v.timers.size,0);v.document.hidden=false;v.events.visibilitychange();await flush();assert.equal(v.children.length,1);v.events.pagehide();assert.equal(v.children.length,0);assert.equal(v.timers.size,0);
});
test('unsupported services do not poll and London routes make no vehicle request',async()=>{
 const h=setup();h.api.show({routeId:'gb-tfl_4',route:'4'});assert.equal(h.calls.length,0);h.setFetch(async()=>new Response(JSON.stringify(payload({supported:false,vehicles:[]}))));h.api.show(route);await flush();assert.equal(h.timers.size,0);assert.match(h.get('transit-vehicle-status').textContent,/not available/);
});
