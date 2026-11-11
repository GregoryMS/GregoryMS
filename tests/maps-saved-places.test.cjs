const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const core = require('../assets/maps-core.js');
const source = fs.readFileSync(require.resolve('../assets/maps-saved-places.js'), 'utf8');
const key = 'gregle-maps-saved-places-v1';
const home = {lat:48.42,lng:-123.36,name:'Home address',detail:'Victoria'};
const work = {lat:48.45,lng:-123.38,name:'Work address',detail:'Victoria'};
function harness(storage = new Map(), blocked = false) {
  class Element {
    constructor() { this.events={};this.attrs={};this.dataset={};this.children=[];this.value='';this.open=false;this.style={};this.parentElement={addEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})}; }
    addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
    setAttribute(k,v) { this.attrs[k]=v; } removeAttribute(k) { delete this.attrs[k]; }
    replaceChildren(...children) { this.children=children; } append(...children) { this.children.push(...children); }
    getBoundingClientRect() { return {left:10,top:10,bottom:56}; }
    focus() {} showModal() { this.open=true; } close() { this.open=false;this.click('close'); }
    click(name='click') { for (const fn of this.events[name] || []) fn({preventDefault(){}}); }
  }
  const els=new Map(), el=id=>{ if(!els.has(id))els.set(id,new Element());return els.get(id); };
  el('map-saved-places').hidden=true;
  const routes=[], notices=[];
  const context={window:{GregleMaps:core,addEventListener(){}}, document:{getElementById:el,querySelector:()=>el('search'),createElement:()=>new Element(),addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(blocked)throw Error('Storage blocked');storage.set(k,v);}},
    navigator:{},AbortController,URL,setTimeout,clearTimeout,Date};
  vm.runInNewContext(source,context);
  context.window.GregleSavedPlaces({map:{},config:{},navigation:{navigateSaved:p=>routes.push(p)},getSelected:()=>work,notify:message=>notices.push(message)});
  return {el,routes,notices,storage};
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
