const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(viewport) {
  const nodes = new Map(), mapEvents = {}, observers = [];
  class Node {
    constructor(id = '') { this.id=id; this.children=[]; this.parentNode=null; this.hidden=true; this.inert=false; this.textContent=''; this.attrs={}; this.events={}; this.scrollTop=0; this.clientHeight=760; const classes=new Set(); this.classList={contains:v=>classes.has(v),add:v=>classes.add(v),remove:v=>classes.delete(v),toggle(v,on){if(on)classes.add(v);else classes.delete(v);}}; this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}}; }
    addEventListener(name,fn) { this.events[name]=fn; }
    setAttribute(k,v) { this.attrs[k]=String(v); }
    remove() { if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1); this.parentNode=null; }
    append(...nodes) { for(const node of nodes){node.remove();this.children.push(node);node.parentNode=this;} }
    before(node) { const parent=this.parentNode;node.remove();parent.children.splice(parent.children.indexOf(this),0,node);node.parentNode=parent; }
    after(node) { const parent=this.parentNode;node.remove();parent.children.splice(parent.children.indexOf(this)+1,0,node);node.parentNode=parent; }
    replaceWith(node) { this.before(node);this.remove(); }
    setPointerCapture() {}
    focus() { document.activeElement=this; }
    click() { this.events.click?.({}); }
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);};
  const stage=get('stage'); stage.getBoundingClientRect=()=>({bottom:830});
  const document={activeElement:null,body:get('document-body'),getElementById:get,querySelector:()=>stage,createElement:()=>new Node(),createComment:()=>new Node()};
  const ids=['map-place','map-search-content','map-directions','map-layers-panel','map-fuel-card','vessels-legend','map-feature-details','map-link-copy'];
  for(const id of ids)stage.append(get(id));
  const media={matches:true,addEventListener(name,fn){this.changed=fn;}};
  const map={on(name,fn){mapEvents[name]=fn;},closePopup(){mapEvents.popupclose?.({popup:popup});}};
  let popup;
  const context={window:{matchMedia:()=>media,visualViewport:viewport},document,MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},ResizeObserver:class{observe(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-drawer.js'),'utf8'),context);
  const api=context.window.GregleMapDrawer({map});
  const refresh=()=>observers.at(-1)();
  const open=id=>{get(id).hidden=false;refresh();};
  const fire=(name,extra={})=>{const e={isPrimary:true,button:0,pointerId:1,clientY:400,preventDefault(){},...extra};get('map-drawer-resize').events[name](e);};
  return {get,stage,api,open,refresh,fire,media,mapEvents,desktop(){media.matches=false;media.changed();},mobile(){media.matches=true;media.changed();},popup(p){popup=p;mapEvents.popupopen({popup:p});}};
}

test('dragging resizes continuously, clamps at both ends, and leaves intermediate heights intact',()=>{
  const h=setup();h.open('map-place');const handle=h.get('map-drawer-resize');
  const before=Number(handle.attrs['aria-valuenow']);
  h.fire('pointerdown');h.fire('pointermove',{clientY:317});h.fire('pointerup',{clientY:317,type:'pointerup'});
  assert.equal(Number(handle.attrs['aria-valuenow']),before+83);
  h.refresh();assert.equal(Number(handle.attrs['aria-valuenow']),before+83);
  h.fire('keydown',{key:'End'});assert.equal(handle.attrs['aria-valuenow'],'660');
  h.fire('pointerdown');h.fire('pointermove',{clientY:-1000});h.fire('pointercancel');assert.equal(handle.attrs['aria-valuenow'],'660');
  h.fire('keydown',{key:'Home'});assert.equal(handle.attrs['aria-valuenow'],'64');assert(h.get('map-drawer-body').inert);
  h.get('map-drawer-collapse').click();assert(!h.get('map-drawer-body').inert);
});

test('panel tabs expose only the selected panel without losing DOM nodes or resetting a chosen height',()=>{
  const h=setup(), place=h.get('map-place');h.open('map-place');h.fire('keydown',{key:'ArrowUp'});
  const height=h.get('map-drawer-resize').attrs['aria-valuenow'];
  h.open('map-layers-panel');assert(place.inert);assert(!h.get('map-layers-panel').inert);
  h.open('map-fuel-card');assert(!h.get('map-layers-panel').inert,'a background fuel update must not steal the selected panel');
  h.api.show('map-place');assert(!place.inert);assert(h.get('map-layers-panel').inert);
  assert.equal(h.get('map-drawer-resize').attrs['aria-valuenow'],height);
  assert.equal(place.parentNode,h.get('map-drawer-body'));
  h.desktop();assert.equal(place.parentNode,h.stage);assert(!place.inert);assert(h.get('map-drawer').hidden);
  h.mobile();assert.equal(place.parentNode,h.get('map-drawer-body'));assert.equal(h.get('map-drawer-resize').attrs['aria-valuenow'],height);
});

test('mobile marker details retain their live DOM and return to the popup on desktop',()=>{
  const h=setup(), content=h.get('popup-content'), wrapper=h.get('popup-wrapper');wrapper.append(content);
  const popup={options:{autoPan:true},getElement:()=>({querySelector:()=>content})};
  const layer={getPopup:()=>popup};h.mapEvents.layeradd({layer});assert.equal(popup.options.autoPan,false);
  h.popup(popup);assert.equal(content.parentNode,h.get('map-feature-details'));assert(!h.get('map-feature-details').hidden);
  h.desktop();assert.equal(content.parentNode,wrapper);assert(h.get('map-feature-details').hidden);assert.equal(popup.options.autoPan,true);
  h.mobile();assert.equal(content.parentNode,h.get('map-feature-details'),'an open desktop popup must migrate when the screen narrows');
  h.mapEvents.layerremove({layer});assert.equal(popup.options.autoPan,true,'removing a mobile layer restores its original option');
});

test('the drawer stays above an on-screen keyboard and clamps to the remaining height',()=>{
  const events={},viewport={height:844,offsetTop:0,addEventListener:(name,fn)=>events[name]=fn};
  const h=setup(viewport);h.open('map-directions');h.fire('keydown',{key:'End'});
  viewport.height=520;events.resize();
  assert.equal(h.get('map-drawer-resize').attrs['aria-valuenow'],'350');
  assert.equal(h.get('map-drawer').style['--map-drawer-lift'],'310px');
  viewport.height=844;events.resize();
  assert.equal(h.get('map-drawer').style['--map-drawer-lift'],'0px');
  assert.equal(h.get('map-drawer-resize').attrs['aria-valuenow'],'350','keyboard dismissal must not unexpectedly expand the panel');
});

test('embedded maps hide native details while keeping the layers drawer available for switching back',()=>{
  const h=setup();h.open('map-place');h.open('map-fuel-card');
  h.stage.classList.add('embedded-active');h.refresh();assert(h.get('map-drawer').hidden);
  h.open('map-layers-panel');assert(!h.get('map-drawer').hidden);assert(!h.get('map-layers-panel').inert);assert(h.get('map-place').inert);
  h.stage.classList.remove('embedded-active');h.refresh();h.api.show('map-place');assert(!h.get('map-place').inert);
});
