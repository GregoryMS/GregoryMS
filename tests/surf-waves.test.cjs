const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {embedURL}=require('../assets/surf-waves.js');
const tofino={name:'Tofino',latitude:49.15,longitude:-125.91};
test('waves use the marine model, metres and validated selected coordinates',()=>{
  const url=new URL(embedURL(tofino));
  assert.equal(url.searchParams.get('overlay'),'waves');
  assert.equal(url.searchParams.get('product'),'ecmwfWaves');
  assert.equal(url.searchParams.get('metricWaves'),'m');
  assert.equal(url.searchParams.get('lon'),'-125.91');
  for(const location of [null,{latitude:91,longitude:0},{latitude:0,longitude:Infinity}])assert.throws(()=>embedURL(location));
});
test('waves lazy load the latest location, recover from slow loads and discard stale callbacks',()=>{
  const elements=new Map(),frames=[],events={},timers=new Map();let observe,next=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{events:{},addEventListener(k,fn){this.events[k]=fn;},replaceChildren(frame){this.child=frame;}});
    return elements.get(id);
  };
  const context={URLSearchParams,document:{getElementById:element,createElement(){const f={events:{},addEventListener(k,fn){this.events[k]=fn;},remove(){this.removed=true;}};frames.push(f);return f;}},
    IntersectionObserver:class {constructor(fn){observe=fn;}observe(){}disconnect(){}},
    setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);},addEventListener(k,fn){events[k]=fn;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/surf-waves.js'),'utf8'),context);
  const api=context.GregleSurfWaves;
  api.setLocation({name:'Vancouver',latitude:49.24,longitude:-123.12});api.setLocation(tofino);
  assert.equal(frames.length,0);
  observe([{isIntersecting:true}]);assert.equal(frames.length,1);assert.match(frames[0].title,/Tofino/);
  const late=frames[0].events.load;
  api.setLocation({name:'Victoria',latitude:48.43,longitude:-123.36});
  assert.equal(frames[0].removed,true);late();assert.equal(element('surfWavesStatus').hidden,false);
  for(const fn of timers.values())fn();assert.match(element('surfWavesStatus').textContent,/Try Refresh/);
  element('surfWavesRefresh').events.click();assert.equal(frames[1].removed,true);
  frames[2].events.load();assert.equal(element('surfWavesStatus').hidden,true);
  element('surfWavesRecenter').events.click();assert.equal(frames[3].src,frames[2].src);
  assert.equal(element('surfWavesLink').href,frames[3].src);
  events.pagehide();assert.equal(frames[3].removed,true);assert.equal(timers.size,0);
  events.pageshow({persisted:true});assert.equal(frames.length,5);
});
