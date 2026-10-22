const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../assets/maps-core.js');
function setup(){
  const nodes=new Map(),events={},mapEvents={},timers=new Map(),created=[];let next=0,view={lat:48.4284,lng:-123.3656,zoom:9};
  class Element{
    constructor(){this.hidden=true;this.children=[];this.events={};this.attrs={};this.textContent='';this.inert=false;const classes=new Set();this.classList={contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)};}
    addEventListener(type,fn){this.events[type]=fn;}setAttribute(k,v){this.attrs[k]=String(v);}
    append(child){this.children.push(child);child.parent=this;}
    remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const window={GregleMaps:core,addEventListener:(type,fn)=>events[type]=fn};
  const document={getElementById:get,querySelector:()=>get('stage'),createElement:()=>{const frame=new Element();created.push(frame);return frame;}};
  const map={getCenter:()=>({lat:view.lat,lng:view.lng}),getZoom:()=>view.zoom,getBounds:()=>({getWest:()=>-124,getEast:()=>-123,getNorth:()=>49,getSouth:()=>48}),on:(type,fn)=>mapEvents[type]=fn};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-embed.js'),'utf8'),{window,document,setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
  const api=window.GregleMapEmbed({map});
  return{api,get,events,mapEvents,timers,created,move:nextView=>{if(nextView)view=nextView;mapEvents.moveend();},fireTimers:ms=>{for(const [id,timer] of [...timers])if(timer.ms<=ms){timers.delete(id);timer.fn();}}};
}
test('embeds load only on selection, open at the Gregle view, and leave a direct full-map fallback',()=>{
  const h=setup();assert.equal(h.created.length,0);h.api.setBase('street');assert.equal(h.created.length,0);
  h.api.setBase('adsbexchange');const frame=h.created[0],url=new URL(frame.src);
  assert.equal(url.hostname,'globe.adsbexchange.com');assert.equal(+url.searchParams.get('lat'),48.4284);assert.equal(+url.searchParams.get('zoom'),9);
  assert.equal(frame.title,'ADS-B Exchange live aircraft map');assert.equal(frame.referrerPolicy,'strict-origin-when-cross-origin');
  assert(!frame.allow.includes('geolocation'));assert(h.get('gregle-map').inert);assert(h.get('stage').classList.contains('embedded-active'));
  assert.equal(h.get('embedded-title').textContent,'ADS-B Exchange');assert(!h.get('embedded-map').hidden);
  assert.equal(new URL(h.get('embedded-full-map').href).origin,'https://globe.adsbexchange.com');
  frame.events.load();assert(h.get('embedded-status').hidden);assert.equal(h.timers.size,0);
});
test('switching providers keeps only one iframe and ignores stale callbacks from a removed provider',()=>{
  const h=setup();h.api.setBase('adsbexchange');const old=h.created[0];h.api.setBase('plugshare');
  assert.equal(h.get('embedded-frame').children.length,1);assert.equal(old.parent,null);
  assert.equal(new URL(h.created[1].src).pathname,'/widget2.html');assert.equal(h.get('embedded-title').textContent,'PlugShare');
  assert(h.created[1].allow.includes('geolocation'));old.events.load();old.events.error();assert.match(h.get('embedded-status').textContent,/Loading PlugShare/);
  h.api.setBase('topographic');assert.equal(h.get('embedded-frame').children.length,0);assert(h.get('embedded-map').hidden);
  assert(!h.get('gregle-map').inert);assert(!h.get('stage').classList.contains('embedded-active'));assert.equal(h.timers.size,0);
});
test('resizing preserves the independent frame view, while a new Gregle view recentres it',()=>{
  const h=setup();h.api.setBase('adsbexchange');const frame=h.created[0];h.move();h.api.setBase('adsbexchange');
  assert.equal(h.created.length,1);assert.equal(h.get('embedded-frame').children[0],frame);
  h.move({lat:49,lng:-123,zoom:8});assert.equal(h.created.length,2);assert.equal(frame.parent,null);
  assert.equal(+new URL(h.created[1].src).searchParams.get('lat'),49);
});
test('long loads and errors retain the website fallback, and late load events clear the notice',()=>{
  const h=setup();h.api.setBase('adsbexchange');h.fireTimers(20000);
  assert(!h.get('embedded-status').hidden);assert.match(h.get('embedded-status').textContent,/Open full map/);
  assert.match(h.get('embedded-full-map').href,/globe.adsbexchange.com/);h.created[0].events.load();assert(h.get('embedded-status').hidden);
  h.created[0].events.error();assert.match(h.get('embedded-status').textContent,/could not load/);
});
test('page lifecycle removes the frame and resumes only the selected provider after restoration',()=>{
  const h=setup();h.api.setBase('adsbexchange');h.events.pagehide();assert.equal(h.get('embedded-frame').children.length,0);assert.equal(h.timers.size,0);
  h.events.pageshow({persisted:true});assert.equal(h.created.length,2);assert.equal(h.get('embedded-frame').children.length,1);
  h.api.setBase('street');h.events.pageshow({persisted:true});assert.equal(h.created.length,2);
});
test('pinch protection applies only to cancellable frame gestures and is removed when switching maps',()=>{
  const h=setup();h.api.setBase('adsbexchange');const frame=h.created[0];let cancelled=0;
  const fire=extra=>h.get('embedded-frame').events.wheel({type:'wheel',target:frame,ctrlKey:true,cancelable:true,preventDefault:()=>cancelled++,...extra});
  fire({ctrlKey:false});fire({cancelable:false});fire({target:h.get('other')});assert.equal(cancelled,0);
  fire({});assert.equal(cancelled,1);assert(!h.get('embedded-zoom-help').hidden);
  h.api.setBase('street');assert(h.get('embedded-zoom-help').hidden);fire({});assert.equal(cancelled,1);
});
