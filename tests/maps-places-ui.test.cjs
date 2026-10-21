const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const data = require('../assets/maps-places-core.js');
const point = {lat:48.42888,lng:-123.36789,name:'Dropped pin'};
const full = (id=1,name='Shop',tags={}) => ({elements:[{type:'node',id,lat:point.lat,lon:point.lng,tags:{shop:'convenience',name,...tags}}]});
const quick = (id=1,name='Shop') => ({osm_type:'node',osm_id:id,lat:String(point.lat),lon:String(point.lng),category:'shop',type:'convenience',name,extratags:{phone:'+1 250 555 0123'}});
const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
function setup({storage=new Map(),now=1792617000000,ignoreAbort=false,endpoint='https://overpass.test/api'}={}) {
  const start=now, timers=new Map(), calls=[], shown=[], nodes=new Map(), events={}; let nextTimer=0;
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.className='';this.attrs={};this.events={};this.hidden=false;this.scrollTop=0;this.ownText='';this.open=false;const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x)};}
    set textContent(value){this.ownText=String(value);this.children=[];}
    get textContent(){return this.ownText+this.children.map(e=>e.textContent).join(' ');}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;this.ownText='';}
    setAttribute(k,v){this.attrs[k]=String(v);}
    removeAttribute(k){delete this.attrs[k];}
    addEventListener(k,fn){this.events[k]=fn;}
    querySelector(selector){for(const e of this.children){if(selector.startsWith('.')?e.className.split(' ').includes(selector.slice(1)):e.tagName===selector)return e;const match=e.querySelector(selector);if(match)return match;}return null;}
    click(){this.events.click?.({});}
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const setTimer=(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const document={hidden:false,getElementById:get,createElement:tag=>new Element(tag),addEventListener:(k,fn)=>events[k]=fn};
  const fetch=(url,options)=>new Promise((resolve,reject)=>{
    const call={url:String(url),options,resolve,reject,at:now-start};calls.push(call);
    if(!ignoreAbort){if(options.signal.aborted)reject(new Error('aborted'));else options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}
  });
  const context={window:{GreglePlaceData:data,addEventListener:(k,fn)=>events[k]=fn},document,fetch,URLSearchParams,AbortController,
    AbortSignal:{any:signals=>AbortSignal.any(signals),timeout:ms=>{const c=new AbortController();setTimer(()=>c.abort(),ms);return c.signal;}},
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},Date:Clock,setTimeout:setTimer,clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-places.js'),'utf8'),context);
  let zoom=16;
  const api=context.window.GregleMapPlaces({map:{getZoom:()=>zoom},config:{placesURL:endpoint,placeLookupURL:'https://lookup.test/'},onPlace:p=>shown.push(p)});
  async function advance(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();await flush();}now=end;await flush();}
  async function respond(index,payload,status=200,retry=null){calls[index].resolve({ok:status>=200&&status<300,status,headers:{get:()=>retry},json:async()=>payload});await flush();}
  return {api,get,calls,shown,storage,document,events,advance,respond,now:()=>now,setZoom:n=>zoom=n,choose:()=>api.select(point,{nearby:true})};
}

test('slow Overpass does not block quick shop details, and repeat/reloaded lookups use the session cache',async()=>{
  const h=setup(),run=h.choose();await flush();assert.equal(h.calls.length,1);
  await h.advance(799);assert.equal(h.calls.length,1);
  await h.advance(1);assert.equal(h.calls.length,2);assert.equal(h.calls[1].at,800);
  await h.respond(1,quick());assert.equal(h.shown.at(-1).name,'Shop');assert.equal(h.shown.at(-1).partial,true);
  assert.equal(h.get('place-tags').attrs['aria-busy'],undefined);assert(!h.calls[0].options.signal.aborted);
  await h.advance(5700);await run;
  await h.choose();assert.equal(h.calls.length,2);
  const reload=setup({storage:h.storage,now:h.now()});await reload.choose();assert.equal(reload.calls.length,0);assert.equal(reload.shown[0].name,'Shop');
});

test('a healthy full response avoids the fallback entirely',async()=>{
  const h=setup(),run=h.choose();await h.advance(200);await h.respond(0,full());await run;
  await h.advance(1000);assert.equal(h.calls.length,1);assert.equal(h.shown.length,1);assert(!h.shown[0].partial);
});

test('late full tags enrich the same shop and preserve expanded details and scroll position',async()=>{
  const h=setup(),run=h.choose();await h.advance(800);await h.respond(1,quick());
  h.get('place-tags').querySelector('.place-all-tags').open=true;h.get('map-place').scrollTop=75;
  const payload=full(2,'Another shop');payload.elements.push(full(1,'Shop',{phone:'+1 250 555 9999',opening_hours:'24/7'}).elements[0]);
  await h.respond(0,payload);await run;
  assert.equal(h.shown.at(-1).osm,'node/1');assert.equal(h.shown.at(-1).tags.phone,'+1 250 555 9999');assert(!h.shown.at(-1).partial);
  assert(h.get('place-tags').querySelector('.place-all-tags').open);assert.equal(h.get('map-place').scrollTop,75);
});

test('a full response which lacks the quick match cannot silently change the shop being read',async()=>{
  const h=setup(),run=h.choose();await h.advance(800);await h.respond(1,quick());await h.respond(0,full(2,'Different shop'));await run;
  assert.equal(h.shown.at(-1).osm,'node/1');assert.match(h.get('place-tags').textContent,/Different shop/);
});

test('new pins abort old lookups and late responses cannot replace the new selection',async()=>{
  const h=setup({ignoreAbort:true}),old=h.choose();await h.advance(800);
  const newer=h.api.select({...point,osm:'node/2'},{nearby:true});await flush();
  assert(h.calls[0].options.signal.aborted);assert(h.calls[1].options.signal.aborted);
  await h.advance(1100);assert.equal(h.calls.length,3);await h.respond(2,full(2,'New shop'));await newer;
  await h.respond(0,full(1,'Old shop'));await h.respond(1,quick(1,'Old shop'));await old;
  assert.equal(h.shown.at(-1).name,'New shop');assert(!h.shown.some(p=>p.name==='Old shop'));
});

test('provider failure cooldown survives reloads and does not delay the next uncached fallback',async()=>{
  const h=setup(),run=h.choose();await h.respond(0,{},503);assert.equal(h.calls.length,2);await h.respond(1,quick());await run;
  const reload=setup({storage:h.storage,now:h.now()+1200});const second=reload.api.select({...point,osm:'node/2'});await flush();
  assert.equal(reload.calls.length,1);assert.match(reload.calls[0].url,/lookup\.test/);assert.equal(reload.calls[0].at,0);
  await reload.respond(0,quick(2,'Next shop'));await second;assert.equal(reload.shown[0].name,'Next shop');
});

test('fallback failure still allows full data, while Retry-After is respected when both services fail',async()=>{
  const h=setup(),run=h.choose();await h.advance(800);await h.respond(1,{},503);assert.equal(h.shown.length,0);
  await h.respond(0,full());await run;assert.equal(h.shown[0].name,'Shop');
  const failed=setup(),attempt=failed.choose();await failed.respond(0,{},503);await failed.respond(1,{},429,'60');await attempt;
  assert.match(failed.get('place-tags').textContent,/unavailable/);await failed.advance(30000);await failed.choose();assert.equal(failed.calls.length,2);
  assert.match(failed.get('place-tags').textContent,/30 seconds/);
});

test('expired, invalid or differently configured cache records cannot bypass network validation',async()=>{
  const h=setup(),run=h.choose();await h.respond(0,full());await run;
  for(const settings of [{now:h.now()+600001},{endpoint:'https://other-overpass.test/api'}]){
    const reload=setup({storage:h.storage,...settings});const next=reload.choose();await flush();assert.equal(reload.calls.length,1);await reload.respond(0,full());await next;
  }
  const raw=JSON.parse(h.storage.get('gregle-maps-place-cache-v1'));for(const [,e] of raw.entries)e.places[0].lat=91;h.storage.set('gregle-maps-place-cache-v1',JSON.stringify(raw));
  const bad=setup({storage:h.storage}),next=bad.choose();await flush();assert.equal(bad.calls.length,1);assert.equal(bad.shown.length,0);await bad.respond(0,full());await next;
});

test('clearing or hiding a lookup cancels requests without an error or a provider penalty',async()=>{
  const h=setup(),run=h.choose();await h.advance(800);h.document.hidden=true;h.events.visibilitychange();await run;
  assert(h.calls.every(c=>c.options.signal.aborted));assert(!h.get('place-tags').textContent.includes('unavailable'));
  assert(!h.storage.has('gregle-maps-place-health-v1'));
  const empty=setup();await empty.api.select(null);empty.setZoom(10);await empty.choose();assert.equal(empty.calls.length,0);
});

test('a full result aborts an in-flight fallback without treating that cancellation as failure',async()=>{
  const h=setup(),run=h.choose();await h.advance(800);await h.respond(0,full());await run;
  assert(h.calls[1].options.signal.aborted);assert.equal(h.shown.at(-1).name,'Shop');
  assert(!h.get('place-tags').textContent.includes('unavailable'));assert(!h.storage.has('gregle-maps-place-health-v1'));
});

test('oversized place records cannot exceed the session cache budget or break the displayed result',async()=>{
  const h=setup(),run=h.choose();const tags=Object.fromEntries(Array.from({length:210},(_,i)=>['tag'+i,'x'.repeat(1000)]));
  await h.respond(0,full(1,'Large shop',tags));await run;
  assert.equal(h.shown[0].name,'Large shop');assert(h.storage.get('gregle-maps-place-cache-v1').length<=200000);
});
