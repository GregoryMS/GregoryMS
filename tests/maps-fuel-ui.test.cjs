const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const core = require('../assets/maps-fuel-core.js');
const source = fs.readFileSync(__dirname + '/../assets/maps-fuel.js', 'utf8');
const receipt = Date.now(), box = [-123.4,48.4,-123.3,48.5];
const packet = {area: box, fetchedAt: receipt, elements: [{type:'node',id:1,lat:48.43,lon:-123.36,tags:{amenity:'fuel',name:'Shell'}}]};
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
function setup({storage = new Map(), fail = false, pending = false} = {}) {
  let now = receipt, timerId = 0, stationFail = fail, release;
  const timers = new Map(), calls = [], handlers = {}, windows = {}, elements = new Map(), groups = [];
  class Element {
    constructor() { this.textContent='';this.hidden=false;this.disabled=false;this.events={};this.children=[]; }
    append(...children) { this.children.push(...children); }
    addEventListener(name, fn) { this.events[name]=fn; }
  }
  const get = id => { if(!elements.has(id))elements.set(id,new Element());return elements.get(id); };
  const document = {hidden:false,getElementById:get,createElement:()=>new Element(),addEventListener:(name,fn)=>handlers[name]=fn};
  const L = {layerGroup:()=>{const group={items:[],clearLayers(){this.items=[];},addTo(){return this;}};groups.push(group);return group;},divIcon:options=>options,marker:(location,options)=>({location,options,bindPopup(){return this;},addTo(group){group.items.push(this);return this;}})};
  let view = [...box], zoom = 12;
  const events = {}, map={on:(name,fn)=>events[name]=fn,getBounds:()=>({getWest:()=>view[0],getSouth:()=>view[1],getEast:()=>view[2],getNorth:()=>view[3]}),getCenter:()=>({lat:48.43,lng:-123.36}),getZoom:()=>zoom,removeLayer(){},setView(center,next){zoom=next;events.moveend?.();},attributionControl:{addAttribution(){},removeAttribution(){}}};
  const window={GregleFuelCore:core,addEventListener:(name,fn)=>windows[name]=fn};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));}static now(){return now;} }
  const fetch=async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).includes('fuel-prices'))return {ok:true,json:async()=>({source:'Kalibrate Canada',unit:'CAD cents/litre',date:core.today(),markets:[{name:'Victoria',province:'BC',lat:48.4284,lng:-123.3656,prices:{regular:198.9}}]})};
    if(pending)return new Promise(resolve=>release=resolve);
    if(stationFail)return {ok:false,status:503,headers:{get:()=> '60'}};
    return {ok:true,json:async()=>packet};
  };
  vm.runInNewContext(source,{window,document,L,fetch,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},URL,AbortController,Date:Clock,setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)});
  const api=window.GregleFuel({map,config:{fuelPricesURL:'https://relay.test/fuel-prices',fuelStationsURL:'https://relay.test/fuel-stations'}});
  return {api,get,calls,storage,document,events,markers:()=>groups[1].items,fail:value=>stationFail=value,release:()=>release({ok:true,json:async()=>packet}),move:next=>{events.movestart();view=next;events.moveend();},hide:()=>{document.hidden=true;handlers.visibilitychange();},advance:async ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await flush();}};
}
test('pins stay visible during a pan and a saved containing area avoids another request, including after reload', async()=>{
  const h=setup();h.api.setSelection(true);await flush();assert.equal(h.markers().length,1);assert.match(h.get('fuel-card-stations').textContent,/1 mapped petrol/);
  h.events.movestart();assert.equal(h.markers().length,1,'Starting a pan must not blank the station layer');
  h.move([-123.39,48.41,-123.31,48.49]);await h.advance(700);assert.equal(h.markers().length,1);assert.equal(h.calls.filter(x=>x.url.includes('fuel-stations')).length,1);
  const restored=setup({storage:h.storage});restored.api.setSelection(true);await flush();assert.equal(restored.markers().length,1);assert.equal(restored.calls.filter(x=>x.url.includes('fuel-stations')).length,0);
  h.api.setSelection(false);restored.api.setSelection(false);
});
test('a provider failure is visible on the card and retries after Retry-After without another user action',async()=>{
  const h=setup({fail:true});h.api.setSelection(true);await flush();assert.match(h.get('fuel-card-stations').textContent,/unavailable.*Retrying/);assert(!h.get('fuel-pin-action').hidden);assert(h.get('fuel-pin-action').disabled);
  h.fail(false);await h.advance(59999);assert.equal(h.markers().length,0);await h.advance(1);assert.equal(h.markers().length,1);assert(h.get('fuel-pin-action').hidden);h.api.setSelection(false);
});
test('turning off or hiding the layer cancels retries and late results cannot restore pins',async()=>{
  const failed=setup({fail:true});failed.api.setSelection(true);await flush();const count=failed.calls.length;failed.api.setSelection(false);await failed.advance(60001);assert.equal(failed.calls.length,count);
  const h=setup({pending:true});h.api.setSelection(true);await flush();h.api.setSelection(false);h.release();await flush();assert.equal(h.markers().length,0);assert(h.get('map-fuel-card').hidden);
  const hidden=setup({fail:true});hidden.api.setSelection(true);await flush();const before=hidden.calls.length;hidden.hide();await hidden.advance(60001);assert.equal(hidden.calls.length,before);hidden.api.setSelection(false);
});
