const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/maps-core.js');

test('Street View URLs validate coordinates and provide a documented Google Maps fallback', () => {
  const point = {lat:48.4241,lng:-123.3687};
  const full = new URL(core.streetViewURL(point)), embed = new URL(core.streetViewEmbedURL(point));
  assert.equal(full.origin, 'https://www.google.com');
  assert.equal(full.searchParams.get('api'), '1');
  assert.equal(full.searchParams.get('map_action'), 'pano');
  assert.equal(full.searchParams.get('viewpoint'), '48.424100,-123.368700');
  assert.equal(embed.searchParams.get('cbll'), full.searchParams.get('viewpoint'));
  assert.equal(embed.searchParams.get('output'), 'svembed');
  assert.equal(new URL(core.streetViewURL({lat:0,lng:541})).searchParams.get('viewpoint'), '0.000000,-179.000000');
  for (const invalid of [null, {}, {lat:91,lng:0}, {lat:NaN,lng:0}, {lat:0,lng:Infinity}, {lat:'0',lng:0}]) {
    assert.throws(() => core.streetViewURL(invalid));
    assert.throws(() => core.streetViewEmbedURL(invalid));
  }
});

test('Street View is opt-in and shared links retain the selected target and other layers', () => {
  assert.equal(core.normalizeLayers(null).streetview, false);
  assert.equal(core.normalizeLayers({streetview:'true'}).streetview, false);
  const state = core.normalizeLayers({streetview:true,google:true,base:'topographic'});
  const pin = {lat:48.42,lng:-123.37,name:'Street View point',detail:''};
  const hash = core.makeHash(core.defaultView, pin, state);
  assert.deepEqual(core.readLayers(hash), state);
  assert.deepEqual(core.readHash(hash).pin, pin);
});

function setup(selected = null) {
  const nodes = new Map(), events = {}, mapEvents = {}, created = [], timers = new Map(), calls = [], selections = [];
  let next = 0;
  class Element {
    constructor() { this.hidden = true; this.children = []; this.events = {}; const classes = new Set(); this.classList = {toggle:(key,on)=>on?classes.add(key):classes.delete(key),contains:key=>classes.has(key)}; }
    addEventListener(type,fn) { this.events[type] = fn; }
    append(child) { this.children.push(child); child.parent = this; }
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this),1); this.parent = null; }
    focus() { calls.push('focus'); }
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id,new Element()); return nodes.get(id); };
  const document = {getElementById:get,querySelector:()=>get('stage'),createElement:()=>{const frame = new Element(); created.push(frame); return frame;}};
  const window = {GregleMaps:core,addEventListener:(type,fn)=>events[type]=fn};
  const map = {getCenter:()=>({lat:48.4241,lng:-123.3687}),closePopup(){},invalidateSize:options=>calls.push(options),removeLayer:layer=>calls.push(layer),on:(type,fn)=>mapEvents[type]=fn};
  const L = {circleMarker:()=>({addTo(){return this;}})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-streetview.js'),'utf8'), {window,document,L,setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
  let api;
  api = window.GregleStreetView({map,getSelected:()=>selected,onClose:()=>api.setEnabled(false),onSelect:point=>selections.push(point)});
  return {api,get,events,mapEvents,created,timers,calls,selections};
}

test('panoramas load only when enabled and map clicks select a shareable point', () => {
  const h = setup(); assert.equal(h.created.length, 0);
  h.api.setEnabled(true);
  assert.equal(h.created.length, 1); assert(!h.get('streetview-panel').hidden);
  assert.equal(h.calls[0].pan, true);
  assert.equal(h.created[0].title, 'Google Street View panorama');
  assert.equal(h.created[0].referrerPolicy, 'strict-origin-when-cross-origin');
  h.mapEvents.click({latlng:{lat:48.425,lng:-123.37},originalEvent:{target:{closest:()=>null}}});
  assert.equal(h.get('streetview-frame').children.length, 1);
  assert.equal(h.selections.length, 1); assert.equal(h.selections[0].lat, 48.425);
  const count = h.created.length;
  h.mapEvents.click({latlng:{lat:48,lng:-123},originalEvent:{target:{closest:()=>true}}});
  assert.equal(h.created.length, count); assert.equal(h.selections.length, 1);
  assert.equal(h.mapEvents.moveend, undefined, 'panning must not reset a panorama being explored');
});

test('selection, reload, disable and back-forward restoration clear obsolete frames and timers', () => {
  const point = {lat:0,lng:0}, h = setup(point);
  h.api.setEnabled(true);
  assert.equal(new URL(h.created[0].src).searchParams.get('cbll'), '0.000000,0.000000');
  h.api.setEnabled(true); assert.equal(h.created.length, 1);
  const old = h.created[0];
  h.get('streetview-retry').events.click(); assert.equal(h.created.length, 2);
  old.events.error(); assert.equal(h.get('streetview-status').textContent, 'Loading Street View…');
  assert.equal(h.timers.size, 1);
  h.created[1].events.load(); assert(h.get('streetview-status').hidden); assert.equal(h.timers.size, 0);
  h.events.pagehide(); assert.equal(h.get('streetview-frame').children.length, 0);
  h.events.pageshow({persisted:true}); assert.equal(h.get('streetview-frame').children.length, 1);
  h.get('streetview-close').events.click();
  assert(h.get('streetview-panel').hidden); assert(!h.get('stage').classList.contains('streetview-active'));
  assert.equal(h.get('streetview-frame').children.length, 0); assert.equal(h.timers.size, 0);
  h.mapEvents.click({latlng:{lat:48,lng:-123}}); assert.equal(h.selections.length, 0);
});

test('slow and failed frames leave a visible fallback and ignore invalid selections', () => {
  const h = setup(); h.api.setEnabled(true);
  h.api.showAt({lat:NaN,lng:0}); assert.equal(h.created.length, 1);
  [...h.timers.values()][0].fn(); assert.match(h.get('streetview-status').textContent, /taking longer/);
  assert.match(h.get('streetview-google').href, /map_action=pano/);
  h.created[0].events.error(); assert.match(h.get('streetview-status').textContent, /could not load/);
  h.get('streetview-center').events.click(); assert.equal(h.selections.length, 1);
});
