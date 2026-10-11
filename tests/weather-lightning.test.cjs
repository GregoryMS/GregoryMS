const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../assets/weather-lightning.js');
test('lightning history matches only the preceding available observation',()=>{
  const times=core.timesFrom('2026-10-10T00:00:00Z/2026-10-10T03:00:00Z/PT10M');
  assert.equal(times.length,19);
  assert.equal(core.matchTime(times,Date.parse('2026-10-10T01:05:00Z')/1000),Date.parse('2026-10-10T01:00:00Z'));
  assert.equal(core.matchTime(times,Date.parse('2026-10-10T03:30:00Z')/1000),null);
  assert.equal(core.matchTime(times,Date.parse('2026-10-09T23:59:00Z')/1000),null);
  for(const invalid of ['', 'bad/bad/PT10M','2026-10-11/2026-10-10/PT10M','2026-10-10/2026-10-15/PT10M'])assert.throws(()=>core.timesFrom(invalid));
});
async function setup({stale=false}={}) {
  const end=Math.floor(Date.now()/600000)*600000-(stale?3600000:0),elements=new Map(),events={},layers=[],timers=new Map();let timer=0,fail=false;
  const element=id=>{if(!elements.has(id))elements.set(id,{checked:true,hidden:false,textContent:'',events:{},addEventListener(k,f){this.events[k]=f;}});return elements.get(id);};
  const dimension=new Date(end-7200000).toISOString()+'/'+new Date(end).toISOString()+'/PT10M';
  const context={URL,Intl,Date,AbortController,document:{hidden:false,getElementById:element,addEventListener(k,f){events[k]=f;}},
    DOMParser:class {parseFromString(){return {getElementsByTagName:()=>[{getAttribute:()=> 'time',textContent:dimension}]};}},
    setTimeout(f){timers.set(++timer,f);return timer;},clearTimeout(id){timers.delete(id);},setInterval(){},addEventListener(){},
    fetch:async()=>{if(fail)throw Error('offline');return {ok:true,text:async()=>''};},
    L:{tileLayer:{wms(url,options){const layer={url,options,events:{},opacity:0,on(k,f){this.events[k]=f;return this;},off(){this.events={};},setOpacity(v){this.opacity=v;},addTo(){this.events.loading?.();return this;}};layers.push(layer);return layer;}}}
  };
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/weather-lightning.js'),'utf8'),context);
  events.DOMContentLoaded();
  context.GregleLightning.setLocation({timezone:'America/Vancouver'});
  context.GregleLightning.attach({removeLayer(l){l.removed=true;}});
  context.GregleLightning.setFrame({time:end/1000});await flush();
  return {context,element,layers,events,timers,flush,end,fail:()=>{fail=true;},api:context.GregleLightning};
}
test('overlay loads at an explicit matching time and ignores superseded tile completions',async()=>{
  const h=await setup(),first=h.layers.at(-1),late=first.events.load;
  assert.equal(first.options.time,new Date(h.end).toISOString().replace('.000Z','Z'));assert.equal(first.opacity,0);
  h.api.setFrame({time:h.end/1000-600});const second=h.layers.at(-1);
  late();assert.equal(second.opacity,0);assert(first.removed);
  second.events.load();assert.equal(second.opacity,.9);assert.match(h.element('lightningStatus').textContent,/10 minutes ending/);
  second.events.tileerror();assert(second.removed);assert.match(h.element('lightningStatus').textContent,/could not load/);
});
test('toggle and forecast tabs remove lightning, and re-enabling restores it',async()=>{
  const h=await setup();h.element('lightningToggle').checked=false;h.element('lightningToggle').events.change();
  assert(h.layers.at(-1).removed);assert.match(h.element('lightningStatus').textContent,/off/);
  h.element('lightningToggle').checked=true;h.element('lightningToggle').events.change();
  assert(!h.layers.at(-1).removed);h.api.setActive(false);assert(h.layers.at(-1).removed);
  h.api.setActive(true);assert(!h.layers.at(-1).removed);
  h.context.document.hidden=true;h.events.visibilitychange();assert(h.layers.at(-1).removed);
});
test('stale metadata and failed refresh do not leave apparently current lightning on the map',async()=>{
  const stale=await setup({stale:true});assert.equal(stale.layers.length,0);assert.match(stale.element('lightningStatus').textContent,/unavailable/);
  const h=await setup();h.layers.at(-1).events.load();h.fail();h.api.refresh();await h.flush();
  assert(h.layers.at(-1).removed);assert.match(h.element('lightningStatus').textContent,/unavailable/);
});
