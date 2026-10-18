const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const endpoint='https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png';
const demoKey='test-only-aviation-key-000000';
const flush=async()=>{for(let i=0;i<18;i++)await Promise.resolve();};
function setup(saved=demoKey,url=endpoint){
 let now=100000,nextTimer=0,fetchImpl=async()=>({ok:true,blob:async()=>new Blob(['test'],{type:'image/png'})}),forgotten=0;
 const elements=new Map(),timers=new Map(),events={},calls=[],layers=[],notices=[],urls=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,dataset:{},events:{},textContent:'',addEventListener(k,f){this.events[k]=f;},focus(){},scrollIntoView(){}});return elements.get(id);};
 class Clock extends Date{static now(){return now;}}
 class URLs extends URL{static createObjectURL(){const u='blob:test-'+urls.length;urls.push(u);return u;}static revokeObjectURL(){}}
 const document={hidden:false,getElementById:element,addEventListener(k,f){events[k]=f;},createElement(){return {setAttribute(){},set src(v){this.value=v;Promise.resolve().then(()=>this.onload?.());}};}};
 const map={getZoom:()=>13,on(){},removeLayer(layer){layer.removed=true;for(const tile of layer.tiles)layer.events.tileunload?.({tile});}};
 const context={document,Date:Clock,URL:URLs,AbortController,Set,Number,Math,
  localStorage:{getItem:()=>saved,setItem(k,v){assert.equal(k,'gregle-maps-openaip-key');saved=v;},removeItem(){saved=null;}},
  addEventListener(k,f){events[k]=f;},setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},
  fetch(url,options){calls.push({url,options,time:now});return fetchImpl(url,options);},
  L:{TileLayer:{extend(methods){return class{
   constructor(url,options){this._url=url;this.options=options;this.events={};this.tiles=[];layers.push(this);}
   on(k,f){this.events[k]=f;return this;}
   addTo(){this.events.loading?.();for(let x=0;x<2;x++)this.tiles.push(methods.createTile.call(this,{z:13,x,y:100},()=>{this.loaded=(this.loaded||0)+1;if(this.loaded===2)this.events.load?.();}));return this;}
   getTileUrl(c){return this._url.replace('{z}',c.z).replace('{x}',c.x).replace('{y}',2**c.z-1-c.y);}
  };}}}
 };
 context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-aviation.js'),'utf8'),context);
 const api=context.GregleAviation({map,config:{aviationURL:url},notify:m=>notices.push(m),onForget:()=>forgotten++});
 async function advance(ms){const end=now+ms;for(let i=0;i<100;i++){const item=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!item){now=end;await flush();return;}now=item[1].due;timers.delete(item[0]);item[1].fn();await flush();}throw Error('Timer loop');}
 return {api,element,calls,layers,notices,events,document,urls,advance,saved:()=>saved,forgotten:()=>forgotten,setFetch:fn=>fetchImpl=fn};
}

test('aviation stays idle without opt-in/key and sends credentials only in official-origin headers',async()=>{
 const noKey=setup(null);noKey.api.setEnabled(true);await noKey.advance(1000);assert.equal(noKey.calls.length,0);assert.match(noKey.element('aviation-layer-status').textContent,/API key/);
 const h=setup();await h.advance(1000);assert.equal(h.calls.length,0);h.api.setEnabled(true);await h.advance(1000);
 assert.equal(h.calls.length,2);assert(h.calls[1].time-h.calls[0].time>=200);
 for(const call of h.calls){assert.equal(call.options.headers['x-openaip-api-key'],demoKey);assert.equal(call.options.credentials,'omit');assert(!call.url.includes(demoKey));}
 assert.equal(h.layers[0].options.tms,true);assert.match(h.element('aviation-layer-status').textContent,/where available/);
 h.api.setEnabled(false);assert(h.layers[0].removed);const count=h.calls.length;await h.advance(5000);assert.equal(h.calls.length,count);
 const unsafe=setup(demoKey,'https://other.example/api/data/openaip/{z}/{x}/{y}.png');unsafe.api.setEnabled(true);await unsafe.advance(1000);assert.equal(unsafe.calls.length,0);assert.match(unsafe.element('aviation-layer-status').textContent,/official/);
});

test('rate limits stop queued requests and toggles cannot bypass Retry-After',async()=>{
 const h=setup();h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '90'}}));h.api.setEnabled(true);await h.advance(1000);
 assert.equal(h.calls.length,1);assert(h.layers[0].removed);assert.match(h.element('aviation-layer-status').textContent,/rate limit/);
 h.api.setEnabled(false);h.api.setEnabled(true);h.element('aviation-retry').events.click();await h.advance(60000);assert.equal(h.calls.length,1);
 h.setFetch(async()=>({ok:true,blob:async()=>new Blob(['test'],{type:'image/png'})}));await h.advance(30000);h.element('aviation-retry').events.click();await h.advance(1000);assert.equal(h.calls.length,3);
});

test('hiding or forgetting cancels pending work and late responses cannot restore charts',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);await h.advance(0);assert.equal(h.calls.length,1);
 h.document.hidden=true;h.events.visibilitychange();assert(h.calls[0].options.signal.aborted);release({ok:true,blob:async()=>new Blob(['test'],{type:'image/png'})});await flush();assert.equal(h.urls.length,0);
 h.document.hidden=false;h.setFetch(async()=>({ok:true,blob:async()=>new Blob(['test'],{type:'image/png'})}));h.events.visibilitychange();await h.advance(1000);assert.equal(h.calls.length,3);
 h.element('aviation-forget').events.click();assert.equal(h.saved(),null);assert.equal(h.forgotten(),1);assert(h.layers.at(-1).removed);await h.advance(5000);assert.equal(h.calls.length,3);
});

test('timed-out tiles pause the overlay and clear queued work without automatic retries',async()=>{
 const h=setup();h.setFetch((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))));
 h.api.setEnabled(true);await h.advance(13000);assert.match(h.element('aviation-layer-status').textContent,/could not load/);assert(h.layers[0].removed);
 const count=h.calls.length;await h.advance(600000);assert.equal(h.calls.length,count);
});
