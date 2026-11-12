const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const core = require('../assets/maps-core.js');
const source = fs.readFileSync(require.resolve('../assets/maps-saved-places.js'), 'utf8');
const key = 'gregle-maps-saved-places-v1';
const home = {lat:48.42,lng:-123.36,name:'Home address',detail:'Victoria'};
const work = {lat:48.45,lng:-123.38,name:'Work address',detail:'Victoria'};
function harness(storage = new Map(), blocked = false, navigationAvailable = true) {
  class Element {
    constructor() { this.events={};this.attrs={};this.dataset={};this.children=[];this.value='';this.open=false;this.style={};this.parentElement={addEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})}; }
    addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
    setAttribute(k,v) { this.attrs[k]=v; } removeAttribute(k) { delete this.attrs[k]; }
    replaceChildren(...children) { this.children=children; } append(...children) { this.children.push(...children); }
    getBoundingClientRect() { return {left:10,right:150,top:10,bottom:56}; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    closest() { return ['map-home','map-work','map-saved-edit'].includes(this.id) ? this : null; }
    focus() {} showModal() { this.open=true; } close() { this.open=false;this.click('close'); }
    click(name='click', event={}) { const e={target:this,button:0,pointerId:1,clientX:20,clientY:20,detail:0,preventDefault(){},...event}; for (const fn of this.events[name] || []) fn(e); if(this.parentElement instanceof Element)this.parentElement.click(name,e); }
  }
  const els=new Map(), el=id=>{ if(!els.has(id)){const node=new Element();node.id=id;els.set(id,node);}return els.get(id); };
  for(const id of ['map-query','map-saved-places']){el('search').append(el(id));el(id).parentElement=el('search');}
  for(const id of ['map-home','map-work','map-saved-edit']){el('map-saved-places').append(el(id));el(id).parentElement=el('map-saved-places');}
  el('map-saved-places').hidden=true;
  const routes=[], routeOptions=[], notices=[];
  const context={window:{GregleMaps:core,addEventListener(){}}, document:{getElementById:el,querySelector:()=>el('search'),createElement:()=>new Element(),addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(blocked)throw Error('Storage blocked');storage.set(k,v);}},
    navigator:{},AbortController,URL,setTimeout,clearTimeout,Date};
  vm.runInNewContext(source,context);
  context.window.GregleSavedPlaces({map:{},config:{},navigation:navigationAvailable?{navigateSaved:(p,options)=>{routes.push(p);routeOptions.push(options);}}:null,getSelected:()=>work,notify:message=>notices.push(message)});
  return {el,routes,routeOptions,notices,storage};
}
test('saved locations load after reopening and pin edits preserve the other shortcut',()=>{
  const storage=new Map([[key,JSON.stringify({home})]]), h=harness(storage);
  assert.match(h.el('map-home').attrs['aria-label'],/Navigate to Home/);
  h.el('map-home').click();assert.equal(h.routes[0].lat,home.lat);
  h.el('map-work').click();assert(h.el('saved-place-dialog').open);
  h.el('saved-place-pin').click();h.el('saved-place-save').click();
  assert.deepEqual(JSON.parse(storage.get(key)),{home,work});
  const reopened=harness(storage);reopened.el('map-work').click();assert.equal(reopened.routes[0].lng,work.lng);
  reopened.el('map-saved-edit').click();reopened.el('saved-place-remove').click();
  assert.deepEqual(JSON.parse(storage.get(key)),{home:null,work});
});
test('invalid stored coordinates and unavailable browser storage do not claim success',()=>{
  const h=harness(new Map([[key,JSON.stringify({home:{lat:999,lng:0}})]]),true);
  h.el('map-home').click();assert.equal(h.routes.length,0);assert(h.el('saved-place-dialog').open);
  h.el('saved-place-pin').click();h.el('saved-place-save').click();
  assert.match(h.el('saved-place-status').textContent,/could not save/);assert(h.el('saved-place-dialog').open);assert.equal(h.notices.length,0);
});

test('mobile shortcut presses keep the search focused until their click activates',()=>{
  const h=harness(); let prevented=false;
  h.el('map-saved-places').hidden=false;
  h.el('map-work').click('pointerdown',{preventDefault(){prevented=true;}});
  h.el('search').click('focusout',{relatedTarget:null});
  assert.equal(prevented,true);
  assert.equal(h.el('map-saved-places').hidden,false);
  h.el('map-work').click('pointerup');
  assert.equal(h.el('map-saved-places').hidden,true);
  assert.equal(h.el('saved-place-dialog').open,true);
  assert.equal(h.el('saved-place-work').attrs['aria-pressed'],'true');
  assert.equal(h.routes.length,0);
});

test('unset Home and Work each open their own editor even if navigation is unavailable',()=>{
  const h=harness(new Map(),false,false);
  for(const kind of ['home','work']){
    assert.equal(h.el('map-'+kind).disabled,false);
    h.el('map-'+kind).click();
    assert.equal(h.el('saved-place-dialog').open,true);
    assert.equal(h.el('saved-place-'+kind).attrs['aria-pressed'],'true');
    assert.equal(h.el('saved-place-current').textContent,kind==='home'?'Home is not set.':'Work is not set.');
    h.el('saved-place-close').click();
  }
});

test('a pointer tap navigates once and keyboard activation still works',()=>{
  const h=harness(new Map([[key,JSON.stringify({home})]]));
  h.el('map-home').click('pointerdown');h.el('map-home').click('pointerup');
  h.el('map-home').click('click',{detail:1});
  assert.equal(h.routes.length,1);
  h.el('map-home').click('click',{detail:0});
  assert.equal(h.routes.length,2);
  h.el('map-work').click('pointerdown');h.el('map-work').click('pointercancel');
  assert.equal(h.el('saved-place-dialog').open,false);
});

test('car Home requests 3D navigation while the search Home keeps its existing behavior',()=>{
  const storage=new Map([[key,JSON.stringify({home,work})]]),h=harness(storage);
  assert.equal(h.el('map-car-home').disabled,false);
  assert.equal(h.el('map-car-home').attrs['aria-label'],'Navigate home in 3D');
  h.el('map-car-home').click();
  assert.equal(h.routes[0].name,'Home');assert.equal(h.routes[0].lat,home.lat);
  assert.equal(h.routeOptions[0].threeD,true);
  h.el('map-home').click();assert.equal(h.routeOptions[1],undefined);
  storage.set(key,JSON.stringify({home:work}));h.el('map-car-home').click();
  assert.equal(h.routes[2].lat,work.lat,'the toolbar uses the latest saved Home');
});

test('car Home opens Home setup when no destination is saved',()=>{
  const h=harness();
  h.el('map-car-home').click();
  assert.equal(h.routes.length,0);assert(h.el('saved-place-dialog').open);
  assert.equal(h.el('saved-place-home').attrs['aria-pressed'],'true');
  assert.equal(h.el('map-car-home').attrs['aria-label'],'Set home location');
});
