const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function setup() {
  const elements=new Map(),requests=[],layers=[],timers=new Map();let timer=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{checked:false,disabled:true,hidden:true,events:{},img:{src:''},
      addEventListener(name,fn){this.events[name]=fn;},querySelector(){return this.img;}});
    return elements.get(id);
  };
  class DOMParser {
    parseFromString(text) {
      const data=JSON.parse(text);
      const children=[{localName:'Name',textContent:data.name},...['time','reference_time'].map(name=>({localName:'Dimension',getAttribute:key=>key==='name'?name:data[name]}))];
      return {querySelector:()=>null,querySelectorAll:()=>[{children}]};
    }
  }
  const map={removeLayer(l){l.removed=true;}},events={};
  const context={URLSearchParams,AbortController,Date,DOMParser,console,
    document:{hidden:false,getElementById:element},
    setTimeout(fn){const id=++timer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    setInterval(){return 1;},clearInterval(){},addEventListener(k,fn){events[k]=fn;},
    fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));},
    L:{tileLayer:{wms(url,options){const l={options,events:{},removed:false,on(k,fn){this.events[k]=fn;},off(){this.events={};},addTo(){layers.push(this);return this;}};return l;}}}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/weather-map-layers.js'),'utf8'),context);
  const api=context.GregleWeatherLayers.attach(map,()=>({timezone:'America/Vancouver'}));
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  async function toggle(key,checked){const el=element(`radarLayer-${key}`);el.checked=checked;el.events.change();await flush();}
  async function resolve(index,overrides={}) {
    const req=requests[index],name=new URL(req.url).searchParams.get('LAYERS');
    req.resolve({ok:true,text:async()=>JSON.stringify({name,time:new Date().toISOString(),reference_time:new Date().toISOString(),...overrides})});await flush();
  }
  return {api,element,requests,layers,timers,events,toggle,resolve,flush};
}

test('layers are opt-in, use explicit forecast times, and stack clouds below wind',async()=>{
  const h=setup();assert.equal(h.requests.length,0);
  await h.toggle('wind',true);await h.toggle('clouds',true);
  await h.resolve(0);await h.resolve(1);
  const [wind,clouds]=h.layers;
  assert.equal(wind.options.styles,'WINDARROWKMH');assert.equal(clouds.options.styles,'CLOUD');
  assert.ok(clouds.options.zIndex<300 && wind.options.zIndex>300);
  assert.ok(wind.options.time && wind.options.dim_reference_time);
  wind.events.load();clouds.events.load();
  assert.match(h.element('radarLayerStatus').textContent,/Wind forecast:.*Clouds forecast:/);
});

test('turning off cancels metadata and ignores late completions',async()=>{
  const h=setup();await h.toggle('wind',true);await h.toggle('wind',false);
  assert.ok(h.requests[0].options.signal.aborted);await h.resolve(0);
  assert.equal(h.layers.length,0);assert.equal(h.element('radarLayerStatus').hidden,true);
  await h.toggle('wind',true);await h.resolve(1);await h.toggle('wind',false);
  assert.equal(h.layers[0].removed,true);assert.equal(h.element('radarLegend-wind').hidden,true);
});

test('tile errors remove only the failed overlay and Refresh retries enabled layers',async()=>{
  const h=setup();await h.toggle('wind',true);await h.toggle('clouds',true);await h.resolve(0);await h.resolve(1);
  h.layers[0].events.tileerror();h.layers[1].events.load();
  assert.equal(h.layers[0].removed,true);assert.equal(h.layers[1].removed,false);
  assert.match(h.element('radarLayerStatus').textContent,/Wind unavailable.*Clouds forecast:/);
  await h.toggle('clouds',false);h.api.refresh();
  assert.equal(h.requests.length,3);await h.resolve(2);h.layers[2].events.load();
  assert.match(h.element('radarLayerStatus').textContent,/^Wind forecast:/);
});

test('old forecasts fail visibly rather than being labelled current',async()=>{
  const h=setup();await h.toggle('clouds',true);await h.resolve(0,{time:'2000-01-01T00:00:00Z'});
  assert.equal(h.layers.length,0);assert.match(h.element('radarLayerStatus').textContent,/Clouds unavailable/);
});

test('a refresh supersedes pending metadata and tile callbacks',async()=>{
  const h=setup();await h.toggle('wind',true);h.api.refresh();await h.resolve(0);
  assert.equal(h.layers.length,0);await h.resolve(1);
  const late=h.layers[0].events.load;h.api.refresh();late();
  assert.match(h.element('radarLayerStatus').textContent,/Loading wind/);
  await h.resolve(2);h.layers[1].events.load();assert.equal(h.layers[0].removed,true);
});

test('tiles that never finish time out and remain retryable',async()=>{
  const h=setup();await h.toggle('clouds',true);await h.resolve(0);
  for(const fn of [...h.timers.values()])fn();
  assert.equal(h.layers[0].removed,true);assert.match(h.element('radarLayerStatus').textContent,/Clouds unavailable/);
});

test('returning from the back-forward cache restores enabled overlays',async()=>{
  const h=setup();await h.toggle('wind',true);await h.resolve(0);h.events.pagehide();
  assert.equal(h.layers[0].removed,true);h.events.pageshow({persisted:true});await h.resolve(1);
  assert.equal(h.layers.length,2);h.layers[1].events.load();
  assert.match(h.element('radarLayerStatus').textContent,/Wind forecast:/);
});
