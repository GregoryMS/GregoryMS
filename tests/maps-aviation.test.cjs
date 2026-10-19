const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const endpoint='https://gregle-aviation.square-rain-5ded.workers.dev/tiles/{z}/{x}/{y}.png';
const demoKey='test-only-aviation-key-000000';
const flush=async()=>{for(let i=0;i<18;i++)await Promise.resolve();};
function setup(saved=demoKey,url=endpoint,storedOpacity=null){
 let now=100000,nextTimer=0,fetchImpl=async()=>({ok:true,blob:async()=>new Blob(['test'],{type:'image/png'})}),forgotten=0;
 const elements=new Map(),timers=new Map(),events={},calls=[],layers=[],notices=[],urls=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,dataset:{},events:{},textContent:'',addEventListener(k,f){this.events[k]=f;},focus(){},scrollIntoView(){}});return elements.get(id);};
 class Clock extends Date{static now(){return now;}}
 class URLs extends URL{static createObjectURL(){const u='blob:test-'+urls.length;urls.push(u);return u;}static revokeObjectURL(){}}
 const document={hidden:false,getElementById:element,addEventListener(k,f){events[k]=f;},createElement(){return {setAttribute(){},set src(v){this.value=v;Promise.resolve().then(()=>this.onload?.());}};}};
 let center={lat:48.4187,lng:-122.7821},zoom=9;
 const mapEvents={};
 const map={getCenter:()=>center,getZoom:()=>zoom,on(k,f){mapEvents[k]=f;},removeLayer(layer){layer.removed=true;for(const tile of layer.tiles)layer.events.tileunload?.({tile});}};
 const context={document,Date:Clock,URL:URLs,AbortController,Set,Number,Math,
  localStorage:{getItem:k=>k==='gregle-maps-openaip-key'?saved:storedOpacity,setItem(k,v){if(k==='gregle-maps-openaip-key')saved=v;else storedOpacity=v;},removeItem(){saved=null;}},
  addEventListener(k,f){events[k]=f;},setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},
  fetch(url,options){calls.push({url,options,time:now});return fetchImpl(url,options);},
  L:{TileLayer:{extend(methods){return class{
   constructor(url,options){this._url=url;this.options=options;this.events={};this.tiles=[];layers.push(this);}
   on(k,f){this.events[k]=f;return this;}
   addTo(){this.events.loading?.();for(let x=0;x<2;x++)this.tiles.push(methods.createTile.call(this,{z:13,x,y:100},()=>{this.loaded=(this.loaded||0)+1;if(this.loaded===2)this.events.load?.();}));return this;}
   getTileUrl(c){return this._url.replace('{z}',c.z).replace('{x}',c.x).replace('{y}',this.options.tms?2**c.z-1-c.y:c.y);}
   setOpacity(value){this.options.opacity=value;}
  };}}}
 };
 context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-aviation.js'),'utf8'),context);
 const api=context.GregleAviation({map,config:{aviationURL:url},notify:m=>notices.push(m),onForget:()=>forgotten++});
 async function advance(ms){const end=now+ms;for(let i=0;i<100;i++){const item=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!item){now=end;await flush();return;}now=item[1].due;timers.delete(item[0]);item[1].fn();await flush();}throw Error('Timer loop');}
 return {api,element,calls,layers,notices,events,document,urls,advance,saved:()=>saved,opacity:()=>storedOpacity,forgotten:()=>forgotten,setFetch:fn=>fetchImpl=fn,move(next,z){center=next;zoom=z;mapEvents.moveend();}};
}

test('aviation is opt-in and uses the Worker without browser credentials',async()=>{
 const noKey=setup(null);noKey.api.setEnabled(true);await noKey.advance(1000);assert.equal(noKey.calls.length,2);
 const h=setup();await h.advance(1000);assert.equal(h.calls.length,0);h.api.setEnabled(true);await h.advance(1000);
 assert.equal(h.calls.length,2);assert(h.calls[1].time-h.calls[0].time>=200);
 for(const call of h.calls){assert.equal(call.options.headers,undefined);assert.equal(call.options.credentials,'omit');assert(!call.url.includes(demoKey));}
 assert.equal(h.layers[0].options.tms,false);assert.equal(h.layers[0].options.minZoom,2);assert.match(h.element('aviation-layer-status').textContent,/where available/);
 assert.equal(h.layers[0].getTileUrl({z:9,x:81,y:177}),'https://gregle-aviation.square-rain-5ded.workers.dev/tiles/9/81/177.png');
 h.api.setEnabled(false);assert(h.layers[0].removed);const count=h.calls.length;await h.advance(5000);assert.equal(h.calls.length,count);
 const unsafe=setup(demoKey,'https://other.example/api/data/openaip/{z}/{x}/{y}.png');unsafe.api.setEnabled(true);await unsafe.advance(1000);assert.equal(unsafe.calls.length,0);assert.match(unsafe.element('aviation-layer-status').textContent,/Gregle aviation service/);
});

test('rate limits stop queued requests and toggles cannot bypass Retry-After',async()=>{
 const h=setup();h.setFetch(async()=>({ok:false,status:429,headers:{get:()=> '90'}}));h.api.setEnabled(true);await h.advance(1000);
 assert.equal(h.calls.length,1);assert(h.layers[0].removed);assert.match(h.element('aviation-layer-status').textContent,/rate limit/);
 h.api.setEnabled(false);h.api.setEnabled(true);h.element('aviation-retry').events.click();await h.advance(60000);assert.equal(h.calls.length,1);
 h.setFetch(async()=>({ok:true,blob:async()=>new Blob(['test'],{type:'image/png'})}));await h.advance(30000);h.element('aviation-retry').events.click();await h.advance(1000);assert.equal(h.calls.length,3);
});

test('hiding or disabling cancels pending work and late responses cannot restore charts',async()=>{
 const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);await h.advance(0);assert.equal(h.calls.length,1);
 h.document.hidden=true;h.events.visibilitychange();assert(h.calls[0].options.signal.aborted);release({ok:true,blob:async()=>new Blob(['test'],{type:'image/png'})});await flush();assert.equal(h.urls.length,0);
 h.document.hidden=false;h.setFetch(async()=>({ok:true,blob:async()=>new Blob(['test'],{type:'image/png'})}));h.events.visibilitychange();await h.advance(1000);assert.equal(h.calls.length,3);
 h.api.setEnabled(false);assert.equal(h.saved(),null);assert(h.layers.at(-1).removed);await h.advance(5000);assert.equal(h.calls.length,3);
});

test('timed-out tiles pause the overlay and clear queued work without automatic retries',async()=>{
 const h=setup();h.setFetch((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))));
 h.api.setEnabled(true);await h.advance(13000);assert.match(h.element('aviation-layer-status').textContent,/could not load/);assert(h.layers[0].removed);
 const count=h.calls.length;await h.advance(600000);assert.equal(h.calls.length,count);
});

test('empty 204 chart tiles complete without pausing or attempting to decode a body',async()=>{
 const h=setup();h.setFetch(async()=>({ok:true,status:204,blob(){throw Error('204 has no image body');}}));
 h.api.setEnabled(true);await h.advance(1000);
 assert.equal(h.calls.length,2);assert.equal(h.layers[0].loaded,2);assert(!h.layers[0].removed);
 assert(h.layers[0].tiles.every(tile=>tile.value.startsWith('data:image/gif;base64,')));
 assert.equal(h.notices.length,0);assert.match(h.element('aviation-layer-status').textContent,/where available/);
});

test('chart opacity changes existing tiles without fetching again and restores only bounded preferences',async()=>{
 const h=setup();h.api.setEnabled(true);await h.advance(1000);
 assert.equal(h.layers[0].options.opacity,0.85);
 h.element('aviation-opacity').value='0.4';h.element('aviation-opacity').events.input();
 assert.equal(h.layers[0].options.opacity,0.4);assert.equal(h.element('aviation-percentage').textContent,'40%');
 assert.equal(h.opacity(),'0.4');await h.advance(5000);assert.equal(h.calls.length,2);
 h.api.setEnabled(false);h.api.setEnabled(true);assert.equal(h.layers.at(-1).options.opacity,0.4);
 assert.equal(setup(demoKey,endpoint,'0.65').element('aviation-opacity').value,'0.65');
 for(const value of ['NaN','-1','100',''])assert.equal(setup(demoKey,endpoint,value).element('aviation-opacity').value,'0.85');
});

test('the full OpenAIP map follows centre and zoom, wraps longitude and contains no API key',async()=>{
 const h=setup();assert.equal(h.element('aviation-full-map').href,'https://www.openaip.net/map#9.00/48.41870/-122.78210');
 h.move({lat:51.5,lng:540.1},12);
 assert.equal(h.element('aviation-full-map').href,'https://www.openaip.net/map#12.00/51.50000/-179.90000');
 assert(!h.element('aviation-full-map').href.includes(demoKey));await h.advance(1000);assert.equal(h.calls.length,0);
});
