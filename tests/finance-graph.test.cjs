const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');

function graphApp() {
  const nodes={},scripts=[],frames=[],timers=new Map(),events={},messages=[];
  let config=null,injected=null,reloaded=0;
  for(const id of ['graphApplet','graphLoading','graphStatus','graphRetry']) nodes[id]={hidden:id==='graphRetry',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
  const element={clientWidth:720,clientHeight:490};
  const document={documentElement:element,getElementById:id=>nodes[id],createElement:()=>({}),head:{append:script=>scripts.push(script)}};
  const window={location:{origin:'https://finance.gregle.uk',reload(){reloaded++;}},parent:{postMessage:(data,origin)=>messages.push({data,origin})},
    requestAnimationFrame:fn=>frames.push(fn),addEventListener:(type,fn)=>events[type]=fn,
    GGBApplet:class { constructor(params){config=params;} inject(id){injected=id;} }};
  const context=vm.createContext({document,window,setTimeout:fn=>{const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),ResizeObserver:class{constructor(callback){this.callback=callback;}observe(){this.callback();}}});
  vm.runInContext(fs.readFileSync(path.join(root,'assets/finance-graph.js'),'utf8'),context);
  return {nodes,element,scripts,timers,events,messages,window,config:()=>config,injected:()=>injected,reloaded:()=>reloaded,flush:()=>{while(frames.length) frames.shift()();},frameCount:()=>frames.length};
}

test('graphing loads the official graphing app with equation entry and keeps it inside the floating panel',()=>{
  const p=graphApp(); assert.equal(p.scripts.length,1);
  assert.equal(p.scripts[0].src,'https://www.geogebra.org/apps/deployggb.js');
  p.scripts[0].onload(); const config=p.config();
  assert.equal(config.appName,'graphing'); assert.equal(config.showAlgebraInput,true);
  assert.equal(config.showMenuBar,false); assert.equal(config.showFullscreenButton,false); assert.equal(config.preventFocus,true);
  assert.equal(p.injected(),'graphApplet');
  const sizes=[]; config.appletOnLoad({setSize:(w,h)=>sizes.push([w,h])}); p.flush();
  assert.equal(p.nodes.graphLoading.hidden,true); assert.equal(p.timers.size,0); assert.deepEqual(sizes,[[720,490]]);
  p.element.clientWidth=900; p.element.clientHeight=600;
  p.events.resize(); p.events.resize(); assert.equal(p.frameCount(),1); p.flush(); assert.deepEqual(sizes.at(-1),[900,600]);
  p.events.resize(); p.flush(); assert.equal(sizes.length,2);
  p.element.clientWidth=0; p.element.clientHeight=0; p.events.resize(); p.flush(); assert.equal(sizes.length,2);
  p.element.clientWidth=296; p.element.clientHeight=320; p.events.resize(); p.flush(); assert.deepEqual(sizes.at(-1),[296,320]);
});

test('provider failures and stalled starts show a useful retry and ignore late initialization',()=>{
  for(const failure of ['network','timeout','initialization']) {
    const p=graphApp();
    if(failure==='network') p.scripts[0].onerror();
    else if(failure==='timeout') [...p.timers.values()][0]();
    else { p.window.GGBApplet=undefined; p.scripts[0].onload(); }
    assert.equal(p.nodes.graphApplet.hidden,true); assert.equal(p.nodes.graphRetry.hidden,false); assert.match(p.nodes.graphStatus.textContent,/connection/);
    p.scripts[0].onload(); assert.equal(p.config(),null); assert.equal(p.nodes.graphLoading.hidden,false);
    p.nodes.graphRetry.listeners.click(); assert.equal(p.reloaded(),1);
  }
});

test('Escape inside the embedded calculator reaches its own panel without affecting ordinary typing',()=>{
  const p=graphApp(); let prevented=false;
  p.events.keydown({key:'x',preventDefault(){prevented=true;}}); assert.equal(p.messages.length,0);
  p.events.keydown({key:'Escape',ctrlKey:true,preventDefault(){prevented=true;}}); assert.equal(p.messages.length,0);
  p.events.keydown({key:'Escape',preventDefault(){prevented=true;}});
  assert.equal(prevented,true); assert.equal(p.messages.length,1); assert.equal(p.messages[0].origin,'https://finance.gregle.uk'); assert.equal(p.messages[0].data.type,'gregle-calculator-close');
});
