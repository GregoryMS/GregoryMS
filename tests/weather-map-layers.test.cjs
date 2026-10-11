const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {embedURL}=require('../assets/weather-map-layers.js');
const vancouver={name:'Vancouver',latitude:49.24,longitude:-123.12};

test('forecast embeds use the selected coordinates, requested layer and metric units',()=>{
  for(const layer of ['wind','clouds','fog']) {
    const url=new URL(embedURL(layer,vancouver));
    assert.equal(url.origin,'https://embed.windy.com');
    assert.equal(url.searchParams.get('overlay'),layer);
    assert.equal(url.searchParams.get('lat'),'49.24');assert.equal(url.searchParams.get('lon'),'-123.12');
    assert.equal(url.searchParams.get('metricWind'),'km/h');assert.equal(url.searchParams.get('product'),'ecmwf');
  }
  for(const location of [{latitude:NaN,longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:-181}])assert.throws(()=>embedURL('wind',location));
  assert.throws(()=>embedURL('unknown',vancouver));
});

function setup() {
  const elements=new Map(),frames=[],events={},timers=new Map();let nextTimer=0,paused=0,resumed=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{checked:false,hidden:false,events:{},addEventListener(k,fn){this.events[k]=fn;},replaceChildren(frame){this.child=frame;}});
    return elements.get(id);
  };
  const context={URLSearchParams,console,
    document:{getElementById:element,addEventListener(k,fn){events[k]=fn;},createElement(){const frame={events:{},addEventListener(k,fn){this.events[k]=fn;},remove(){this.removed=true;}};frames.push(frame);return frame;}},
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    addEventListener(k,fn){events[k]=fn;},GregleRadar:{pause(){paused++;},resumeView(){resumed++;}}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/weather-map-layers.js'),'utf8'),context);
  const api=context.GregleWeatherLayers;api.setLocation(vancouver);events.DOMContentLoaded();
  function select(layer){const input=element(`radarLayer-${layer}`);input.checked=true;input.events.change();}
  return {api,element,frames,events,timers,select,paused:()=>paused,resumed:()=>resumed};
}

test('radar is the default without a Windy request; switching pauses radar and releases old frames',()=>{
  const h=setup();assert.equal(h.frames.length,0);assert.equal(h.api.active(),false);
  h.select('wind');assert.equal(h.frames.length,1);assert.equal(h.paused(),1);
  assert.equal(h.element('radarObserved').hidden,true);assert.equal(h.element('radarForecast').hidden,false);
  h.select('clouds');assert.equal(h.frames[0].removed,true);
  assert.equal(new URL(h.frames[1].src).searchParams.get('overlay'),'clouds');
  h.select('radar');assert.equal(h.frames[1].removed,true);assert.equal(h.element('radarForecast').hidden,true);
  assert.equal(h.resumed(),2);assert.equal(h.api.active(),false);
});

test('city changes and recenter replace the frame, preserving the selected layer',()=>{
  const h=setup();h.select('clouds');h.api.setLocation({name:'Victoria',latitude:48.43,longitude:-123.36});
  assert.equal(h.frames[0].removed,true);assert.match(h.frames[1].title,/Victoria/);
  assert.equal(new URL(h.frames[1].src).searchParams.get('lat'),'48.43');
  h.element('radarForecastRecenter').events.click();assert.equal(h.frames[1].removed,true);
  assert.equal(h.frames[2].src,h.frames[1].src);
  h.api.setLocation({name:'Victoria',latitude:48.43,longitude:-123.36});assert.equal(h.frames.length,3);
});

test('late frame callbacks cannot hide loading for a newer selection; timeout has a recovery path',()=>{
  const h=setup();h.select('wind');const late=h.frames[0].events.load;
  h.select('clouds');late();assert.equal(h.element('radarLayerStatus').hidden,false);
  for(const callback of h.timers.values())callback();assert.match(h.element('radarLayerStatus').textContent,/Try Refresh/);
  h.frames[1].events.load();assert.equal(h.element('radarLayerStatus').hidden,true);
  assert.equal(h.element('radarWindyLink').href,h.frames[1].src);
});

test('back-forward restoration recreates the active forecast; radar remains iframe-free',()=>{
  const h=setup();h.select('wind');h.events.pagehide();assert.equal(h.frames[0].removed,true);
  h.events.pageshow({persisted:true});assert.equal(h.frames.length,2);
  h.select('radar');h.events.pagehide();h.events.pageshow({persisted:true});assert.equal(h.frames.length,2);
});

 test('fog behaves like the other forecasts and remains selected across location changes',()=>{
  const h=setup();h.select('fog');
  assert.equal(h.element('radarMode').textContent,'Fog forecast');
  assert.equal(h.element('radarObserved').hidden,true);
  h.api.setLocation({name:'Tofino',latitude:49.15,longitude:-125.91});
  const url=new URL(h.frames.at(-1).src);
  assert.equal(url.searchParams.get('overlay'),'fog');
  assert.equal(url.searchParams.get('lon'),'-125.91');
  h.select('radar');assert.equal(h.frames.at(-1).removed,true);
});


test('smoke uses its native panel without a Windy iframe and restores other layers',()=>{
  const h=setup();h.select('smoke');
  assert.equal(h.frames.length,0);assert.equal(h.element('radarSmoke').hidden,false);
  assert.equal(h.element('radarForecast').hidden,true);assert.equal(h.element('radarObserved').hidden,true);
  assert.equal(h.element('radarMode').textContent,'Wildfire smoke forecast · PM₂.₅');
  h.select('wind');assert.equal(h.element('radarSmoke').hidden,true);assert.equal(h.frames.length,1);
  h.select('radar');assert.equal(h.element('radarSmoke').hidden,true);assert.equal(h.api.active(),false);
});

test('precipitation type uses its own panel and keeps forecast embeds separate',()=>{
  const h=setup();h.select('ptype');
  assert.equal(h.frames.length,0);assert.equal(h.element('radarPrecipType').hidden,false);
  assert.equal(h.element('radarForecast').hidden,true);assert.equal(h.element('radarObserved').hidden,true);
  assert.match(h.element('radarMode').textContent,/Surface precipitation type/);
  h.select('smoke');assert.equal(h.element('radarPrecipType').hidden,true);
  h.select('radar');assert.equal(h.element('radarPrecipType').hidden,true);assert.equal(h.api.active(),false);
});
