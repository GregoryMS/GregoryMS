const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/maps-signs-core.js'),maps=require('../assets/maps-core.js');
const NOW=Date.parse('2026-10-18T02:10:00Z');
const speedData={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[-123.3,49.1]},properties:{id:1,vslsId:'Test sign',status:'Operational',isSegmentEnabled:true,postedSpeed:80,maxSpeed:100,receivedDate:'2026-10-18T02:08:00Z',postedDate:'2026-10-15T03:00:00Z'}}]};
const messageData={source:'https://www.drivebc.ca/api/dms/',fetchedAt:'2026-10-18T02:09:00Z',signs:[{id:'DMS1',name:'Test message',status:'OK',location:{type:'Point',coordinates:[-123.31,49.11]},message_text:'[jl3]ROAD[nl]WORK[np]SLOW DOWN',updated_datetime_utc:'2026-10-01T00:00:00Z'}]};

test('sign feeds validate geometry and readings while keeping messages as inert text',()=>{
 const parsed=core.readSpeed(speedData).signs[0];assert.equal(parsed.posted,80);assert.deepEqual(parsed.point,[49.1,-123.3]);assert(core.available(parsed,'speed',NOW));
 assert.equal(core.readSpeed({...speedData,features:[{...speedData.features[0],geometry:{type:'Point',coordinates:['-123',49]}}]}).signs.length,0);
 assert.equal(core.readSpeed({...speedData,features:[{...speedData.features[0],properties:{...speedData.features[0].properties,postedSpeed:'<script>'}}]}).signs[0].posted,null);
 const message=core.readMessages(messageData).signs[0];assert.deepEqual(message.pages,['ROAD\nWORK','SLOW DOWN']);assert(core.available(message,'messages',NOW));
 assert.equal(core.cleanMessage('[ALIGN_CENTER]<img onerror=alert(1)>'),'<img onerror=alert(1)>');
 assert.throws(()=>core.readMessages({...messageData,source:'https://example.org/'}));
});

test('stale receipts, offline signs, expired messages and future-dated snapshots cannot become current readings',()=>{
 const speed=core.readSpeed(speedData).signs[0],message=core.readMessages(messageData).signs[0];
 assert(!core.available(speed,'speed',NOW+900001));assert(!core.available({...speed,enabled:false},'speed',NOW));
 assert(!core.available({...speed,status:'Offline'},'speed',NOW));assert(!core.available({...speed,received:null},'speed',NOW));
 assert(!core.available(message,'messages',NOW+2700001));assert(!core.available({...message,expires:'2026-10-18T02:00:00Z'},'messages',NOW));
 assert(!core.available({...message,status:'Connection Error'},'messages',NOW));assert(!core.available({...message,fetched:'2026-10-19T02:00:00Z'},'messages',NOW));
 assert(core.available({...message,changed:'2020-01-01T00:00:00Z'},'messages',NOW),'an unchanged message is distinct from a stale feed');
});

test('future-event starts use DriveBC UTC timestamps, earliest intervals and conservative unknown schedules',()=>{
 assert.equal(maps.roadStart({intervals:['2026-10-20T16:00/2026-10-20T20:00']}),'2026-10-20T16:00:00.000Z');
 assert.equal(maps.roadStart({intervals:['2026-10-20T09:00-07:00/','2026-10-19T08:00Z/']}),'2026-10-19T08:00:00.000Z');
 for(const schedule of [null,{intervals:['/2026-10-20T10:00']},{intervals:['2026-02-30T12:00/']},{intervals:['garbage/']},{intervals:['2026-10-20T16:00/',null]}]) assert.equal(maps.roadStart(schedule),null);
 const layers=maps.normalizeLayers({drivebc:true,future:true,speed:true,messages:true,webcams:true});
 assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView,null,layers)),layers);
 assert.equal(maps.normalizeLayers({drivebc:true}).future,false);assert.equal(maps.normalizeLayers({speed:'true'}).speed,false);
});

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function setup(){
 let now=NOW,bounds=[-123.5,49,-123.1,49.3],nextTimer=0,fetchImpl=async url=>({ok:true,json:async()=>url.includes('speed')?speedData:messageData});
 const timers=new Map(),listeners={},calls=[],groups=[];const outputs={speed:{dataset:{}},messages:{dataset:{}}};
 const listen=(key,fn)=>(listeners[key]??=[]).push(fn);
 const map={getBounds:()=>({getWest:()=>bounds[0],getSouth:()=>bounds[1],getEast:()=>bounds[2],getNorth:()=>bounds[3]}),getSize:()=>({x:1440,y:900}),on:listen,removeLayer(){},attributionControl:{addAttribution(){},removeAttribution(){}}};
 const L={layerGroup(){const g={children:new Set(),removeLayer(m){this.children.delete(m);},clearLayers(){this.children.clear();},addTo(){return this;}};groups.push(g);return g;},divIcon:options=>options,marker:(point,options)=>({point,options,bindPopup(fn){this.popup=fn;return this;},setLatLng(point){this.point=point;return this;},setIcon(icon){this.options.icon=icon;return this;},setPopupContent(fn){this.popup=fn;return this;},addTo(g){g.children.add(this);return this;}})};
 class Clock extends Date{static now(){return now;}}
 const context={L,Date:Clock,URL,AbortController,Map,Set,Math,Number,JSON,GregleSignsCore:core,document:{hidden:false,getElementById:id=>id.includes('-speed-')?outputs.speed:outputs.messages,addEventListener:listen},addEventListener:listen,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},fetch(url,options){calls.push({url,signal:options.signal});return fetchImpl(url,options);}};
 context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-signs.js'),'utf8'),context);
 const api=context.GregleDriveBCSigns({map,config:{speedSignsURL:'https://speed.test',messageSignsURL:'/data/messages.json'},notify(){}});
 async function advance(ms){const target=now+ms;for(let i=0;i<200;i++){const due=[...timers.entries()].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!due){now=target;await flush();return;}now=due[1].due;timers.delete(due[0]);due[1].fn();await flush();}throw Error('Timer loop');}
 return {api,calls,outputs,advance,document:context.document,fire:key=>(listeners[key]||[]).forEach(fn=>fn()),setFetch:fn=>fetchImpl=fn,markers:type=>[...groups[type==='speed'?0:1].children],async move(b){bounds=b;this.fire('moveend');await advance(150);}};
}

test('sign toggles are independent and panning reuses feed snapshots and marker objects',async()=>{
 const h=setup();assert.equal(h.calls.length,0);h.api.setEnabled('speed',true);h.api.setEnabled('messages',true);await flush();assert.equal(h.calls.length,2);
 const marker=h.markers('speed')[0];await h.move([-123.49,49.01,-123.11,49.29]);assert.equal(h.markers('speed')[0],marker);assert.equal(h.calls.length,2);
 h.api.setEnabled('messages',false);assert.equal(h.markers('messages').length,0);assert.equal(h.markers('speed').length,1);
 await h.move([-.1,51,.1,52]);assert.equal(h.markers('speed').length,0);await h.move([-123.5,49,-123.1,49.3]);assert.equal(h.calls.length,2);
});

test('sign rate limits survive toggles and stale numeric values clear before a delayed retry',async()=>{
 const h=setup();h.api.setEnabled('speed',true);await flush();h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '1200'}}));
 await h.advance(120000);assert.equal(h.calls.length,2);h.api.setEnabled('speed',false);h.api.setEnabled('speed',true);await flush();assert.equal(h.calls.length,2);
 await h.advance(660001);assert.equal(h.calls.length,2);assert(h.markers('speed')[0].options.icon.html.includes('?'));
});

test('hidden or disabled sign layers abort pending work and ignore late results',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled('messages',true);
 h.document.hidden=true;h.fire('visibilitychange');assert(h.calls[0].signal.aborted);h.api.setEnabled('messages',false);
 release({ok:true,json:async()=>messageData});await flush();assert.equal(h.markers('messages').length,0);await h.advance(300000);assert.equal(h.calls.length,1);
});
