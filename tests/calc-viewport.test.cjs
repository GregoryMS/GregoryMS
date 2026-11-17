const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/calc-viewport.js'),'utf8');
function setup() {
  const classes = new Set(['calculator-standalone']), styles = new Map(), events = {}, windowEvents = {}, viewportEvents = {}, frames = new Map();
  let tick=0,nextFrame=0,observer,native=true,height=874;
  const root = {classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)},style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)}};
  const page={matches:()=>native},body={getBoundingClientRect:()=>({height})};
  const document={documentElement:root,body,readyState:'complete',getElementById:()=>page,addEventListener:(k,fn)=>events[k]=fn};
  const window={innerWidth:402,innerHeight:874,visualViewport:{scale:1,height:874,offsetTop:0,addEventListener:(k,fn)=>viewportEvents[k]=fn},matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener:(k,fn)=>windowEvents[k]=fn};
  vm.runInNewContext(source,{document,window,MutationObserver:class {constructor(fn){observer=fn;}observe(){}},getComputedStyle:()=>({paddingTop:'59px',paddingRight:'0px',paddingBottom:'34px',paddingLeft:'0px'}),requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id)});
  function settle(){for(let i=0;i<12;i++){tick+=16;const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(tick));}}
  function move({scrollHeight=0,clientHeight=0,scrollTop=0,delta=-10,pinch=false,zoom=1}={}) {
    window.visualViewport.scale=zoom;let prevented=false;
    const scroller=scrollHeight?{scrollHeight,clientHeight,scrollTop}:null;
    events.touchstart({touches:[{clientY:100}]});
    events.touchmove({touches:pinch?[{},{}]:[{clientY:100+delta}],target:{closest:()=>scroller},cancelable:true,preventDefault(){prevented=true;}});
    return prevented;
  }
  return {classes,styles,window,windowEvents,viewportEvents,settle,move,setHeight:value=>height=value,setNative(value){native=value;observer();}};
}
test('Home Screen calculator appears after stable layout and ignores height-only launch changes',()=>{
  const app=setup();assert(!app.classes.has('scientific-viewport-ready'));app.settle();
  assert(app.classes.has('scientific-viewport-ready'));assert.equal(app.styles.get('--scientific-app-height'),'874px');
  assert.equal(app.styles.get('--scientific-safe-bottom'),'34px');
  app.setHeight(900);app.windowEvents.resize();app.settle();assert.equal(app.styles.get('--scientific-app-height'),'874px');
  app.window.innerWidth=874;app.setHeight(402);app.windowEvents.resize();app.settle();assert.equal(app.styles.get('--scientific-app-height'),'402px');
});
test('root bounce is blocked while history scrolling and pinch zoom remain available',()=>{
  const app=setup();app.settle();assert(app.move());
  assert.equal(app.move({scrollHeight:500,clientHeight:100,scrollTop:50}),false);
  assert(app.move({scrollHeight:500,clientHeight:100,scrollTop:0,delta:10}));
  assert(app.move({scrollHeight:500,clientHeight:100,scrollTop:400,delta:-10}));
  assert.equal(app.move({pinch:true}),false);assert.equal(app.move({zoom:2}),false);
});
test('switching to a TI calculator releases the native viewport and touch lock',()=>{
  const app=setup();app.settle();app.setNative(false);
  assert.equal(app.styles.has('--scientific-app-height'),false);assert.equal(app.move(),false);
  app.setNative(true);app.settle();assert.equal(app.styles.get('--scientific-app-height'),'874px');
});
test('the viewport and installed-app mode are established before stylesheet loading',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../calc.html'),'utf8');
  assert(html.indexOf('name="viewport"')<html.indexOf('assets/preferences.js'));
  assert(html.indexOf("classList.toggle('calculator-standalone'")<html.indexOf('<link rel="stylesheet"'));
});


test('visible viewport caps the body height and later reductions preserve every bottom-row key',()=>{
  const app=setup();app.setHeight(940);app.window.visualViewport.height=810;app.settle();
  assert.equal(app.styles.get('--scientific-app-height'),'810px');
  app.window.visualViewport.height=780;app.viewportEvents.resize();
  assert.equal(app.styles.get('--scientific-app-height'),'780px');
  app.window.visualViewport.height=850;app.viewportEvents.resize();
  assert.equal(app.styles.get('--scientific-app-height'),'780px');
  app.window.visualViewport.scale=2;app.window.visualViewport.height=390;app.viewportEvents.resize();
  assert.equal(app.styles.get('--scientific-app-height'),'780px');
});
