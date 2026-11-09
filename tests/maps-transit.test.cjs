const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-transit-core.js');
const NOW=Date.parse('2026-11-09T18:00:00Z');
const stop={id:'ca-bc-Victoria-Transit_100032',name:'Douglas St at Fort St',lat:48.42437,lng:-123.36532,scope:'bc',zone:'America/Vancouver',modes:['BUS']};
const rawStop={stopId:stop.id,name:stop.name,lat:stop.lat,lon:stop.lng,modes:['BUS']};
const departure=(extra={})=>({tripId:'trip1',displayName:'5',headsign:'Willows',realTime:false,place:{stopId:stop.id,departure:'2026-11-09T18:06:00Z',scheduledDeparture:'2026-11-09T18:03:00Z',pickupType:'NORMAL'},...extra});
const sharedStop=require('./fixtures/transit-shared-bus-stop.json');
const pandora={id:'ca-bc-Cowichan-Valley-Transit_100082',name:'Douglas & Pandora (Victoria City Hall)',lat:48.42867,lng:-123.36457,code:'100082',modes:['BUS'],scope:'bc',zone:'America/Vancouver'};

test('route geometry follows the exact departure and excludes interlined routes and opposite directions',()=>{
 const data=require('./fixtures/transit-route-trip.json'),selected={id:'ca-bc-Victoria-Transit_100025',code:'100025',lat:48.42189,lng:-123.36409,modes:['BUS'],scope:'bc'},row={tripId:data.selectedTripId,routeId:data.selectedRouteId,route:'21',headsign:'Interurban to Camosun only'};
 const url=new URL(core.tripURL(row));assert.equal(url.searchParams.get('joinInterlinedLegs'),'false');assert.equal(url.searchParams.get('detailedLegs'),'true');
 const trip=core.readTrip(data,row,selected);
 assert.equal(trip.route,'21');assert.match(trip.headsign,/Interurban/);assert(trip.points.length>100);assert(trip.stops.some(stop=>stop.selected));assert(!trip.stops.some(stop=>/University Club/.test(stop.name)),'onward/previous route 7 must not be drawn');
 assert(trip.points.every(([lat,lng])=>lat>48&&lat<49&&lng< -123&&lng> -124));
 assert.throws(()=>core.readTrip(data,{...row,tripId:'not-in-response'},selected));
 assert.throws(()=>core.readTrip(data,row,{...selected,id:'other',code:'other',lat:0,lng:0}));
 assert.throws(()=>core.decodeGeometry({points:'?',precision:6}));assert.throws(()=>core.decodeGeometry({points:'~~~~~~',precision:6}));assert.throws(()=>core.decodeGeometry({points:'abc',precision:7}));
 assert.deepEqual(core.decodeGeometry({points:'_p~iF~ps|U_ulLnnqC_mqNvxq`@',precision:5}),[[38.5,-120.2],[40.7,-120.95],[43.252,-126.453]]);
});

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
 assert.equal(new URL(core.stopsURL(area)).searchParams.get('grouped'),'false');
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

test('individual boarding stops preserve opposite directions and terminal bays while coalescing duplicate feeds',()=>{
 const data=require('./fixtures/transit-boarding-stops.json'),area={scope:'bc',box:[-123.368,48.418,-123.36,48.425]};
 const stops=core.readStops(data,area);
 for(const code of ['100019','100010','104111','100025','100024','100035','100039'])assert.equal(stops.filter(stop=>stop.code===code).length,1,'boarding stop '+code);
 assert(stops.some(stop=>/Bay A/.test(stop.name)));assert(stops.some(stop=>/Bay B/.test(stop.name)));
 const london=core.readStops([{stopId:'gb-platform-1',parentId:'gb-station',name:'Station',lat:51.5,lon:-.12,modes:['SUBWAY']},{stopId:'gb-platform-2',parentId:'gb-station',name:'Station',lat:51.5001,lon:-.12,modes:['SUBWAY']},{stopId:'gb-bus-a',parentId:'gb-bus-group',name:'Station Bus',stopCode:'1',track:'A',lat:51.5,lon:-.12,modes:['BUS']},{stopId:'gb-bus-b',parentId:'gb-bus-group',name:'Station Bus',stopCode:'2',track:'B',lat:51.5,lon:-.1201,modes:['BUS']}],{scope:'london',box:[-.13,51.49,-.11,51.51]});
 assert.equal(london.filter(stop=>stop.id==='gb-station').length,1);assert.equal(london.length,3);assert.deepEqual(london.filter(stop=>stop.modes.includes('BUS')).map(stop=>stop.platform),['A','B']);
});

const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};

test('shared local/commuter stops include the same coded boarding point across feeds',()=>{
 const url=new URL(core.departuresURL(pandora,new Date(NOW).toISOString(),'LATER|123'));
 assert.equal(url.searchParams.get('stopId'),pandora.id);assert.equal(url.searchParams.get('radius'),'35');assert.equal(url.searchParams.get('exactRadius'),'true');assert.equal(url.searchParams.get('pageCursor'),'LATER|123');
 const board=core.readDepartures(sharedStop,pandora);
 assert.equal(board.rows.length,3);assert(board.rows.every(row=>row.operator==='BCTransit'));assert(board.rows.some(row=>row.route==='22A'));
 // Apply the rule to arbitrary BC and London feed IDs, not a Victoria name list.
 for(const scope of ['bc','london']){
  const selected={...pandora,scope,id:scope==='bc'?'ca-bc-commuter_42':'gb-commuter_42',code:'42',lat:scope==='bc'?48.42:51.5,lng:scope==='bc'?-123.36:-.12};
  const local=scope==='bc'?'ca-bc-local_42':'gb-local_42';
  const row=departure({place:{stopId:local,stopCode:'42',lat:selected.lat+.00001,lon:selected.lng,scheduledDeparture:'2026-11-09T18:03:00Z'}});
  assert.equal(core.readDepartures({stopTimes:[row]},selected).rows.length,1);
  for(const extra of [{stopCode:'43'},{lat:selected.lat+.001},{lat:null},{lon:undefined},{stopCode:undefined},{stopId:'us-wa_42'}])assert.equal(core.readDepartures({stopTimes:[{...row,place:{...row.place,...extra}}]},selected).rows.length,0,JSON.stringify(extra));
 }
 const rail={...pandora,modes:['SUBWAY']},uncoded={...pandora,code:''};
 for(const selected of [rail,uncoded]){assert.equal(new URL(core.departuresURL(selected,new Date(NOW).toISOString())).searchParams.has('radius'),false);assert.equal(core.readDepartures(sharedStop,selected).rows.length,0);}
});

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

test('clicking the Douglas & Pandora commuter marker renders regular local departures',async()=>{
 const h=setup();
 h.setFetch(async url=>({ok:true,json:async()=>url.includes('/stoptimes?')?sharedStop:[{stopId:pandora.id,name:pandora.name,lat:pandora.lat,lon:pandora.lng,stopCode:pandora.code,modes:pandora.modes}]}));
 h.api.setEnabled(true);await flush();const marker=h.markers()[0];assert.equal(marker.transitStop.id,pandora.id);
 const popup=marker.popup();marker.events.popupopen();await h.advance(0);
 const text=el=>(el.textContent||'')+' '+el.children.map(text).join(' ');
 assert.match(text(popup),/Douglas & Pandora \(Victoria City Hall\)/);assert.match(text(popup),/BCTransit/);assert.match(text(popup),/Hillside Ctr via Strawberry Vale/);assert.doesNotMatch(text(popup),/No departures returned/);
 assert.equal(new URL(h.calls[1].url).searchParams.get('radius'),'35');
});

test('a viewport refresh choosing an equivalent feed marker keeps the open departure board',async()=>{
 const h=setup();h.api.setEnabled(true);await flush();const marker=h.markers()[0];marker.popup();marker.events.popupopen();
 h.setFetch(async url=>({ok:true,json:async()=>url.includes('/stoptimes?')?{stopTimes:[departure()]}:[{...rawStop,stopId:'ca-bc-alternate_100032'}]}));
 await h.move([-123.39,48.42,-123.34,48.44]);assert(h.markers().includes(marker),'open marker must survive provider grouping changes');
});
