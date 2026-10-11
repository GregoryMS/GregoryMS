const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../assets/weather-precip-type.js');
const end=Date.parse('2026-10-11T01:00:00Z');
const dimension='2026-10-10T22:00:00Z/2026-10-11T01:00:00Z/PT6M';
test('only valid, recent six-minute observations are used; WMS uses exact source timestamps',()=>{
  const frames=core.framesFrom(dimension,end+60000);
  assert.equal(frames.length,31);assert.equal(frames.at(-1),end);
  assert.equal(core.layerOptions(end).time,'2026-10-11T01:00:00Z');
  assert.equal(core.layerOptions(end).layers,'Radar_1km_SfcPrecipType');
  for(const d of ['',dimension.replace('PT6M','PT10M'),dimension.replace('22:00','02:00'),dimension.replace('2026-10-10','2026-10-12')])assert.throws(()=>core.framesFrom(d,end));
  assert.throws(()=>core.framesFrom(dimension,end+31*60000));assert.throws(()=>core.framesFrom(dimension,end-120000));
});
async function setup(){
  const elements=new Map(),events={},maps=[],layers=[],timers=new Map();let nextTimer=0,fail=false,held=null;
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'0',textContent:'',events:{},attributes:{},addEventListener(k,f){this.events[k]=f;},setAttribute(k,v){this.attributes[k]=v;}});return elements.get(id);};
  function layer(options){const l={options,events:{},opacity:0,removed:false,on(k,f){this.events[k]=f;return this;},off(){this.events={};},addTo(){return this;},setOpacity(v){this.opacity=v;},redraw(){}};layers.push(l);return l;}
  const tileLayer=()=>layer({});tileLayer.wms=(url,options)=>layer(options);
  const win={Date:{now:()=>end+60000},AbortController,document:{hidden:false,getElementById:element,addEventListener(k,f){events[k]=f;}},
    setTimeout(f){timers.set(++nextTimer,f);return nextTimer;},clearTimeout(id){timers.delete(id);},setInterval(){},addEventListener(k,f){events[k]=f;},
    fetch:async()=>{if(held)await held;if(fail)throw Error('offline');return {ok:true,text:async()=>dimension};},
    DOMParser:class{parseFromString(text){return {getElementsByTagName:()=>[{getAttribute:()=> 'time',textContent:text}]};}},
    L:{tileLayer,circleMarker:()=>({addTo(){return this;},setLatLng(){}}),map(){const map={events:{},on(k,f){this.events[k]=f;},setView(){},invalidateSize(){},removeLayer(l){l.removed=true;},remove(){this.removed=true;}};maps.push(map);return map;}}
  };
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const api=core.createController(win);events.DOMContentLoaded();api.setLocation({latitude:48.43,longitude:-123.36,timezone:'America/Vancouver'});
  const latest=()=>layers.filter(l=>l.options.layers).at(-1);
  async function load(){latest().events.load?.();await flush();}
  return {api,win,element,events,maps,layers,timers,latest,load,flush,fail:()=>{fail=true;},hold:()=>{let release;held=new Promise(r=>release=r);return release;}};
}
test('map loads only when selected and changes the timestamp only after tiles complete',async()=>{
  const h=await setup();assert.equal(h.maps.length,0);h.api.setActive(true);await h.flush();
  assert.equal(h.latest().opacity,0);await h.load();assert.equal(h.latest().opacity,.8);
  assert.match(h.element('ptypeTimestamp').textContent,/6:00/);
  h.element('ptypeTime').value='0';h.element('ptypeTime').events.input();await h.flush();
  assert.equal(h.element('ptypeTime').value,'30');await h.load();assert.equal(h.element('ptypeTime').value,'0');
});
test('rapid scrubbing discards superseded imagery and failed tiles keep the last timestamp',async()=>{
  const h=await setup();h.api.setActive(true);await h.flush();await h.load();const stamp=h.element('ptypeTimestamp').textContent;
  h.element('ptypeTime').value='1';h.element('ptypeTime').events.input();const first=h.latest(),late=first.events.load;
  h.element('ptypeTime').value='2';h.element('ptypeTime').events.input();late();await h.flush();
  assert(first.removed);assert.equal(h.element('ptypeTimestamp').textContent,stamp);
  h.latest().events.tileerror();await h.flush();assert.equal(h.element('ptypeTimestamp').textContent,stamp);
  assert.match(h.element('ptypeStatus').textContent,/previous image/);
});
test('switching tabs cancels pending data and image loads without rebuilding a hidden map',async()=>{
  const h=await setup(),release=h.hold();h.api.setActive(true);await h.flush();h.api.setActive(false);release();await h.flush();
  assert.equal(h.latest(),undefined);assert(h.maps[0].removed);
  h.api.setActive(true);await h.flush();const late=h.latest().events.load;h.api.setActive(false);late();await h.flush();
  assert(h.maps.at(-1).removed);assert(h.latest().removed);
});
test('play/pause, map movement, and failed refresh leave explicit consistent states',async()=>{
  const h=await setup();h.api.setActive(true);await h.flush();await h.load();
  h.element('ptypePlay').events.click();const late=h.latest().events.load;h.element('ptypePlay').events.click();late();await h.flush();
  assert.equal(h.element('ptypePlay').attributes['aria-pressed'],'false');
  h.maps[0].events.movestart();h.maps[0].events.moveend();await h.flush();await h.load();assert.equal(h.latest().opacity,.8);
  h.fail();h.api.refresh();await h.flush();assert.equal(h.element('ptypeTime').disabled,true);assert(h.latest().removed);assert.match(h.element('ptypeStatus').textContent,/unavailable or delayed/);
});
