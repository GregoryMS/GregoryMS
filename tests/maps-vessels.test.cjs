const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-vessels-core.js'),maps=require('../assets/maps-core.js');
const start=Date.parse('2026-10-18T04:00:00Z'), sid='1234567890abcdef12345678';
const ship=(values={})=>({mmsi:316001234,name:'TEST VESSEL',lat:48.4284,lng:-123.3656,speed:0,course:0,heading:511,type:'Tug',country:'Canada',destination:'VICTORIA',observed:new Date(start).toISOString(),source:'aisstream',...values});
const packet=(now=start,items=[ship({observed:new Date(now).toISOString()})],more={})=>({now,ships:items,snapshotId:sid,cursor:'',...more});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(){
 let now=start,box=[-123.5,48.3,-123.2,48.5],zoom=13,nextTimer=0,impl=async()=>({ok:true,json:async()=>packet(now)});
 const calls=[],timers=new Map(),events={},groups=[],credits=new Set(),nodes={};
 const element=()=>({style:{},children:[],events:{},dataset:{},textContent:'',append(...items){this.children.push(...items);},addEventListener(k,f){this.events[k]=f;}});
 const output=nodes['vessels-layer-status']=element(),refresh=nodes['vessels-refresh']=element();
 const map={getBounds:()=>({getWest:()=>box[0],getSouth:()=>box[1],getEast:()=>box[2],getNorth:()=>box[3]}),getCenter:()=>({lng:(box[0]+box[2])/2}),getZoom:()=>zoom,getSize:()=>({x:390,y:700}),on:(k,f)=>events[k]=f,removeLayer(){},attributionControl:{addAttribution:c=>credits.add(c),removeAttribution:c=>credits.delete(c)}};
 const L={layerGroup(){const g={children:new Set(),removeLayer(m){this.children.delete(m);},clearLayers(){this.children.clear();},addTo(){return this;}};groups.push(g);return g;},divIcon:o=>o,marker:(point,options)=>({point,options,pop:{options:{}},bindPopup(fn){this.popup=fn;return this;},getPopup(){return this.pop;},setLatLng(p){this.point=p;return this;},setIcon(icon){this.options.icon=icon;return this;},setPopupContent(fn){this.popup=fn;return this;},addTo(g){g.children.add(this);return this;}})};
 class Clock extends Date{static now(){return now;}}
 const c={L,Date:Clock,URL,URLSearchParams,AbortController,Map,Set,Math,Number,JSON,GregleMaps:maps,GregleVesselsCore:core,document:{hidden:false,getElementById:id=>nodes[id],createElement:element,addEventListener:(k,f)=>events[k]=f},addEventListener:(k,f)=>events[k]=f,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout:id=>timers.delete(id),fetch(url,opts){calls.push({url,...opts,time:now});return impl(url,opts);}};
 c.window=c;vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-vessels.js'),'utf8'),c);const api=c.GregleVessels({map,notify(){}});
 async function advance(ms){const end=now+ms;for(let i=0;i<1000;i++){const due=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!due){now=end;await flush();return;}now=due[1].due;timers.delete(due[0]);due[1].fn();await flush();}throw Error('Timer loop');}
 return {api,calls,output,refresh,events,credits,document:c.document,setFetch:fn=>impl=fn,advance,markers:()=>[...groups[0].children],async move(b,z=zoom){box=b;zoom=z;events.moveend();await advance(650);}};
}

test('vessel validation handles AIS sentinels, timestamps, duplicate MMSIs and wrapped views',()=>{
 const result=core.read(packet(start,[ship(),ship({observed:new Date(start-1000).toISOString(),name:'OLD'}),ship({mmsi:316001235,heading:511,course:360,speed:102.3}),ship({mmsi:316001236,lat:null}),ship({mmsi:316001237,observed:'2026-10-18T04:00:00'}),ship({mmsi:316001238,observed:new Date(start-600000).toISOString()}),ship({mmsi:316001239,observed:new Date(start+31000).toISOString()})]),start);
 assert.equal(result.vessels.length,2);assert.equal(result.vessels[0].speed,0);assert.equal(result.vessels[0].heading,0);assert.equal(result.vessels[0].name,'TEST VESSEL');assert.equal(result.vessels[1].heading,null);assert.equal(result.vessels[1].speed,null);
 assert.throws(()=>core.read({ships:[]},start));assert.throws(()=>core.read(packet(start-600001),start));
 const box=[179.9,0,180.1,.1];assert(core.visible([.05,-179.95],box));assert(!core.visible([.05,0],box));assert(core.covers(core.area(box,13),box));assert(core.covers(core.area([539.9,0,540.1,.1],13),box));assert.equal(core.area([-180,-80,180,80],3),null);
 const state=maps.normalizeLayers({vessels:true,aircraft:true,maritime:true});assert(state.vessels);assert(!maps.normalizeLayers({vessels:'true'}).vessels);assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView,null,state)),state);
});
test('vessels stay opt-in, paginate consistently, retain markers during small pans and share no credentials',async()=>{
 const h=setup();await h.advance(60000);assert.equal(h.calls.length,0);
 h.setFetch(async url=>({ok:true,json:async()=>new URL(url).searchParams.has('cursor')?packet(start+60000,[ship({mmsi:316001235,observed:new Date(start+60000).toISOString()})]):packet(start+60000,undefined,{cursor:'5000'})}));
 h.api.setEnabled(true);await flush();assert.equal(h.calls.length,2);assert.equal(h.markers().length,2);const marker=h.markers()[0];assert.equal(h.credits.size,1);
 await h.move([-123.45,48.3,-123.15,48.5]);h.refresh.events.click();await flush();assert.equal(h.calls.length,2);assert.equal(h.markers()[0],marker);
 assert.equal(new URL(h.calls[1].url).searchParams.get('snapshot'),sid);assert.equal(h.calls[0].credentials,'omit');assert.equal(new URL(h.calls[0].url).hostname,'gregle-vessels.square-rain-5ded.workers.dev');
 h.api.setEnabled(false);assert.equal(h.markers().length,0);assert.equal(h.credits.size,0);await h.advance(60000);assert.equal(h.calls.length,2);
});
test('rate limits survive toggles and stale positions disappear during outages',async()=>{
 const h=setup();h.api.setEnabled(true);await flush();h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '900'}}));await h.advance(60000);assert.equal(h.calls.length,2);assert.match(h.output.textContent,/Updates delayed/);assert.equal(h.markers().length,1);
 h.api.setEnabled(false);h.api.setEnabled(true);h.refresh.events.click();await flush();assert.equal(h.calls.length,2);
 const stale=setup();stale.api.setEnabled(true);await flush();stale.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '900'}}));await stale.advance(605000);assert.equal(stale.markers().length,0);assert.equal(stale.calls.length,2);
});
test('hidden, disabled and bfcache pages cancel pending vessel pages and ignore late results',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);h.document.hidden=true;h.events.visibilitychange();assert(h.calls[0].signal.aborted);release({ok:true,json:async()=>packet(start)});await flush();assert.equal(h.markers().length,0);await h.advance(60000);assert.equal(h.calls.length,1);
 h.setFetch(async()=>({ok:true,json:async()=>packet(start+60000)}));h.document.hidden=false;h.events.visibilitychange();await flush();assert.equal(h.calls.length,2);h.events.pagehide();await h.advance(60000);assert.equal(h.calls.length,2);h.events.pageshow({persisted:true});await flush();assert.equal(h.calls.length,3);
});
test('invalid pagination preserves previous snapshot and vessel popups treat names as text',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>packet(start,[ship({name:'<img src=x onerror=alert(1)>'})])}));h.api.setEnabled(true);await flush();const marker=h.markers()[0],box=marker.popup(),text=e=>e.textContent+' '+e.children.map(text).join(' ');assert(text(box).includes('<img src=x onerror=alert(1)>'));assert(text(box).includes('0.0 kn'));assert(text(box).includes('0°'));assert.equal(marker.options.bubblingMouseEvents,false);
 h.setFetch(async()=>({ok:true,json:async()=>packet(start+60000,undefined,{cursor:'5000',snapshotId:'bad'})}));await h.advance(60000);assert.equal(h.markers()[0],marker);assert.match(h.output.textContent,/Updates delayed/);
});

test('a failed later page preserves freshly received vessels and a subsequent update recovers',async()=>{
 const h=setup();
 h.setFetch(async url=>new URL(url).searchParams.has('cursor')?{ok:false,status:503,headers:{get:()=> '60'}}:{ok:true,json:async()=>packet(start,undefined,{cursor:'5000',pages:3})});
 h.api.setEnabled(true);await flush();assert.equal(h.calls.length,3);assert.equal(h.markers().length,1);assert.match(h.output.textContent,/Updates delayed/);assert(!h.output.textContent.startsWith('0 vessels'));
 const marker=h.markers()[0];h.setFetch(async()=>({ok:true,json:async()=>packet(start+60000)}));await h.advance(60000);assert.equal(h.markers()[0],marker);assert.match(h.output.textContent,/Updated/);assert(!h.output.textContent.includes('Updates delayed'));
});
test('page scans use at most three concurrent requests and one failed page does not hide other regions',async()=>{
 const h=setup(),pending=[];let active=0,max=0;
 h.setFetch(async url=>{
  const cursor=new URL(url).searchParams.get('cursor');
  if(!cursor)return {ok:true,json:async()=>packet(start,undefined,{cursor:'5000',pages:6})};
  active++;max=Math.max(max,active);return new Promise(resolve=>pending.push(()=>{active--;resolve(cursor==='5000'?{ok:false,status:503,headers:{get:()=> '60'}}:{ok:true,json:async()=>packet(start,[ship({mmsi:316001234+Number(cursor)/5000})])});}));
 });
 h.api.setEnabled(true);await flush();assert.equal(active,3);assert.equal(h.calls.length,4);
 while(pending.length){pending.shift()();await flush();}
 assert.equal(max,3);assert.equal(h.calls.length,6);assert.equal(h.markers().length,5);assert.match(h.output.textContent,/Updates delayed/);
});

test('cached pages may use an older source snapshot only with a bounded cache age',async()=>{
 const h=setup();h.setFetch(async url=>({ok:true,json:async()=>new URL(url).searchParams.has('cursor')?packet(start,[ship({mmsi:316001235})],{snapshotId:'aaaaaaaaaaaaaaaaaaaaaaaa',cached:true,cacheAgeSeconds:90,limited:true}):packet(start,undefined,{cursor:'5000',pages:2})}));
 h.api.setEnabled(true);await flush();assert.equal(h.markers().length,2);assert.match(h.output.textContent,/recent reports/);assert.equal(h.output.dataset.state,'ready');
 const expired=setup();expired.setFetch(async url=>({ok:true,json:async()=>new URL(url).searchParams.has('cursor')?packet(start,[ship({mmsi:316001235})],{snapshotId:'aaaaaaaaaaaaaaaaaaaaaaaa',cached:true,cacheAgeSeconds:301}):packet(start,undefined,{cursor:'5000',pages:2})}));
 expired.api.setEnabled(true);await flush();assert.equal(expired.markers().length,1);assert.match(expired.output.textContent,/Updates delayed/);
});
test('refresh progress and returning to the page retain recent vessels without reviving expired reports',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,json:async()=>packet(start,[ship(),ship({mmsi:316001235})])}));h.api.setEnabled(true);await flush();assert.equal(h.markers().length,2);
 h.document.hidden=true;h.events.visibilitychange();assert.equal(h.markers().length,0);h.document.hidden=false;h.events.visibilitychange();await flush();assert.equal(h.markers().length,2);assert.equal(h.calls.length,1);
 let release;h.setFetch(async url=>new URL(url).searchParams.has('cursor')?new Promise(resolve=>release=resolve):{ok:true,json:async()=>packet(start+60000,undefined,{cursor:'5000',pages:2})});
 await h.advance(60000);assert.equal(h.markers().length,2);release({ok:false,status:503,headers:{get:()=> '900'}});await flush();assert.equal(h.markers().length,2);assert.equal(h.output.dataset.state,'ready');
 await h.advance(605000);assert.equal(h.markers().length,0);assert.equal(h.output.dataset.state,'error');
});

test('Open Waters source labels and credits stay text and broad views respect the anonymous area cap',()=>{
 const result=core.read(packet(start,[ship({source:'openwaters',sourceLabel:'Open Waters / AISHub'})],{credits:['<img src=x>']}),start);assert.equal(result.vessels[0].source,'Open Waters / AISHub');assert.equal(result.credits[0],'<img src=x>');assert.equal(core.area([-6,40,6,48],7),null);
});
