const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-transit-core.js');
const NOW=Date.parse('2026-11-09T18:00:00Z');
const stop={id:'ca-bc-Victoria-Transit_100032',name:'Douglas St at Fort St',lat:48.42437,lng:-123.36532,scope:'bc',zone:'America/Vancouver',modes:['BUS']};
const rawStop={stopId:stop.id,name:stop.name,lat:stop.lat,lon:stop.lng,modes:['BUS']};
const departure=(extra={})=>({tripId:'trip1',displayName:'5',headsign:'Willows',realTime:false,place:{stopId:stop.id,departure:'2026-11-09T18:06:00Z',scheduledDeparture:'2026-11-09T18:03:00Z',pickupType:'NORMAL'},...extra});

test('transit scope rejects other regions, oversized views and low zooms, including wrapped maps',()=>{
 assert.equal(core.area([-123.38,48.42,-123.35,48.44],12),null);
 assert.equal(core.area([-130,48,-120,55],13),null);
 assert.equal(core.area([-122.35,47.59,-122.30,47.63],16),null);
 assert.equal(core.area([2.33,48.85,2.35,48.87],16),null);
 const area=core.area([-123.38,48.42,-123.35,48.44],16);
 assert.equal(area.scope,'bc');assert.deepEqual(core.area([236.62,48.42,236.65,48.44],16),area);
 assert.equal(core.area([-.14,51.49,-.11,51.51],16).scope,'london');
 const parsed=core.readStops([rawStop,rawStop,{...rawStop,stopId:'us-wa_1'},{...rawStop,stopId:'ca-bc_2',lat:null},{...rawStop,stopId:'ca-bc_3',lon:0}],area);
 assert.equal(parsed.length,1);assert.equal(parsed[0].zone,'America/Vancouver');
 assert.equal(new URL(core.stopsURL(area)).searchParams.get('grouped'),'true');
 assert.equal(core.major(parsed[0]),false);assert.equal(core.major({modes:['SUBWAY']}),true);
});

test('departure board distinguishes real-time, scheduled, cancelled and unsafe data and excludes neighbouring stations',()=>{
 const board=core.readDepartures({stopTimes:[departure(),departure(),departure({tripId:'rt',realTime:true,routeUrl:'javascript:alert(1)',cancelled:true}),departure({tripId:'wrong',place:{stopId:'different',scheduledDeparture:'2026-11-09T18:00:00Z'}}),departure({tripId:'platform',place:{stopId:'child',parentId:stop.id,scheduledDeparture:'2026-11-09T18:08:00Z',track:'2',alerts:[{descriptionText:'Service alert'}]}}),departure({tripId:'arrival-only',place:{stopId:stop.id,scheduledDeparture:'2026-11-09T18:10:00Z',pickupType:'NOT_ALLOWED'}})],nextPageCursor:'LATER|1234'},stop);
 assert.equal(board.rows.length,3);assert.equal(board.rows[0].time,Date.parse('2026-11-09T18:03:00Z'));assert.equal(board.rows[0].live,false);
 assert.equal(board.rows[1].live,true);assert.equal(board.rows[1].cancelled,true);assert.equal(board.rows[1].url,null);
 assert.equal(board.rows[2].platform,'2');assert.deepEqual(board.alerts,['Service alert']);
 const url=new URL(core.departuresURL(stop,new Date(NOW).toISOString(),board.next));assert.equal(url.searchParams.get('pageCursor'),'LATER|1234');assert.equal(url.searchParams.get('time'),new Date(NOW).toISOString());
 assert.equal(url.searchParams.has('radius'),false,'station parents must include their platforms');
 assert.notEqual(core.clock(NOW,'America/Vancouver'),core.clock(NOW,'Europe/London'));assert.match(core.clock(NOW,'Europe/London'),/18:00/);
 assert.throws(()=>core.readDepartures({},stop));assert.equal(core.safeURL('https://user:password@example.com/'),null);
});

const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function setup(){
 let now=NOW,box=[-123.38,48.42,-123.35,48.44],zoom=16,timerId=0,fetchImpl=async()=>({ok:true,json:async()=>[rawStop]});
 const timers=new Map(),events={},elements=new Map(),calls=[],credits=new Set(),groups=[];
 class Element{constructor(tag){this.tag=tag;this.children=[];this.events={};this.hidden=false;this.isConnected=true;this.classList={add(){}};this.style={};}append(...els){this.children.push(...els);}replaceChildren(...els){this.children=els;}setAttribute(){}removeAttribute(){}addEventListener(name,fn){this.events[name]=fn;}}
 const get=id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);};
 const map={getBounds:()=>({getWest:()=>box[0],getSouth:()=>box[1],getEast:()=>box[2],getNorth:()=>box[3]}),getCenter:()=>({lat:(box[1]+box[3])/2,lng:(box[0]+box[2])/2}),getZoom:()=>zoom,setZoom(z){zoom=z;},getSize:()=>({x:390,y:700}),on:(name,fn)=>events[name]=fn,closePopup(){},removeLayer(){},attributionControl:{addAttribution:a=>credits.add(a),removeAttribution:a=>credits.delete(a)}};
 const L={layerGroup(){const g={children:new Set(),addTo(){return this;},getLayers(){return [...this.children];},removeLayer(m){this.children.delete(m);},clearLayers(){this.children.clear();}};groups.push(g);return g;},divIcon:options=>options,marker:(point,options)=>({point,options,events:{},on(name,fn){this.events[name]=fn;return this;},bindPopup(fn){this.popup=fn;return this;},getPopup(){const marker=this;return {options:{},update(){marker.popup();}};},addTo(g){g.children.add(this);return this;}})};
 class Clock extends Date{static now(){return now;}}
 const context={L,Date:Clock,AbortController,AbortSignal,URL,Map,Set,Math,Number,JSON,document:{hidden:false,getElementById:get,createElement:tag=>new Element(tag),addEventListener:(name,fn)=>events[name]=fn},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,due:now+ms});return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,opts)=>{calls.push({url,...opts});return fetchImpl(url,opts);},addEventListener:(name,fn)=>events[name]=fn,GregleTransitCore:core};context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-transit.js'),'utf8'),context);
 const api=context.GregleTransit({map});
 async function advance(ms){now+=ms;for(let i=0;i<30;i++){const next=[...timers].find(([,v])=>v.due<=now);if(!next){await flush();return;}timers.delete(next[0]);next[1].fn();await flush();}throw Error('Timer loop');}
 return {api,calls,events,get,credits,document:context.document,markers:()=>groups[0].getLayers(),advance,setFetch:fn=>fetchImpl=fn,move:async(b,z=zoom)=>{box=b;zoom=z;events.moveend();await advance(3000);}};
}

test('transit requests remain opt-in, bounded, cached, region-limited and cancelled on disable or hidden pages',async()=>{
 const h=setup();assert.equal(h.calls.length,0);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);assert.equal(h.markers().length,1);assert.equal(h.credits.size,1);
 await h.move([-123.38,48.42,-123.35,48.44]);assert.equal(h.calls.length,1);
 await h.move([2.33,48.85,2.35,48.87]);assert.equal(h.markers().length,0);assert.equal(h.calls.length,1);
 let release;h.setFetch(()=>new Promise(resolve=>release=resolve));await h.move([-.14,51.49,-.11,51.51]);assert.equal(h.calls.length,2);
 h.api.setEnabled(false);assert(h.calls.at(-1).signal.aborted);release({ok:true,json:async()=>[]});await flush();assert.equal(h.markers().length,0);assert.equal(h.credits.size,0);
 h.setFetch(async()=>({ok:true,json:async()=>[]}));h.api.setEnabled(true);await h.advance(3000);h.document.hidden=true;h.events.visibilitychange();await h.advance(60000);const count=h.calls.length;h.api.setEnabled(false);await h.advance(60000);assert.equal(h.calls.length,count);
});

test('rate-limit backoff survives toggles and station boards show real departures and cancel on close',async()=>{
 const h=setup();h.api.setEnabled(true);await flush();const marker=h.markers()[0];
 h.setFetch(async()=>({ok:true,json:async()=>({stopTimes:[departure({realTime:true})],nextPageCursor:'LATER|123'})}));
 const popup=marker.popup();marker.events.popupopen();await h.advance(0);const text=el=>(el.textContent||'')+' '+el.children.map(text).join(' ');
 assert.match(text(popup),/Live estimate/);assert.match(text(popup),/Willows/);assert.equal(h.calls.length,2);
 await h.advance(60001);assert.match(text(popup),/Earlier estimate/);
 let release;h.setFetch(()=>new Promise(resolve=>release=resolve));const refresh=popup.children.find(el=>el.className==='transit-actions').children[0];refresh.events.click();await flush();assert.equal(h.calls.length,3);marker.events.popupclose();assert(h.calls.at(-1).signal.aborted);release({ok:true,json:async()=>({stopTimes:[]})});await flush();assert.match(text(popup),/Willows/);
 h.setFetch(async()=>({ok:false,headers:{get:()=> '600'}}));await h.move([-.14,51.49,-.11,51.51]);const failedCount=h.calls.length;h.api.setEnabled(false);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,failedCount);assert.match(h.get('transit-map-status').textContent,/temporarily unavailable/);
});
