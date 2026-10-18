const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/maps-cameras-core.js');
const maps = require('../assets/maps-core.js');
const headers = ['id','cam_group','camName','links_imageURL','links_camDetailsPage','latitude','longitude','caption','credit'];
const camera = (id, group, name, lat, lng, caption = '', credit = '') => [id,group,name,`https://www.drivebc.ca/images/${id}.jpg`,`https://www.drivebc.ca/cameras/${id}`,lat,lng,caption,credit];
const catalogue = (rows) => '\uFEFF' + [headers,...rows].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
const csv = catalogue([camera(511,511,'Saanich - N',48.455865,-123.370795),camera(512,511,'Saanich - S',48.455865,-123.370795),camera(70,67,'Vancouver - S',49.208308,-123.130414)]);

test('camera CSV handles BOM, quoted commas, escaped quotes and embedded newlines; shared locations group views',()=>{
  const groups=core.readCatalogue(catalogue([camera(1,1,'Road, "north" - N',48.45,-123.37,'Line one\nLine two','Photo by <a href="https://example.org">City &amp; Province</a>'),camera(2,1,'Road - S',48.45,-123.37)]));
  assert.equal(groups.length,1);assert.equal(groups[0].cameras.length,2);
  const first=groups[0].cameras.find(camera=>camera.id==='1');
  assert.equal(first.name,'Road, "north" - N');
  assert.equal(first.caption,'Line one\nLine two');
  assert.equal(first.credit,'Photo by City & Province');
  assert.deepEqual(groups[0].point,[48.45,-123.37]);
});

test('camera records reject external image/detail links, bad IDs and coordinates, and deduplicate IDs',()=>{
  const good=camera(1,1,'Safe',48.45,-123.37), bad=camera(2,2,'Unsafe',48.45,-123.37);bad[3]='https://example.org/image.jpg';
  const badPage=camera(3,3,'Unsafe page',48.45,-123.37);badPage[4]='javascript:alert(1)';
  const result=core.readCatalogue(catalogue([good,good,bad,badPage,camera(4,4,'Far away',0,0),camera(5,5,'Missing','',-123.37),camera('x','x','Bad ID',48.45,-123.37)]));
  assert.equal(result.length,1);assert.equal(result[0].cameras.length,1);
  assert.equal(result[0].cameras[0].imageURL,'https://www.drivebc.ca/images/1.jpg');
  assert.throws(()=>core.readCatalogue('Not a CSV feed'));
  assert.throws(()=>core.readCatalogue('"id","cam_group"\n"unfinished'));
  assert.throws(()=>core.readCatalogue('x'.repeat(2000001)));
});

test('webcams are opt-in, independent of road events and retained in saved/shared map state',()=>{
  assert.equal(maps.normalizeLayers({drivebc:true}).webcams,false);
  assert.equal(maps.normalizeLayers({webcams:'true'}).webcams,false);
  const layers=maps.normalizeLayers({webcams:true});
  assert.equal(layers.drivebc,false);
  const hash=maps.makeHash(maps.defaultView,null,layers);
  assert(hash.includes('overlays=webcams'));assert.deepEqual(maps.readLayers(hash),layers);
  assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView,null,{drivebc:true,webcams:true})),maps.normalizeLayers({drivebc:true,webcams:true}));
});

const NOW=Date.parse('2026-10-18T00:00:00Z');
const victoria=[-123.5,48.3,-123.2,48.6], vancouver=[-123.3,49.1,-122.9,49.5];
const response=()=>({ok:true,text:async()=>csv});
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function setup(){
  let now=NOW,bounds=victoria,nextTimer=0,fetchImpl=async()=>response();
  const timers=new Map(),listeners={},calls=[],groups=[],notices=[];
  const output={textContent:'',dataset:{}};
  const map={getBounds:()=>({getWest:()=>bounds[0],getSouth:()=>bounds[1],getEast:()=>bounds[2],getNorth:()=>bounds[3]}),getSize:()=>({x:1440,y:800}),on(type,fn){listeners[type]=fn;},removeLayer(){},attributionControl:{addAttribution(){},removeAttribution(){}}};
  const L={layerGroup(){const group={children:new Set(),removeLayer(m){this.children.delete(m);},clearLayers(){this.children.clear();},addTo(){return this;}};groups.push(group);return group;},divIcon:options=>options,marker:(point,options)=>({point,options,bindPopup(fn){this.popup=fn;return this;},on(){return this;},addTo(group){group.children.add(this);return this;}})};
  class Clock extends Date{static now(){return now;}}
  const context={L,Date:Clock,URL,AbortController,Map,Math,Number,GregleCamerasCore:core,document:{hidden:false,getElementById:()=>output,addEventListener(type,fn){listeners[type]=fn;}},addEventListener(type,fn){listeners[type]=fn;},setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},fetch(url,options){calls.push({url,signal:options.signal});return fetchImpl(url,options);}};
  context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-cameras.js'),'utf8'),context);
  const api=context.GregleDriveBCCameras({map,config:{cameraCatalogueURL:'https://catalogue.data.gov.bc.ca/webcams.csv'},notify:message=>notices.push(message)});
  async function advance(ms){const target=now+ms;for(let i=0;i<100;i++){const due=[...timers.entries()].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!due){now=target;await flush();return;}now=due[1].due;timers.delete(due[0]);due[1].fn();await flush();}throw Error('Timers did not settle');}
  return {api,calls,output,advance,listeners,document:context.document,setFetch:fn=>fetchImpl=fn,markers:()=>[...groups[0].children],async move(next){bounds=next;listeners.moveend();await advance(150);}};
}

test('camera panning reuses one catalogue, retains marker identity and handles wrapped/off-BC views',async()=>{
  const h=setup();assert.equal(h.calls.length,0);h.api.setEnabled(true);await flush();
  assert.equal(h.calls.length,1);const marker=h.markers()[0];assert.match(marker.options.title,/Saanich.*2 views/);
  await h.move([-123.49,48.31,-123.21,48.59]);assert.equal(h.markers()[0],marker);
  await h.move(vancouver);assert.match(h.markers()[0].options.title,/Vancouver/);
  await h.move([236.5,48.3,236.8,48.6]);assert.match(h.markers()[0].options.title,/Saanich/);
  await h.move([-.3,51.3,.1,51.7]);assert.equal(h.markers().length,0);assert.match(h.output.textContent,/British Columbia/);
  await h.move(victoria);assert.equal(h.calls.length,1);assert.equal(h.markers().length,1);
  await h.advance(3600000);assert.equal(h.calls.length,2);
});

test('camera movement during a pending request neither cancels nor duplicates it and uses the latest view',async()=>{
  const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);
  await h.move(vancouver);await h.move(victoria);await h.move(vancouver);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].signal.aborted,false);
  release(response());await flush();assert.match(h.markers()[0].options.title,/Vancouver/);
});

test('camera failures honour Retry-After across toggles and pans, preserve cached locations and recover',async()=>{
  const h=setup();h.api.setEnabled(true);await flush();
  h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '300'}}));await h.advance(3600000);
  assert.equal(h.calls.length,2);assert.equal(h.markers().length,1);assert.match(h.output.textContent,/could not refresh/);
  await h.move(vancouver);h.api.setEnabled(false);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,2);
  h.setFetch(async()=>response());await h.advance(299849);assert.equal(h.calls.length,2);
  await h.advance(1);assert.equal(h.calls.length,3);assert.equal(h.output.dataset.state,'ready');
});

test('hidden or disabled camera layers abort work and ignore late responses',async()=>{
  const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);
  h.document.hidden=true;h.listeners.visibilitychange();assert.equal(h.calls[0].signal.aborted,true);
  h.api.setEnabled(false);release(response());await flush();assert.equal(h.markers().length,0);
  await h.advance(3600000);assert.equal(h.calls.length,1);
});
