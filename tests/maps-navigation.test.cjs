const { test }=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const core=require('../assets/maps-navigation-core.js'),maps=require('../assets/maps-core.js'),routing=require('../assets/maps-routing.js');
const a={lat:48.4284,lng:-123.3656,name:'Victoria'},b={lat:48.45,lng:-123.38,name:'Destination'};
const data=()=>({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[a.lng,a.lat],[b.lng,b.lat]]},distance:4500,duration:600,legs:[{steps:[{name:'Douglas Street',distance:4500,maneuver:{type:'turn',modifier:'right'}},{distance:0,maneuver:{type:'arrive'}}]}]}]});
test('driving URLs and app links use correct coordinate order',()=>{
 const u=new URL(core.routeURL(a,b));assert.equal(u.origin,'https://router.project-osrm.org');assert(u.pathname.includes('-123.365600,48.428400;-123.380000,48.450000'));assert.equal(u.searchParams.get('radiuses'),'1000;1000');
 const l=core.links(a,b),g=new URL(l.google),p=new URL(l.apple);assert.equal(g.searchParams.get('origin'),'48.428400,-123.365600');assert.equal(g.searchParams.get('dir_action'),'navigate');assert.equal(p.searchParams.get('daddr'),'48.450000,-123.380000');assert.throws(()=>core.routeURL({...a,lat:NaN},b));assert.equal(core.links(null,b),null);assert.equal(core.valid({...a,lat:'48'}),false);
});
test('provider routes validate status, geometry and numeric estimates',()=>{
 const r=core.readRoute(data());assert.deepEqual(r.points,[[a.lat,a.lng],[b.lat,b.lng]]);assert.equal(r.steps[0].text,'Turn right onto Douglas Street');assert.equal(r.steps[1].text,'Arrive at your destination');
 for(const code of ['NoRoute','NoSegment','Error'])assert.throws(()=>core.readRoute({code}));
 for(const modify of [d=>d.routes[0].geometry.coordinates[0][0]=181,d=>d.routes[0].duration=-1,d=>d.routes[0].distance='400',d=>d.routes[0].geometry.type='Polygon']){const d=data();modify(d);assert.throws(()=>core.readRoute(d));}
 assert.equal(core.duration(3600),'1 hr');assert.equal(core.duration(3660),'1 hr 1 min');assert.equal(core.distance(4500),'4.5 km');assert.equal(core.instruction({name:'Main St',maneuver:{type:'roundabout',exit:3}}),'Enter the roundabout and take exit 3 onto Main St');
});
function harness({connected=false,defaultAvailable=false,liveFactory,transitCore,transitLiveFactory}={}){
 const els=new Map(),children=[],saved=new Map(connected?[['gregle-maps-tomtom-key','test-key-1234567890']]:[]);let selected=a,geoSuccess,geoFailure,geoOptions,service;
 class El{constructor(){this.hidden=false;this.value='';this.children=[];this.events={};this.attrs={};this.classList={add(){},remove(){}};}addEventListener(e,f){(this.events[e]??=[]).push(f);}getAttribute(k){return this.attrs[k];}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}replaceChildren(...c){this.children=c;}append(...c){this.children.push(...c);}focus(){this.focused=true;}scrollIntoView(){this.revealed=true;}async fire(e){for(const f of this.events[e]||[])await f({preventDefault(){},stopPropagation(){}});}click(){return this.fire('click');}}
 const el=id=>{if(!els.has(id))els.set(id,new El());return els.get(id);};el('map-directions').hidden=true;const pending=[];
 const ctx={window:{GregleTransitJourneyCore:transitCore,GregleTransitJourneyLive:transitLiveFactory,GregleLiveNavigation:liveFactory,GregleNavigation:core,GregleMaps:maps,GregleMapRouting:{...routing,create:()=>service=routing.create({defaultAvailable,fetch:ctx.fetch,storage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)}})}},document:{getElementById:el,querySelector:()=>el('stage'),createElement:()=>new El()},navigator:{geolocation:{getCurrentPosition(s,f,o){geoSuccess=s;geoFailure=f;geoOptions=o;}}},L:{layerGroup:()=>({addTo(){return this;},clearLayers(){}}),polyline:()=>({addTo(){children.push(this);return this;},getBounds(){return [];}}),divIcon:()=>({}),marker:()=>({addTo(){return this;}})},fetch:(url,opts)=>new Promise(resolve=>pending.push({url,opts,resolve})),URL,AbortController,setTimeout,clearTimeout,Date};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-navigation.js'),'utf8'),ctx);const api=ctx.window.GregleMapNavigation({map:{getCenter:()=>a,getSize:()=>({x:1200}),fitBounds(){}},config:{searchURL:'https://photon.komoot.io/api/',serverTomTom:defaultAvailable},getSelected:()=>selected});return{api,el,pending,children,saved,routing:()=>service,select:p=>{selected=p;},geo:()=>geoSuccess,geoFailure:()=>geoFailure,geoOptions:()=>geoOptions,context:ctx};
}
async function endpoints(h){await h.el('directions-from-pin').click();h.select(b);await h.el('directions-to-pin').click();}
test('editing during a route request rejects stale geometry and links',async()=>{
 const h=harness();await endpoints(h);assert.equal(h.el('directions-route').disabled,false);const work=h.el('directions-route').click();assert.equal(h.pending.length,1);assert.equal(h.el('directions-handoff').hidden,false);await h.el('directions-to').fire('input');assert(h.pending[0].opts.signal.aborted);h.pending[0].resolve({ok:true,json:async()=>data()});await work;assert.equal(h.children.length,0);assert.equal(h.el('directions-summary').hidden,true);assert.equal(h.el('directions-handoff').hidden,true);assert.equal(h.el('directions-route').disabled,true);
});
test('successful route draws; swapping and clearing invalidate results',async()=>{
 const h=harness();await endpoints(h);const work=h.el('directions-route').click();h.pending[0].resolve({ok:true,json:async()=>data()});await work;assert.equal(h.children.length,2);assert.equal(h.el('directions-summary').hidden,false);assert.equal(h.el('directions-total').textContent,'10 min · 4.5 km');await h.el('directions-swap').click();assert.equal(new URL(h.el('directions-google').href).searchParams.get('origin'),'48.450000,-123.380000');assert.equal(h.el('directions-summary').hidden,true);await h.el('directions-clear').click();assert.equal(h.el('directions-from').value,'');assert.equal(h.el('directions-handoff').hidden,true);
});
test('close invalidates location and search; route failure retains app handoff',async()=>{
 const h=harness();await h.el('directions-location').click();await h.el('close-directions').click();h.geo()({coords:{latitude:a.lat,longitude:a.lng}});assert.equal(h.el('directions-from').value,'');await endpoints(h);const work=h.el('directions-route').click();h.pending[0].resolve({ok:false,json:async()=>({code:'NoRoute'})});await work;assert(h.el('directions-status').textContent.includes('No driving route'));assert.equal(h.el('directions-handoff').hidden,false);assert.equal(h.el('directions-summary').hidden,true);
 const h2=harness();h2.el('directions-from').value='Victoria';const search=h2.el('directions-search-form').fire('submit');await h2.el('close-directions').click();h2.pending[0].resolve({ok:true,json:async()=>({features:[]})});await search;assert.equal(h2.el('directions-results').children.length,0);assert.equal(h2.el('map-directions').hidden,true);
});

test('traffic stays off without a key and its controls appear only with a driving route',async()=>{
 const h=harness();assert.equal(h.el('directions-traffic-row').hidden,true);
 await endpoints(h);const work=h.el('directions-route').click();h.pending[0].resolve({ok:true,json:async()=>data()});await work;
 assert.equal(h.el('directions-traffic-row').hidden,false);assert.equal(h.el('directions-traffic').attrs['aria-checked'],'false');assert.equal(h.el('directions-traffic').disabled,true);
 assert.equal(h.el('directions-traffic-connect').hidden,false);assert.match(h.el('directions-estimate-note').textContent,/Live traffic off/);
 await h.el('directions-walking').click();assert.equal(h.el('directions-traffic-row').hidden,true);await h.el('directions-clear').click();assert.equal(h.el('directions-summary').hidden,true);
});

test('private default routing keeps the route switch off but available, alongside the personal-key option',async()=>{
 const h=harness({defaultAvailable:true});await endpoints(h);const work=h.el('directions-route').click();h.pending[0].resolve({ok:true,json:async()=>data()});await work;
 assert.equal(h.el('directions-traffic').attrs['aria-checked'],'false');assert.equal(h.el('directions-traffic').disabled,false);
 assert.equal(h.el('directions-traffic-connect').hidden,false);assert.equal(h.el('directions-traffic-connect').textContent,'Add your own TomTom key');
});


test('context actions route from an explicit start without changing the selected pin', async()=>{
 const h=harness(); h.api.choosePoint('from',a);
 const work=h.api.navigateTo(b); assert.equal(h.pending.length,1);
 assert(h.pending[0].url.includes('-123.365600,48.428400;-123.380000,48.450000'));
 h.pending[0].resolve({ok:true,json:async()=>data()}); await work;
 assert.equal(h.el('map-directions').hidden,false); assert.equal(h.el('directions-summary').hidden,false);
});
test('navigate here uses location when needed and closing cancels a late result',()=>{
 const h=harness(); h.api.navigateTo(b); assert.equal(typeof h.geo(),'function');
 assert.equal(h.el('directions-to').value,'Destination'); assert.equal(h.pending.length,0);
 h.api.close(); h.geo()({coords:{latitude:a.lat,longitude:a.lng}});
 assert.equal(h.pending.length,0); assert.equal(h.el('directions-from').value,'');
});


test('startup permission failures reveal the notice instead of returning to an offscreen error',async()=>{
 const message='Location access was denied. Allow location in Safari website settings.';
 const h=harness({liveFactory:({onStop})=>({active:false,start(){onStop(message);}})});
 await endpoints(h);const work=h.el('directions-route').click();h.pending[0].resolve({ok:true,json:async()=>data()});await work;
 await h.el('directions-start').click();
 assert.equal(h.el('map-directions').hidden,false);assert.equal(h.el('directions-status').textContent,message);
 assert(h.el('directions-status').focused);assert(h.el('directions-status').revealed);
 assert.equal(h.el('directions-summary').hidden,false);assert.equal(h.el('directions-start').disabled,false);
});

test('unexpected startup exceptions show a recoverable error while preserving the route',async()=>{
 const h=harness({liveFactory:()=>({active:false,start(){throw Error('Browser startup failure');},stop(){}})});
 await endpoints(h);const work=h.el('directions-route').click();h.pending[0].resolve({ok:true,json:async()=>data()});await work;
 await h.el('directions-3d').click();
 assert.equal(h.el('map-directions').hidden,false);assert.match(h.el('directions-status').textContent,/Navigation could not start/);
 assert(h.el('directions-status').revealed);assert.equal(h.el('directions-summary').hidden,false);
});

test('a successful navigation start hides directions only after the session is active',async()=>{
 let active=false;
 const h=harness({liveFactory:()=>({get active(){return active;},start(){active=true;}})});
 await endpoints(h);const work=h.el('directions-route').click();h.pending[0].resolve({ok:true,json:async()=>data()});await work;
 await h.el('directions-start').click();assert(active);assert.equal(h.el('map-directions').hidden,true);assert(h.el('navigation-stop').focused);
});


test('Transit mode renders journey choices and hands the selected journey to GPS guidance',async()=>{
 const journeyCore=require('../assets/maps-transit-journey-core.js'),f=require('./fixtures/transit-journey.json');
 const journeys=journeyCore.readPlan(f,a,b,Date.parse(f.itineraries[0].startTime)-1000);let active=false,started;
 const h=harness({transitCore:{...journeyCore,request:async()=>journeys},transitLiveFactory:()=>({start(j){started=j;active=true;},stop(){active=false;},get active(){return active;}})});
 h.context.L.circleMarker=()=>({bindTooltip(){return this;},addTo(){return this;}});h.context.L.latLngBounds=p=>p;
 h.el('directions-steps').closest=()=>({open:false});h.el('directions-transit-options').querySelectorAll=()=>h.el('directions-transit-options').children.filter(x=>x.type==='button');
 await h.el('directions-transit').click();await endpoints(h);await h.el('directions-route').click();
 assert.equal(h.el('directions-summary').hidden,false);assert.equal(h.el('directions-transit-options').hidden,false);assert.equal(h.el('directions-3d').hidden,true);assert(h.el('directions-steps').children.some(x=>x.textContent.includes('Get off at')));
 await h.el('directions-start').click();assert.equal(started,journeys[0]);assert.equal(h.el('map-directions').hidden,true);
});

test('typing suggests after a pause, cancels stale lookups and switches fields without choosing the wrong endpoint',async()=>{
 const h=harness(),timers=new Map();let id=0,now=10000;
 h.context.setTimeout=(f,delay)=>{const n=++id;timers.set(n,{f,delay});return n;};h.context.clearTimeout=n=>timers.delete(n);h.context.Date={now:()=>now};
 const run=()=>{const [n,t]=[...timers].find(([,t])=>t.delay<10000);timers.delete(n);return t.f();};
 await h.el('directions-from-pin').click();h.el('directions-to').value='UV';await h.el('directions-to').fire('input');assert.equal(timers.size,0);
 h.el('directions-to').value='UVic';await h.el('directions-to').fire('input');h.el('directions-to').value='UVict';await h.el('directions-to').fire('input');assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,450);
 const old=run();assert.equal(h.pending.length,1);h.el('directions-to').value='University';await h.el('directions-to').fire('input');assert(h.pending[0].opts.signal.aborted);
 h.pending[0].resolve({ok:true,json:async()=>({features:[{geometry:{type:'Point',coordinates:[b.lng,b.lat]},properties:{name:'Old result'}}]})});await old;assert.equal(h.el('directions-results').children.length,0);
 await h.el('directions-from').fire('focus');assert.equal(timers.size,0);await h.el('directions-to').fire('focus');now+=1500;await h.el('directions-to').fire('input');const latest=run();
 h.pending[1].resolve({ok:true,json:async()=>({features:[{geometry:{type:'Point',coordinates:[b.lng,b.lat]},properties:{name:'University'}}]})});await latest;
 assert.equal(h.el('directions-results').children.length,1);await h.el('directions-results').children[0].children[0].click();assert.equal(h.el('directions-route').disabled,false);assert.equal(timers.size,0);
});


test('suggestions remain visible during edits and requests, replace together, and clear for another field', async()=>{
 const h=harness(),timers=new Map();let id=0,now=10000;
 h.context.setTimeout=(f,delay)=>{const n=++id;timers.set(n,{f,delay});return n;};h.context.clearTimeout=n=>timers.delete(n);h.context.Date={now:()=>now};
 const run=()=>{const [n,t]=[...timers].find(([,t])=>t.delay<10000);timers.delete(n);return t.f();};
 const answer=name=>({ok:true,json:async()=>({features:[{geometry:{type:'Point',coordinates:[b.lng,b.lat]},properties:{name}}]})});
 await h.el('directions-from-pin').click();h.el('directions-to').value='Stan';await h.el('directions-to').fire('input');
 const first=run();h.pending[0].resolve(answer('Stanley Park'));await first;
 const original=h.el('directions-results').children[0];
 now+=1500;h.el('directions-to').value='Stanley';await h.el('directions-to').fire('input');
 assert.equal(h.el('directions-results').children[0],original);
 const second=run();assert.equal(h.el('directions-results').children[0],original);
 h.el('directions-to').value='Stanley Park';await h.el('directions-to').fire('input');assert(h.pending[1].opts.signal.aborted);
 h.pending[1].resolve(answer('Superseded result'));await second;assert.equal(h.el('directions-results').children[0],original);
 now+=1500;const third=run();h.pending[2].resolve(answer('Stanley Park entrance'));await third;
 assert.equal(h.el('directions-results').children.length,1);assert.notEqual(h.el('directions-results').children[0],original);
 assert.equal(h.el('directions-results').children[0].children[0].children[0].textContent,'Stanley Park entrance');
 h.el('directions-to').value='St';await h.el('directions-to').fire('input');assert.equal(h.el('directions-results').children.length,0);
 h.el('directions-to').value='Stanley Park';await h.el('directions-to').fire('input');await run();assert.equal(h.el('directions-results').children.length,1);
 await h.el('directions-from').fire('focus');assert.equal(h.el('directions-results').children.length,0);assert.equal(timers.size,0);
});

test('car directions defaults to GPS without focusing either text field', async()=>{
 const h=harness();h.context.document.body={classList:{contains:name=>name==='vehicle-layout'}};
 await h.el('map-directions-toggle').click();assert.equal(typeof h.geo(),'function');
 assert(!h.el('directions-from').focused);assert(!h.el('directions-to').focused);
 h.geo()({coords:{latitude:a.lat,longitude:a.lng}});
 assert.equal(h.el('directions-from').value,'My location');assert(!h.el('directions-to').focused);
 h.api.choosePoint('to',b);assert.equal(h.el('directions-route').disabled,false);
 assert(!h.el('directions-from').focused);assert(!h.el('directions-to').focused);
});
test('a manually selected starting point survives opening car directions', async()=>{
 const h=harness();h.context.document.body={classList:{contains:()=>true}};
 h.api.choosePoint('from',a);h.api.close();await h.el('map-directions-toggle').click();
 assert.equal(h.el('directions-from').value,'Victoria');assert.equal(h.geo(),undefined);
});

// Saved shortcuts must never reuse a manually chosen origin or open the keyboard.
test('saved shortcut replaces a manual start with fresh GPS and starts live guidance',async()=>{
 let active=false, destination, options;
 const h=harness({liveFactory:()=>({get active(){return active;},start(route,mode,to,settings){active=true;destination=to;options=settings;}})});
 await endpoints(h);
 h.el('directions-from').focused=false;h.el('directions-to').focused=false;
 h.api.navigateSaved(b);assert.equal(h.pending.length,0);assert.equal(h.el('directions-from').value,'');assert.equal(h.geoOptions().maximumAge,0);
 const current={lat:48.43,lng:-123.36};
 h.geo()({coords:{latitude:current.lat,longitude:current.lng}});
 assert.equal(h.pending.length,1);assert(h.pending[0].url.includes('-123.360000,48.430000'));
 assert(!h.el('directions-from').focused);assert(!h.el('directions-to').focused);
 h.pending[0].resolve({ok:true,json:async()=>data()});await new Promise(resolve=>setImmediate(resolve));
 assert(active);assert.equal(destination.lat,b.lat);assert.equal(options.threeD,false);assert.equal(h.el('map-directions').hidden,true);
});

test('car Home starts a direct 3D driving route from fresh GPS after another travel mode',async()=>{
 let active=false,started;
 const h=harness({liveFactory:()=>({get active(){return active;},start(route,mode,to,options){active=true;started={route,mode,to,options};}})});
 await endpoints(h);h.api.choosePoint('stop',{...a,lat:48.44,name:'Old stop'});
 await h.el('directions-walking').click();
 h.api.navigateSaved({...b,name:'Home'},{threeD:true});
 assert.equal(h.el('directions-driving').attrs['aria-pressed'],'true');
 assert.equal(h.el('directions-walking').attrs['aria-pressed'],'false');
 assert.equal(h.el('directions-stop-row').hidden,true);
 assert.equal(h.geoOptions().maximumAge,0);assert.equal(h.pending.length,0);
 const current={lat:48.43,lng:-123.36};h.geo()({coords:{latitude:current.lat,longitude:current.lng}});
 assert.equal(h.pending.length,1);assert(h.pending[0].url.includes('driving'));assert(h.pending[0].url.includes('-123.360000,48.430000'));
 h.pending[0].resolve({ok:true,json:async()=>data()});await new Promise(resolve=>setImmediate(resolve));
 assert(active);assert.equal(started.mode,'driving');assert.equal(started.to.name,'Home');assert.equal(started.options.threeD,true);
 assert.equal(h.el('map-directions').hidden,true);
});
test('saved shortcut GPS denial offers recovery without routing from an old start',async()=>{
 const h=harness();await endpoints(h);h.api.navigateSaved(b);h.geoFailure()({code:1});
 assert.equal(h.pending.length,0);assert.equal(h.el('directions-route').disabled,true);
 assert.match(h.el('directions-status').textContent,/Allow location access/);
});

test('add and remove stop controls require a selected stop and preserve route endpoints', async () => {
  const h = harness(); await endpoints(h);
  assert.equal(h.el('directions-stop-row').hidden, true);
  await h.el('directions-add-stop').click();
  assert.equal(h.el('directions-stop-row').hidden, false); assert.equal(h.el('directions-route').disabled, true);
  h.api.choosePoint('stop', {...a, lat: 48.44, name: 'Coffee'});
  assert.equal(h.el('directions-route').disabled, false);
  assert.match(new URL(h.el('directions-google').href).searchParams.get('waypoints'), /48.440000/);
  assert.equal(h.el('directions-apple').hidden, true);
  await h.el('directions-remove-stop').click();
  assert.equal(h.el('directions-stop-row').hidden, true); assert.equal(h.el('directions-stop').value, '');
  assert.equal(h.el('directions-route').disabled, false); assert.equal(h.el('directions-apple').hidden, false);
  assert.equal(new URL(h.el('directions-google').href).searchParams.has('waypoints'), false);
  assert.equal(h.el('directions-to').value, b.name);
});


test('car 3D starts a destination-free drive until a driving route is available',async()=>{
 const calls=[];
 const h=harness({liveFactory:()=>({active:false,startDrive:options=>calls.push(['drive',options.threeD]),start:(route,mode,to,options)=>calls.push(['route',options.threeD])})});
 h.api.startCar3D();assert.deepEqual(calls,[['drive',true]]);assert.equal(h.pending.length,0);
 await endpoints(h);const work=h.el('directions-route').click();h.pending[0].resolve({ok:true,json:async()=>data()});await work;
 h.api.startCar3D();assert.deepEqual(calls.at(-1),['route',true]);
});


test('four stops stay ordered, removing a middle stop shifts later stops, and swapping reverses them',async()=>{
 const h=harness();await endpoints(h);
 const fields=['stop','stop2','stop3','stop4'];
 for(let i=0;i<4;i++){
  await h.el('directions-add-stop').click();assert.equal(h.el('directions-'+fields[i]+'-row').hidden,false);
  assert.equal(h.el('directions-route').disabled,true);h.api.choosePoint(fields[i],{lat:48.43+i*.01,lng:-123.36,name:'Stop '+(i+1)});
 }
 assert.equal(h.el('directions-add-stop').hidden,true);assert.equal(h.el('directions-route').disabled,false);
 assert.equal(new URL(h.el('directions-google').href).searchParams.get('waypoints').split('|').length,4);
 await h.el('directions-add-stop').click();assert.equal(h.el('directions-add-stop').hidden,true);
 await h.el('directions-remove-stop2').click();assert.equal(h.el('directions-stop2').value,'Stop 3');assert.equal(h.el('directions-stop3').value,'Stop 4');assert.equal(h.el('directions-stop4-row').hidden,true);
 await h.el('directions-swap').click();assert.equal(h.el('directions-stop').value,'Stop 4');assert.equal(h.el('directions-stop3').value,'Stop 1');
 await h.el('directions-transit').click();assert.equal(h.el('directions-stop-row').hidden,true);
 await h.el('directions-driving').click();assert.equal(h.el('directions-stop3-row').hidden,false);assert.equal(h.el('directions-stop3').value,'Stop 1');
 await h.el('directions-clear').click();for(const f of fields)assert.equal(h.el('directions-'+f+'-row').hidden,true);
});
