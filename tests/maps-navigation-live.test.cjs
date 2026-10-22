const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const core = require('../assets/maps-navigation-core.js');
const origin = { lat: 48.42, lng: -123.36 }, corner = { lat: 48.43, lng: -123.36 }, destination = { lat: 48.43, lng: -123.35 };
function response() {
  return { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[origin.lng, origin.lat], [corner.lng, corner.lat], [destination.lng, destination.lat]] }, distance: 1850, duration: 300, legs: [{ steps: [
    { distance: 1112, name: 'First Street', maneuver: { type: 'depart', location: [origin.lng, origin.lat] } },
    { distance: 738, name: 'Second Street', maneuver: { type: 'turn', modifier: 'right', location: [corner.lng, corner.lat] } },
    { distance: 0, maneuver: { type: 'arrive', location: [destination.lng, destination.lat] } }
  ] }] }] };
}
test('walking uses an actual pedestrian endpoint and matching handoff modes', () => {
  const u = new URL(core.routeURL(origin, destination, 'walking'));
  assert.equal(u.origin, 'https://routing.openstreetmap.de'); assert(u.pathname.includes('/routed-foot/route/v1/foot/'));
  const links = core.links(origin, destination, 'walking');
  assert.equal(new URL(links.google).searchParams.get('travelmode'), 'walking'); assert.equal(new URL(links.apple).searchParams.get('dirflg'), 'w');
  assert.throws(() => core.routeURL(origin, destination, 'bicycle'));
  assert.throws(() => core.readRoute({ code: 'NoRoute' }, 'walking'), /No walking route/);
});
test('progress follows geometry, advances turns, detects deviation and arrival', () => {
  const route = core.readRoute(response());
  const before = core.progress(route, { lat: 48.425, lng: -123.36 });
  assert.equal(before.next.text, 'Turn right onto Second Street'); assert(before.turnDistance > 550 && before.turnDistance < 560);
  const after = core.progress(route, { lat: 48.43, lng: -123.357 }, before);
  assert.equal(after.next.type, 'arrive'); assert(after.remaining < before.remaining); assert(after.seconds < before.seconds);
  assert(core.progress(route, { lat: 48.425, lng: -123.37 }).away > 500);
  assert.equal(core.progress(route, destination, after).arrived, true);
  assert.equal(core.progress(route, { lat: 48.43, lng: -123.352 }, before).arrived, false);
  assert.equal(core.progress(route, { lat: NaN, lng: 0 }), null);
});
function harness() {
  const elements = new Map(), events = {}, cleared = [], pending = [], markers = [], spoken = [], removed = [];
  let now = 1800000000000, success, failure, tick, stopMessage, routeUpdates = 0;
  class El {
    constructor() { this.textContent = ''; this.hidden = false; this.events = {}; this.attributes = {}; this.style = {}; this.classList = { add() {}, remove() {} }; }
    addEventListener(name, fn) { this.events[name] = fn; } setAttribute(name, value) { this.attributes[name] = value; }
    getBoundingClientRect() { return { height: 230 }; } click() { return this.events.click?.(); }
  }
  const el = id => { if (!elements.has(id)) elements.set(id, new El()); return elements.get(id); };
  const item = p => ({ point: { lat: p[0], lng: p[1] }, addTo() { markers.push(this); return this; }, getLatLng() { return this.point; }, setLatLng(p) { this.point = { lat: p[0], lng: p[1] }; }, setRadius() {}, getElement() { return null; } });
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = { window: { GregleNavigation: core, addEventListener: (e, f) => { events[e] = f; }, speechSynthesis: { cancel() {}, speak(u) { spoken.push(u.text); } }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } },
    document: { getElementById: el, querySelector: () => el('stage'), hidden: false }, navigator: { geolocation: { watchPosition(s, f, options) { success = s; failure = f; assert.equal(options.maximumAge, 0); return 0; }, clearWatch(id) { cleared.push(id); } } },
    L: { marker: item, circle: item, divIcon: p => p }, Date: FakeDate, AbortController,
    setInterval: f => { tick = f; return 1; }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-navigation-live.js'), 'utf8'), context);
  const map = { on: (e, f) => { events[e] = f; }, removeLayer: l => removed.push(l), panTo() {}, getSize: () => ({ x: 600, y: 800 }), project: () => ({ y: 100 }), unproject: p => p, setView() {} };
  const live = context.window.GregleLiveNavigation({ map, onRoute: () => { routeUpdates++; }, onStop: m => { stopMessage = m; } });
  return { el, live, pending, cleared, markers, spoken, removed, events, tick: () => tick(), advance: ms => { now += ms; }, routeUpdates: () => routeUpdates, message: () => stopMessage,
    fix: (p, accuracy = 5, age = 0) => success({ coords: { latitude: p.lat, longitude: p.lng, accuracy }, timestamp: now - age }), error: code => failure({ code }) };
}
test('GPS watch follows movement, recenter works, and stop clears watch ID zero', () => {
  const h = harness(); h.live.start(core.readRoute(response()), 'driving', destination);
  assert.equal(h.live.active, true); h.fix(origin); assert.equal(h.markers.length, 2); assert.match(h.el('navigation-instruction').textContent, /Second Street/);
  h.events.dragstart(); assert.equal(h.el('navigation-follow').textContent, 'Recenter'); h.el('navigation-follow').click(); assert.equal(h.el('navigation-follow').textContent, 'Following');
  h.el('navigation-voice').click(); assert(h.spoken.length); h.el('navigation-stop').click();
  assert.equal(h.live.active, false); assert.deepEqual(h.cleared, [0]); assert.equal(h.removed.length, 2); assert.equal(h.el('navigation-live').hidden, true);
  h.fix(destination); assert.equal(h.markers.length, 2);
});
test('poor, stale, denied and missing GPS never produce fresh turn guidance', () => {
  const h = harness(); h.live.start(core.readRoute(response()), 'walking', destination);
  h.fix(origin, 150); assert.equal(h.markers.length, 0); assert.match(h.el('navigation-status').textContent, /accuracy/);
  h.fix(origin, 5, 20000); assert.equal(h.markers.length, 0);
  h.fix(origin); h.advance(16000); h.tick(); assert.match(h.el('navigation-instruction').textContent, /Waiting/);
  h.fix(origin); assert.match(h.el('navigation-status').textContent, /Walking/);
  h.error(1); assert.equal(h.live.active, false); assert.match(h.message(), /denied/); assert.deepEqual(h.cleared, [0]);
});
test('persistent off-route locations reroute with the selected mode; stop aborts stale responses', async () => {
  const h = harness(); h.live.start(core.readRoute(response()), 'walking', destination); h.fix(origin);
  const off = { lat: 48.424, lng: -123.37 }; h.fix(off); assert.equal(h.pending.length, 0);
  h.advance(3100); h.fix(off); assert.equal(h.pending.length, 1); assert(h.pending[0].url.includes('routed-foot'));
  h.fix(off); assert.equal(h.pending.length, 1); h.live.stop(); assert.equal(h.pending[0].options.signal.aborted, true);
  h.pending[0].resolve({ ok: true, json: async () => response() }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.routeUpdates(), 0);
});
test('arrival ends GPS tracking and keeps an arrival card until Done', () => {
  const h = harness(); h.live.start(core.readRoute(response()), 'driving', destination); h.fix(origin); h.fix(destination);
  assert.equal(h.el('navigation-instruction').textContent, 'You have arrived'); assert.equal(h.el('navigation-stop').textContent, 'Done'); assert.deepEqual(h.cleared, [0]);
  assert.equal(h.live.active, true); h.el('navigation-stop').click(); assert.equal(h.live.active, false);
});
test('successful rerouting updates geometry and cannot run more often than the cooldown', async () => {
  const h = harness(); h.live.start(core.readRoute(response()), 'driving', destination); h.fix(origin);
  const off = { lat: 48.424, lng: -123.37 }; h.fix(off); h.advance(3100); h.fix(off);
  assert.equal(h.pending.length, 1); h.pending[0].resolve({ ok: true, json: async () => response() }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.routeUpdates(), 1); h.advance(4000); h.fix(off); h.advance(4000); h.fix(off); assert.equal(h.pending.length, 1);
  h.advance(15000); h.fix(off); assert.equal(h.pending.length, 2); h.live.stop();
});
test('starting away from the preview route recalculates from the first live fix', async () => {
  const h = harness(); h.live.start(core.readRoute(response()), 'walking', destination);
  const other = { lat: 48.426, lng: -123.36 }; h.fix(other); assert.equal(h.pending.length, 1); assert(h.pending[0].url.includes('-123.360000,48.426000'));
  h.live.stop(); h.pending[0].resolve({ ok: true, json: async () => response() }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.routeUpdates(), 0);
});
