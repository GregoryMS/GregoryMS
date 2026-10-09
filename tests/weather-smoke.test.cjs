const {test}=require('node:test');
const assert=require('node:assert/strict');
const {forecast,inCoverage,currentFrame,createController}=require('../assets/weather-smoke.js');
const NOW=Date.parse('2026-10-09T15:00:00Z');
const fixture=()=>({start:'2026-10-09T08:00:00Z',bounds:[[32,-160],[70,-52]],frames:[8,11,14,17,20].map(hour=>({time:`2026-10-09T${hour.toString().padStart(2,'0')}:00:00Z`,image:'data:image/png;base64,iVBORw0KGgo='}))});
test('smoke metadata rejects stale, expired, malformed and non-image payloads',()=>{
  assert.equal(forecast(fixture(),NOW).frames.length,5);
  for(const mutate of [d=>d.start='bad',d=>d.start='2026-10-01T08:00:00Z',d=>d.bounds[0][0]=80,d=>d.frames.reverse(),d=>d.frames[0].image='https://evil.example/image',d=>d.frames[0].image='data:image/svg+xml;base64,abc']) {
    const d=fixture();mutate(d);assert.throws(()=>forecast(d,NOW));
  }
  assert.throws(()=>forecast(fixture(),NOW+24*3600000));
});
test('coverage and initial hour follow selected coordinates and current time',()=>{
  const d=forecast(fixture(),NOW);
  assert.equal(inCoverage(d.bounds,{latitude:48.42,longitude:-123.39}),true);
  assert.equal(inCoverage(d.bounds,{latitude:51.5,longitude:-.1}),false);
  assert.equal(currentFrame(d.frames,NOW),2);
  assert.equal(currentFrame(d.frames,NOW-24*3600000),0);
});
function harness() {
  const nodes=new Map(),events={},timers=new Map(),layers=[],maps=[];let timerId=0,fetchImpl=async()=>({ok:true,json:async()=>fixture()});
  const node=id=>{if(!nodes.has(id))nodes.set(id,{events:{},textContent:'',value:0,addEventListener(t,f){this.events[t]=f;},setAttribute(k,v){this[k]=v;}});return nodes.get(id);};
  const layer=()=>{const l={events:{},on(t,f){this.events[t]=f;return this;},off(){this.events={};},addTo(){return this;},setOpacity(value){this.opacity=value;},setLatLng(){}};return l;};
  class Clock extends Date {static now(){return NOW;}}
  const win={Date:Clock,AbortController,document:{getElementById:node,addEventListener(t,f){events[t]=f;}},addEventListener(t,f){events[t]=f;},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},setInterval(){},
    fetch(...args){return fetchImpl(...args);},L:{map(){const m={setView(){},invalidateSize(){},removeLayer(l){l.removed=true;},remove(){this.removed=true;}};maps.push(m);return m;},tileLayer:layer,circleMarker:layer,rectangle:layer,imageOverlay(){const l=layer();layers.push(l);return l;}}};
  const api=createController(win);events.DOMContentLoaded();api.setLocation({name:'Victoria',latitude:48.42,longitude:-123.39,timezone:'America/Vancouver'});
  return {api,node,layers,maps,timers,setFetch:fn=>fetchImpl=fn};
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
test('smoke loads on demand, displays loaded frames, and releases the map when hidden',async()=>{
  const h=harness();assert.equal(h.maps.length,0);
  h.api.setActive(true);await flush();assert.equal(h.layers.length,1);
  assert.equal(h.layers[0].opacity,undefined);h.layers[0].events.load();await flush();
  assert.equal(h.layers[0].opacity,1);assert.match(h.node('smokeTimestamp').textContent,/Oct 9/);
  assert.equal(h.node('smokeTime').value,'2');
  h.api.setActive(false);assert.equal(h.maps[0].removed,true);
});
test('a superseded frame and late metadata cannot overwrite a new tab selection',async()=>{
  const h=harness();h.api.setActive(true);await flush();const late=h.layers[0].events.load;
  h.api.setActive(false);late();await flush();assert.equal(h.layers[0].opacity,undefined);
  let resolve;h.setFetch(()=>new Promise(r=>resolve=r));h.api.setActive(true);h.api.setActive(false);
  resolve({ok:true,json:async()=>fixture()});await flush();assert.equal(h.layers.length,1);
});
test('failed refresh disables the timeline and removes any old smoke image',async()=>{
  const h=harness();h.api.setActive(true);await flush();h.layers[0].events.load();await flush();
  h.setFetch(async()=>{throw Error('offline');});await h.api.refresh();
  assert.equal(h.layers[0].removed,true);assert.equal(h.node('smokeTime').disabled,true);assert.match(h.node('smokeStatus').textContent,/unavailable or outdated/);
});
test('image errors keep an explicit failure message and stop playback',async()=>{
  const h=harness();h.api.setActive(true);await flush();h.layers[0].events.error();await flush();
  assert.match(h.node('smokeStatus').textContent,/image could not load/);assert.equal(h.node('smokePlay')['aria-pressed'],'false');
});
