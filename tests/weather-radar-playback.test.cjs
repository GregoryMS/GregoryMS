const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Exercise the browser controller with manually completed tile loads and a
// deterministic clock, so slow/error/out-of-order responses are reproducible.
async function setup() {
  let now=0,nextTimer=0;
  const timers=new Map(),elements=new Map(),events={},mapEvents={},created=[];
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'0',textContent:'',attributes:{},events:{},
      setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this.events[k]=fn;}});
    return elements.get(id);
  };
  const map={on(k,fn){mapEvents[k]=fn;},setView(){},removeLayer(layer){layer.removed=true;}};
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
  return {element,context,events,mapEvents,layers,layer,load,click,scrub,advance,visible,flush,failFetch:()=>{failFetch=true;}};
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
