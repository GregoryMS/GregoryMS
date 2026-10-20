const { test }=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const core=require('../assets/maps-navigation-core.js'),maps=require('../assets/maps-core.js');
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
function harness(){
 const els=new Map(),children=[];let selected=a,geoSuccess;
 class El{constructor(){this.hidden=false;this.value='';this.children=[];this.events={};this.attrs={};this.classList={add(){},remove(){}};}addEventListener(e,f){(this.events[e]??=[]).push(f);}getAttribute(k){return this.attrs[k];}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}replaceChildren(...c){this.children=c;}append(...c){this.children.push(...c);}focus(){}async fire(e){for(const f of this.events[e]||[])await f({preventDefault(){},stopPropagation(){}});}click(){return this.fire('click');}}
 const el=id=>{if(!els.has(id))els.set(id,new El());return els.get(id);};el('map-directions').hidden=true;const pending=[];
 const ctx={window:{GregleNavigation:core,GregleMaps:maps},document:{getElementById:el,querySelector:()=>el('stage'),createElement:()=>new El()},navigator:{geolocation:{getCurrentPosition(s){geoSuccess=s;}}},L:{layerGroup:()=>({addTo(){return this;},clearLayers(){}}),polyline:()=>({addTo(){children.push(this);return this;},getBounds(){return [];}}),divIcon:()=>({}),marker:()=>({addTo(){return this;}})},fetch:(url,opts)=>new Promise(resolve=>pending.push({url,opts,resolve})),URL,AbortController,setTimeout,clearTimeout,Date};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-navigation.js'),'utf8'),ctx);ctx.window.GregleMapNavigation({map:{getCenter:()=>a,getSize:()=>({x:1200}),fitBounds(){}},config:{searchURL:'https://photon.komoot.io/api/'},getSelected:()=>selected});return{el,pending,children,select:p=>{selected=p;},geo:()=>geoSuccess};
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
