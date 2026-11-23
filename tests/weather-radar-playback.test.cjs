const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Exercise the browser controller with manually completed tile loads and a
// deterministic clock, so slow/error/out-of-order responses are reproducible.
async function setup(options={}) {
  let now=0,nextTimer=0;
  const timers=new Map(),elements=new Map(),events={},mapEvents={},created=[];
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'0',textContent:'',attributes:{},events:{},
      setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this.events[k]=fn;}});
    return elements.get(id);
  };
  const views=[];
  const map={on(k,fn){mapEvents[k]=fn;},setView(...args){views.push(args);},removeLayer(layer){layer.removed=true;}};
  const document={hidden:false,getElementById:element,addEventListener(k,fn){events[k]=fn;}};
  let failFetch=false;
  const context={document,URL,Intl,Date,AbortController,console,
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);},setInterval(){},addEventListener(k,fn){events[k]=fn;},
    fetch:async()=>{if(failFetch)throw Error('offline');return {ok:true,json:async()=>({host:'https://tilecache.rainviewer.com',radar:{past:[600,1200,1800].map(time=>({time,path:`/v2/radar/${time}`}))}})};},
    L:{map(){return map;},circleMarker(){return {addTo(){return this;},setLatLng(){}};},tileLayer(url,options){
      const layer={url,options,opacity:options.opacity,events:{},removed:false,
        on(k,fn){this.events[k]=fn;return this;},off(){this.events={};},
        addTo(){return this;},redraw(){},setOpacity(v){this.opacity=v;},
        fire(k){this.events[k]?.();}};
      created.push(layer);return layer;
    }}
  };
  const saved=new Map();
  if(options.preference)saved.set('gregle-weather-radar-hd',JSON.stringify(options.preference));
  context.localStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
  const hdCalls=[];
  const stationOverlay={visible:false,selected:'',attach(map,fn){this.choose=fn;},setSites(){},select(id){this.selected=id;},setVisible(value){this.visible=value;}};
  if(options.stationMarkers)context.GregleRadarStations=stationOverlay;
  if(options.hd)context.GregleHighResRadar={
    distance:()=>0,sourceFor:station=>(station==='CASAG' || station==='CASHP')?{id:station,provider:'eccc'}:{endpoint:'https://opengeo.ncep.noaa.gov/geoserver/ows',layer:station || 'conus_bref_qcd'},
    async load(station,signal){
      hdCalls.push({station,signal});
      if(options.hdLoad)return options.hdLoad(station,signal);
      return {host:'',frames:[660,1260,1860].map(time=>({time,path:`hd:${station}:${time}`,hd:{station,time}}))};
    },
    createLayer(frame){return context.L.tileLayer(`https://opengeo.ncep.noaa.gov/hd/${frame.hd.time}`,{opacity:0});}
  };
  let opacity=.6,changeOpacity;
  context.GregleWeatherTransparency={opacity:()=>opacity,attach(map,fn){changeOpacity=fn;}};
  context.GregleWeatherBasemap=require('../assets/weather-basemap.js').create(context);
  context.GregleWeather=require('../assets/weather-core.js');
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/weather-radar.js'),'utf8'),context);
  context.GregleRadar.setLocation({latitude:49.24,longitude:-123.12,name:'Vancouver',timezone:'America/Vancouver'});
  events.DOMContentLoaded();await flush();
  const layers=()=>created.filter(l=>l.url.includes('/v2/radar/')&&!l.removed);
  const layer=time=>layers().find(l=>l.url.includes(`/v2/radar/${time}/`));
  async function load(time){layer(time).fire('load');await flush();}
  async function click(id){element(id).events.click();await flush();}
  async function scrub(index){element('radarTime').value=String(index);element('radarTime').events.input();await flush();}
  async function advance(ms){
    const end=now+ms;
    for(;;){
      const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;
      now=due[1].at;timers.delete(due[0]);due[1].fn();await flush();
    }
    now=end;await flush();
  }
  const visible=()=>layers().filter(l=>l.opacity>0).map(l=>Number(l.url.match(/radar\/(\d+)/)[1]));
  return {element,context,events,mapEvents,layers,layer,load,click,scrub,advance,visible,flush,created,views,saved,hdCalls,stationOverlay,
    async setHighRes(value){element('radarHighResToggle').checked=value;element('radarHighResToggle').events.change();await flush();},
    hdLayer:time=>created.find(l=>l.url.endsWith(`/hd/${time}`)&&!l.removed),setOpacity(value){opacity=value;changeOpacity(value);},failFetch:()=>{failFetch=true;}};
}

test('play retains the complete current image and timestamp until the next load finishes',async()=>{
  const h=await setup();await h.load(1800);
  const timestamp=h.element('radarTimestamp').textContent;
  await h.click('radarPlay');await h.advance(2400);
  assert.deepEqual(h.visible(),[1800]);
  assert.equal(h.element('radarTimestamp').textContent,timestamp);
  assert.equal(h.element('radarTime').value,'2');
  assert.equal(h.layers().length,2,'only the requested frame is loading');
  await h.load(600);
  assert.deepEqual(h.visible(),[600]);
  assert.equal(h.element('radarTime').value,'0');
  assert.notEqual(h.element('radarTimestamp').textContent,timestamp);
  assert.equal(h.layer(1200).opacity,0,'next frame is prefetched invisibly');
});

test('playback advances in order with a full dwell and longer pause before looping',async()=>{
  const h=await setup();await h.load(1800);await h.click('radarPlay');await h.load(600);await h.load(1200);
  await h.advance(599);assert.deepEqual(h.visible(),[600]);
  await h.advance(1);assert.deepEqual(h.visible(),[1200]);
  await h.advance(600);assert.deepEqual(h.visible(),[1800]);
  await h.advance(1599);assert.deepEqual(h.visible(),[1800]);
  await h.advance(1);assert.deepEqual(h.visible(),[600]);
  assert.equal(h.layers().length,3,'the next loop reuses cached images');
});

test('pause cancels a pending switch and does not allow a late load to restart playback',async()=>{
  const h=await setup();await h.load(1800);await h.click('radarPlay');await h.click('radarPlay');
  await h.load(600);await h.advance(5000);
  assert.deepEqual(h.visible(),[1800]);assert.equal(h.element('radarPlay').attributes['aria-pressed'],'false');
  await h.click('radarPlay');assert.deepEqual(h.visible(),[600],'resume can reuse the completed image');
});

test('rapid scrubbing and play/pause/play ignore superseded frame completions',async()=>{
  const h=await setup();await h.load(1800);await h.click('radarPlay');
  await h.scrub(1);await h.load(1200);await h.load(600);
  assert.deepEqual(h.visible(),[1200]);assert.equal(h.element('radarTime').value,'1');
  await h.advance(2000);assert.deepEqual(h.visible(),[1200]);
  await h.click('radarPlay');await h.click('radarPlay');await h.click('radarPlay');
  await h.advance(600);assert.deepEqual(h.visible(),[1200]);
});

for(const failure of ['tileerror','timeout'])test(`${failure} stops playback and keeps the last good image`,async()=>{
  const h=await setup();await h.load(1800);await h.click('radarPlay');
  if(failure==='tileerror'){h.layer(600).fire('tileerror');await h.flush();}
  else await h.advance(15000);
  assert.deepEqual(h.visible(),[1800]);assert.equal(h.element('radarPlay').attributes['aria-pressed'],'false');
  assert.match(h.element('radarStatus').textContent,/could not load/);
  await h.load(600);await h.advance(2000);assert.deepEqual(h.visible(),[1800]);
});

test('a failed prefetch does not interrupt the displayed frame before its dwell ends',async()=>{
  const h=await setup();await h.load(1800);await h.click('radarPlay');await h.load(600);
  h.layer(1200).fire('tileerror');await h.flush();
  assert.equal(h.element('radarPlay').attributes['aria-pressed'],'true');
  await h.advance(600);assert.deepEqual(h.visible(),[600]);
  assert.equal(h.element('radarPlay').attributes['aria-pressed'],'false');
});

test('map movement clears pending loads and late callbacks cannot replace the new map image',async()=>{
  const h=await setup();await h.load(1800);await h.click('radarPlay');
  const late=h.layer(600).events.load;
  h.mapEvents.movestart();h.mapEvents.moveend();await h.flush();
  await h.load(1800);late();await h.advance(16000);
  assert.deepEqual(h.visible(),[1800]);assert.equal(h.layers().length,1);
  assert.equal(h.element('radarPlay').attributes['aria-pressed'],'false');
});

test('refresh and hiding the page cancel pending playback',async()=>{
  const h=await setup();await h.load(1800);await h.click('radarPlay');
  h.context.document.hidden=true;h.events.visibilitychange();await h.load(600);
  assert.deepEqual(h.visible(),[1800]);
  h.context.document.hidden=false;await h.click('radarPlay');await h.click('radarRefresh');await h.load(1800);
  await h.advance(3000);assert.deepEqual(h.visible(),[1800]);assert.equal(h.layers().length,1);
});

test('failed refresh preserves usable images and restores the controls',async()=>{
  const h=await setup();await h.load(1800);h.failFetch();await h.click('radarRefresh');
  assert.deepEqual(h.visible(),[1800]);assert.equal(h.element('radarPlay').disabled,false);
  assert.equal(h.element('radarTime').disabled,false);assert.match(h.element('radarStatus').textContent,/refresh failed/);
});

test('transparency applies immediately, survives frame changes, and keeps prefetch invisible',async()=>{
  const h=await setup();await h.load(1800);
  h.setOpacity(.25);assert.equal(h.layer(1800).opacity,.25);
  await h.click('radarPlay');await h.load(600);
  assert.equal(h.layer(600).opacity,.25);
  assert.equal(h.layer(1200).opacity,0);
  h.setOpacity(0);await h.load(1200);await h.advance(600);
  assert.equal(h.layer(1200).opacity,0);
  assert.equal(h.element('radarTime').value,'1','fully transparent playback still advances');
  h.setOpacity(1);assert.equal(h.layer(1200).opacity,1);
  assert.equal(h.layer(600).opacity,0,'previous frame stays hidden');
});

test('high-resolution switches preserve map position and match a scrubbed observation across feeds',async()=>{
  const h=await setup({hd:true});await h.load(1800);
  const viewCount=h.views.length;
  await h.setHighRes(true);h.hdLayer(1860).fire('load');await h.flush();
  assert.equal(h.element('radarHDLegend').hidden,false);
  assert.equal(h.element('radarStandardLegends').hidden,true);
  assert.match(h.element('radarMode').textContent,/NOAA MRMS/);
  assert.equal(h.views.length,viewCount);
  await h.scrub(0);h.hdLayer(660).fire('load');await h.flush();
  await h.setHighRes(false);await h.load(600);
  assert.deepEqual(h.visible(),[600]);assert.equal(h.element('radarTime').value,'0');
  assert.equal(h.element('radarHDControls').hidden,true);
  assert.equal(h.element('radarStandardLegends').hidden,false);
});

test('late high-resolution metadata cannot replace standard radar after switching off',async()=>{
  let resolveHD;
  const pending=new Promise(resolve=>{resolveHD=resolve;});
  const h=await setup({hd:true,hdLoad:()=>pending});await h.load(1800);
  await h.setHighRes(true);await h.setHighRes(false);await h.load(1800);
  assert.equal(h.hdCalls[0].signal.aborted,true);
  resolveHD({host:'',frames:[{time:1860,path:'hd:late',hd:{time:1860}}]});await h.flush();
  assert.deepEqual(h.visible(),[1800]);assert.equal(h.hdLayer(1860),undefined);
  assert.equal(h.element('radarHDLegend').hidden,true);
});

test('failed source changes retain usable radar and restore the displayed source switch',async()=>{
  const h=await setup({hd:true,hdLoad:async()=>{throw Error('offline');}});await h.load(1800);
  await h.setHighRes(true);
  assert.deepEqual(h.visible(),[1800]);
  assert.equal(h.element('radarHighResToggle').checked,false);
  assert.equal(h.element('radarHDControls').hidden,true);
  assert.match(h.element('radarStatus').textContent,/selected radar source is unavailable/);
  assert.equal(JSON.parse(h.saved.get('gregle-weather-radar-hd')).enabled,false);
  assert.equal(h.element('radarPlay').disabled,false);
});

test('saved high-resolution station is restored on a new visit',async()=>{
  const h=await setup({hd:true,preference:{enabled:true,station:'KATX'}});
  assert.equal(h.hdCalls[0].station,'KATX');
  assert.equal(h.element('radarHighResToggle').checked,true);
  assert.equal(h.element('radarStation').value,'KATX');
  h.hdLayer(1860).fire('load');await h.flush();
  assert.match(h.element('radarMode').textContent,/KATX/);
  await h.setHighRes(false);await h.load(1800);
  assert.deepEqual(JSON.parse(h.saved.get('gregle-weather-radar-hd')),{enabled:false,station:'KATX',stationsVisible:true});
});

test('map station clicks sync the source selector; visibility never reloads the radar',async()=>{
  const h=await setup({hd:true,stationMarkers:true});await h.load(1800);
  assert.equal(h.stationOverlay.visible,false);
  await h.setHighRes(true);h.hdLayer(1860).fire('load');await h.flush();
  assert.equal(h.stationOverlay.visible,true);
  h.stationOverlay.choose('KATX');await h.flush();
  assert.equal(h.element('radarStation').value,'KATX');
  assert.equal(h.stationOverlay.selected,'KATX');assert.equal(h.hdCalls.at(-1).station,'KATX');
  const calls=h.hdCalls.length;
  h.element('radarStationsToggle').checked=false;h.element('radarStationsToggle').events.change();await h.flush();
  assert.equal(h.stationOverlay.visible,false);assert.equal(h.hdCalls.length,calls);
  assert.equal(JSON.parse(h.saved.get('gregle-weather-radar-hd')).stationsVisible,false);
  await h.setHighRes(false);await h.load(1800);await h.setHighRes(true);
  assert.equal(h.stationOverlay.visible,false,'the hidden preference survives switching modes');
});

test('a saved hidden station overlay stays hidden on a new visit',async()=>{
  const h=await setup({hd:true,stationMarkers:true,preference:{enabled:true,station:'KATX',stationsVisible:false}});
  assert.equal(h.element('radarStationsToggle').checked,false);
  assert.equal(h.stationOverlay.visible,false);assert.equal(h.stationOverlay.selected,'KATX');
});

test('Canadian station selection survives reload and shows rainfall-rate metadata',async()=>{
  const h=await setup({hd:true,stationMarkers:true,preference:{enabled:true,station:'CASHP',stationsVisible:true}});
  assert.equal(h.hdCalls[0].station,'CASHP');assert.equal(h.element('radarStation').value,'CASHP');
  assert.match(h.element('radarMode').textContent,/CASHP.*ECCC/);
  assert.equal(h.element('radarCanadaLegend').hidden,false);
  assert.equal(h.element('radarHDLegendImage').hidden,true);
  assert.match(h.element('radarHDLegendTitle').textContent,/mm\/h/);
  h.stationOverlay.choose('KATX');await h.flush();
  assert.equal(h.element('radarCanadaLegend').hidden,true);
  assert.match(h.element('radarHDLegendTitle').textContent,/dBZ/);
});

