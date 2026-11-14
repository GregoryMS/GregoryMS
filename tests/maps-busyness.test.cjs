const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/maps-busyness-core.js');
const source = fs.readFileSync(require.resolve('../assets/maps-busyness.js'), 'utf8');
const shop = {osm: 'node/1', name: 'A & B Coffee', lat: 48.428, lng: -123.365, tags: {'addr:housenumber': '12', 'addr:street': 'Main St', 'addr:city': 'Victoria'}};
const flush = async () => {for (let i = 0; i < 30; i++) await Promise.resolve();};

function setup({now = Date.parse('2026-11-02T20:00:00Z'), storage = new Map(), configured = true, available = true, bootstrapped = true} = {}) {
  const nodes = new Map(), timers = new Map(), calls = [], imports = [], created = [];
  let timerID = 0;
  class Element {
    constructor(tag) {this.tagName = tag; this.children = []; this.attrs = {}; this.events = {}; this.hidden = false; this.disabled = false; this.textContent = ''; if (tag === 'template') this.content = new Element('fragment');}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children = children;}
    setAttribute(k, v) {this.attrs[k] = String(v);}
    removeAttribute(k) {delete this.attrs[k];}
    hasAttribute(k) {return Object.hasOwn(this.attrs, k);}
    addEventListener(name, fn, options) {(this.events[name] ||= []).push({fn, once: options?.once});}
    emit(name, fields = {}) {for (const e of [...(this.events[name] || [])]) {if (e.once) this.events[name].splice(this.events[name].indexOf(e), 1); e.fn(fields);}}
    click() {if (!this.disabled && !this.hidden) this.emit('click');}
    remove() {this.removed = true;}
  }
  const get = id => {if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id);};
  class Clock extends Date {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return now;}}
  const clockCore = {...core, pauseUntil: value => core.pauseUntil(value, now), nextReset: () => core.nextReset(now)};
  const google = {maps: {importLibrary: async name => {imports.push(name); return {};}}};
  const window = {GregleBusynessCore: clockCore, google: bootstrapped ? google : undefined, customElements: {get: () => available}};
  const document = {getElementById: get, createElement: tag => {const el = new Element(tag); created.push(el); return el;}, head: new Element('head')};
  const context = {window, document, URL, Date: Clock, AbortSignal, sessionStorage: {getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v)},
    setTimeout: (fn, ms) => {const id = ++timerID; timers.set(id, {fn, at: now + ms}); return id;}, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {calls.push({url, options}); return {ok: configured, json: async () => ({enabled: configured, browserKey: 'test-browser-key-for-unit-tests'})};}};
  vm.runInNewContext(source, context);
  const api = window.GregleMapBusyness();
  async function advance(ms) {now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.fn();} await flush();}
  const widget = () => get('busyness-content').children[0];
  return {api, get, calls, imports, created, storage, window, document, google, advance, widget, setConfigured: value => {configured = value;}, now: () => now};
}

test('business identity, search text and fallback URLs preserve names without interpreting markup', () => {
  assert.equal(core.identity(shop), 'node/1');
  for (const point of [null, {...shop, osm: null}, {...shop, name: ''}, {...shop, lat: 91}, {...shop, lng: Infinity}]) assert.equal(core.identity(point), null);
  assert.equal(core.query(shop), 'A & B Coffee, 12 Main St, Victoria');
  const url = new URL(core.googleURL({...shop, name: '<b>Coffee & Tea</b>'}));
  const apple=new URL(core.appleURL(shop));
  assert.equal(apple.origin,'https://maps.apple.com');
  assert.equal(apple.searchParams.get('coordinate'),'48.42800,-123.36500');
  assert.equal(apple.searchParams.get('name'),'A & B Coffee, 12 Main St, Victoria');
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.searchParams.get('query'), '<b>Coffee & Tea</b>, 12 Main St, Victoria near 48.42800,-123.36500');
});

test('only one nearby, located Google business can bypass the picker', () => {
  const nearby = {id: 'nearby', location: {lat: () => shop.lat + 0.0002, lng: () => shop.lng}};
  assert.equal(core.singleMatch(shop, [nearby]), nearby);
  const literal = {id: 'literal', location: {lat: shop.lat, lng: shop.lng}};
  assert.equal(core.singleMatch(shop, [literal]), literal);
  for (const candidates of [[], [nearby, literal], [{id: 'missing-location'}], [{id: 'distant-branch', location: {lat: shop.lat + 0.01, lng: shop.lng}}], [{id: 'bad-location', location: {lat: NaN, lng: shop.lng}}], [{id: 'invalid-latitude', location: {lat: 91, lng: 0}}], [{location: literal.location}], [{id: 'unavailable', location: {lat() {throw Error('unavailable');}}}]]) {
    assert.equal(core.singleMatch(shop, candidates), null);
  }
  assert.equal(core.singleMatch(null, [nearby]), null);
});

test('one click opens a unique nearby match; the user can still choose a different match without auto-opening it again', async () => {
  const h = setup(); h.api.select(shop); h.get('busyness-show').click(); await flush();
  const search = h.widget(), match = {id: 'nearby', location: {lat: () => shop.lat, lng: () => shop.lng}};
  search.places = [match]; search.emit('gmp-load');
  const details = h.widget(); assert.equal(details.tagName, 'gmp-place-details'); assert.equal(details.children[0].place, 'nearby');
  search.emit('gmp-select', {place: {id: 'late-click'}}); assert.equal(h.widget(), details);
  details.emit('gmp-load'); h.get('busyness-back').click(); await flush();
  const picker = h.widget(); picker.places = [match]; picker.emit('gmp-load');
  assert.equal(h.widget(), picker); assert.equal(picker.tagName, 'gmp-place-search');
  assert.match(h.get('busyness-status').textContent, /Choose the matching/);
  picker.emit('gmp-select', {place: match}); assert.equal(h.widget().tagName, 'gmp-place-details');
  assert.equal(h.calls.length, 1); assert.deepEqual(h.imports, ['places']);
});

test('quota reset follows Pacific midnight on normal, spring and autumn daylight-saving days', () => {
  for (const [start, end] of [
    ['2026-11-02T20:00:00Z', '2026-11-03T08:00:00Z'],
    ['2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z'],
    ['2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z'],
    ['2026-11-03T07:59:59.999Z', '2026-11-03T08:00:00Z'],
  ]) assert.equal(core.nextReset(Date.parse(start)), Date.parse(end));
  const now = Date.now();
  for (const value of ['bad json', '{}', JSON.stringify({until: now - 1}), JSON.stringify({until: now + 28 * 3600000}), JSON.stringify({until: 'tomorrow'})]) assert.equal(core.pauseUntil(value, now), 0);
  assert.equal(core.pauseUntil(JSON.stringify({until: now + 1000}), now), now + 1000);
});

test('selecting OSM places is free of Google requests until explicitly opened; the user confirms the match', async () => {
  const h = setup(); h.api.select(shop);
  assert.equal(h.calls.length, 0); assert.equal(h.imports.length, 0); assert.equal(h.get('place-busyness').hidden, false);
  h.get('busyness-show').click(); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, '/api/maps/google-config');
  assert.equal(h.calls[0].options.cache, 'no-store'); assert.deepEqual(h.imports, ['places']);
  const search = h.widget(); assert.equal(search.tagName, 'gmp-place-search');
  assert.equal(search.children[0].attrs['text-query'], core.query(shop));
  assert.equal(search.children[0].attrs['location-bias'], '1000@48.428,-123.365');
  assert.equal(search.children[1].attrs.slot, 'details-item');
  search.places = [{id: 'google-business'}]; search.emit('gmp-load');
  assert.match(h.get('busyness-status').textContent, /Choose the matching/);
  assert(!h.created.some(e => e.tagName === 'gmp-place-details'));
  search.emit('gmp-select', {place: {id: 'google-business'}});
  const details = h.widget(); assert.equal(details.tagName, 'gmp-place-details');
  assert.equal(details.children[0].place, 'google-business');
  const popular = details.children.find(e => e.tagName === 'gmp-place-popular-times'); popular.rendered = true; details.emit('gmp-load');
  assert.equal(h.get('busyness-status').hidden, true);
  h.api.select({...shop, lat:48.429, tags: {...shop.tags, phone: 'new'}}); assert.equal(h.widget(), details);
  assert.equal(new URL(h.get('busyness-apple-link').href).searchParams.get('coordinate'),'48.42900,-123.36500');
  assert.equal(h.calls.length, 1);
  assert(!h.created.some(e => /advanced|gmp-map|autocomplete/.test(e.tagName)));
});

test('missing popular times and empty business searches have distinct usable fallbacks', async () => {
  const h = setup(); h.api.select(shop); h.get('busyness-show').click(); await flush();
  h.widget().places = []; h.widget().emit('gmp-load');
  assert.match(h.get('busyness-status').textContent, /No matching business/);
  h.widget().emit('gmp-select', {place: {id: 'no-data'}}); const details = h.widget(); details.children.find(e => e.tagName === 'gmp-place-popular-times').rendered = false; details.emit('gmp-load');
  assert.match(h.get('busyness-status').textContent, /no popular-times data/);
  assert.equal(h.widget(), details); assert.equal(h.get('busyness-back').hidden, false);
  assert.match(h.get('busyness-google-link').href, /^https:\/\/www.google.com\/maps\/search/);
});

test('SDK releases without the rendered flag do not falsely label a visible graph as missing', async () => {
  const h = setup(); h.api.select(shop); h.get('busyness-show').click(); await flush();
  h.widget().emit('gmp-select', {place: {id: 'has-graph'}}); h.widget().emit('gmp-load');
  assert.doesNotMatch(h.get('busyness-status').textContent, /no popular-times data/);
  assert.match(h.get('busyness-status').textContent, /when data is available/);
});

test('Google denial stops requests for this session until Pacific midnight, including after reload or changing pins', async () => {
  const h = setup(); h.api.select(shop); h.get('busyness-show').click(); await flush(); const denied = h.widget(); denied.emit('gmp-error');
  denied.emit('gmp-load'); denied.emit('gmp-select', {place: {id: 'late'}});
  assert.equal(h.widget(), undefined); assert.equal(h.get('busyness-show').hidden, true);
  assert.match(h.get('busyness-status').textContent, /may have been reached/);
  h.api.select({...shop, osm: 'node/2'}); h.get('busyness-show').click(); await flush(); assert.equal(h.calls.length, 1);
  const reloaded = setup({storage: h.storage, now: h.now()}); reloaded.api.select(shop); reloaded.get('busyness-show').click(); await flush(); assert.equal(reloaded.calls.length, 0);
  assert.deepEqual(Object.keys(JSON.parse([...h.storage.values()][0])), ['until']);
  await h.advance(12 * 3600000 + 1); h.api.select({...shop, osm: 'node/2'}); h.get('busyness-show').click(); await flush(); assert.equal(h.widget().tagName, 'gmp-place-search');
});

test('configuration/network and slow widgets allow a manual retry without endless requests', async () => {
  const h = setup({configured: false}); h.api.select(shop); h.get('busyness-show').click(); await flush();
  assert.match(h.get('busyness-status').textContent, /unavailable right now/); assert.equal(h.storage.size, 0);
  h.setConfigured(true); h.get('busyness-show').click(); await flush(); const old = h.widget();
  await h.advance(18000); assert.equal(h.widget(), undefined); assert.match(h.get('busyness-status').textContent, /too long/);
  old.emit('gmp-error'); assert.equal(h.storage.size, 0);
  await h.advance(60000); assert.equal(h.calls.length, 2);
  h.get('busyness-show').click(); await flush(); assert.equal(h.widget().tagName, 'gmp-place-search');
});

test('old widget events and async loads cannot replace a new pin or trigger charges for it', async () => {
  const h = setup(); h.api.select(shop); h.get('busyness-show').click(); h.api.select({...shop, osm: 'node/2'}); await flush();
  assert.equal(h.widget(), undefined);
  h.get('busyness-show').click(); await flush(); const old = h.widget();
  h.api.select(null); old.emit('gmp-load'); old.emit('gmp-error'); old.emit('gmp-select', {place: {id: 'old'}});
  assert.equal(h.widget(), undefined); assert.equal(h.get('place-busyness').hidden, true); assert.equal(h.storage.size, 0);
});

test('the lazy loader uses the runtime key once, and a missing component fails without a billable query', async () => {
  const h = setup({bootstrapped: false}); h.api.select(shop); h.get('busyness-show').click(); await flush();
  assert.equal(h.document.head.children.length, 1);
  const script = h.document.head.children[0], url = new URL(script.src);
  assert.equal(url.origin, 'https://maps.googleapis.com'); assert.equal(url.searchParams.get('loading'), 'async');
  h.window.google = h.google; h.window[url.searchParams.get('callback')](); await flush(); assert.equal(h.widget().tagName, 'gmp-place-search');
  const missing = setup({available: false}); missing.api.select(shop); missing.get('busyness-show').click(); await flush();
  assert.match(missing.get('busyness-status').textContent, /not available here yet/); assert.equal(missing.widget(), undefined);
});
