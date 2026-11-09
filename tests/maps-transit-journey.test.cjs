const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const core=require('../assets/maps-transit-journey-core.js'),nav=require('../assets/maps-navigation-core.js'),fixture=require('./fixtures/transit-journey.json');
const from={lat:48.4284,lng:-123.3656,name:'City Hall'},to={lat:48.4634,lng:-123.3118,name:'UVic'},NOW=Date.parse(fixture.itineraries[0].startTime)-1000;
test('transit requests use regional journey planning with detailed walking paths and real boarding/alighting stops',()=>{
 const url=new URL(core.planURL(from,to));assert.equal(url.pathname,'/api/v6/plan');assert.equal(url.searchParams.get('directModes'),'');assert.equal(url.searchParams.get('useRoutedTransfers'),'true');assert.throws(()=>core.planURL(from,{lat:40,lng:0}));
 const [j]=core.readPlan(fixture,from,to,NOW);assert.equal(j.legs.length,3);assert.equal(j.transfers,0);assert.equal(j.legs[1].route,'4');assert.equal(j.legs[1].to.name,'University Dr at Ring Rd');assert.equal(j.legs[2].to.name,'UVic');assert(j.legs[0].steps.length>1);assert.match(core.stepText(j.legs[1]),/Get off at/);
 const bad=structuredClone(fixture);bad.itineraries[0].legs[1].cancelled=true;assert.throws(()=>core.readPlan(bad,from,to,NOW));assert.equal(new URL(nav.links(from,to,'transit').apple).searchParams.get('dirflg'),'r');
});
const leg=()=>({walk:false,mode:'BUS',route:'4',routeId:'ca-bc-Victoria-Transit_4-VIC',from:{lat:48.42,lng:-123.36,name:'Board here',zone:'America/Vancouver'},to:{lat:48.44,lng:-123.36,name:'Get off here',zone:'America/Vancouver'},start:NOW,end:NOW+600000,duration:600,distance:2224,length:2224,points:[[48.42,-123.36],[48.43,-123.36],[48.44,-123.36]],cumulative:[0,1112,2224],steps:[{text:'Arrive',start:2224,distance:0}],headsign:'UVic',stops:[],alerts:[]});
const fix=(lat,extra={})=>({coords:{latitude:lat,longitude:-123.36,accuracy:10},timestamp:NOW,...extra});
test('get-off guidance needs fresh accurate on-route progress and rejects stale fixes and implausible jumps',()=>{
 const l=leg();assert.equal(core.guidance(l,fix(48.436),null,NOW).getOffSoon,true);assert.equal(core.guidance(l,fix(48.44001),null,NOW).atEnd,true);
 assert.equal(core.guidance(l,fix(48.421),null,NOW).getOffSoon,false);assert.equal(core.guidance(l,fix(48.436,{timestamp:NOW-21000}),null,NOW).reliable,false);assert.equal(core.guidance(l,fix(48.436,{coords:{latitude:48.436,longitude:-123.36,accuracy:100}}),null,NOW).reliable,false);
 const previous={along:0,index:0,stamp:NOW-1000};assert.equal(core.guidance(l,fix(48.436),previous,NOW).reliable,false);
 const walk={...l,walk:true};assert.equal(core.guidance(walk,fix(48.436),null,NOW).getOffSoon,false);
});
test('live guidance alerts only after explicit boarding, pauses stale alerts, advances transfers and releases GPS',()=>{
 let now=NOW,gps,tick,cleared=0;const els=new Map(),events={};
 const el=id=>{if(!els.has(id))els.set(id,{hidden:true,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this[k]=f;}});return els.get(id);};
 class Clock extends Date{static now(){return now;}}
 const marker={addTo(){return this;},setLatLng(){return this;},getLatLng(){return from;}};
 const context={window:{GregleTransitJourneyCore:core,GregleNavigation:nav,addEventListener:(k,f)=>events[k]=f},document:{getElementById:el,querySelector:()=>({classList:{add(){},remove(){}}}),addEventListener:(k,f)=>events[k]=f,hidden:false},navigator:{geolocation:{watchPosition(cb){gps=cb;return 1;},clearWatch(){cleared++;}}},Date:Clock,Set,L:{latLngBounds:p=>p,circleMarker:()=>marker},setInterval:f=>{tick=f;return 1;},clearInterval(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-transit-journey-live.js'),'utf8'),context);
 const live=context.window.GregleTransitJourneyLive({map:{on(){},getSize:()=>({y:800}),fitBounds(){},removeLayer(){},panTo(){}},onStop(){},onReplan(){}});
 const ride=leg(),walk={...ride,walk:true,mode:'WALK'},journey={legs:[walk,ride,walk],end:NOW+1800000,zone:'America/Vancouver'};live.start(journey);gps(fix(48.436));assert(el('transit-guidance-alert').hidden);
 el('transit-guidance-next').click();gps(fix(48.436));assert(el('transit-guidance-alert').hidden,'approaching a stop is not boarding');
 el('transit-guidance-next').click();gps(fix(48.436));assert.equal(el('transit-guidance-alert').hidden,false);assert.match(el('transit-guidance-cue').textContent,/Get off soon/);
 now+=21000;tick();assert(el('transit-guidance-alert').hidden);assert(!el('transit-guidance-cue').textContent.includes('Get off soon'));
 el('transit-guidance-next').click();assert.match(el('transit-guidance-cue').textContent,/Walk/);assert(el('transit-guidance-alert').hidden);live.stop();assert.equal(live.active,false);assert.equal(cleared,1);
});
