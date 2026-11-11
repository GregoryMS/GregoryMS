const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const core = require('../assets/maps-navigation-core.js');
const traffic = require('../assets/maps-routing.js');
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
function harness({connected = false, threeDFactory} = {}) {
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
  const context = { window: { GregleNavigation3D: threeDFactory, GregleNavigation: core, GregleMapRouting: traffic, addEventListener: (e, f) => { events[e] = f; }, speechSynthesis: { cancel() {}, speak(u) { spoken.push(u.text); } }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } },
    document: { getElementById: el, querySelector: () => el('stage'), hidden: false }, navigator: { geolocation: { watchPosition(s, f, options) { success = s; failure = f; assert.equal(options.maximumAge, 0); return 0; }, clearWatch(id) { cleared.push(id); } } },
    L: { marker: item, circle: item, divIcon: p => p }, Date: FakeDate, AbortController,
    setInterval: f => { tick = f; return 1; }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-navigation-live.js'), 'utf8'), context);
  const map = { on: (e, f) => { events[e] = f; }, removeLayer: l => removed.push(l), panTo() {}, getSize: () => ({ x: 600, y: 800 }), project: () => ({ y: 100 }), unproject: p => p, setView() {} };
  const routing = traffic.create({fetch: context.fetch, storage: { getItem: key => connected && key === 'gregle-maps-tomtom-key' ? 'test-key-1234567890' : null, setItem() {} }});
  if (connected) routing.setEnabled(true);
  const request = routing.request; routing.request = async (...args) => ({...await request(...args), fetchedAt: now});
  const live = context.window.GregleLiveNavigation({ map, routing, onRoute: () => { routeUpdates++; }, onStop: m => { stopMessage = m; } });
  return { el, live, routing, context, pending, cleared, markers, spoken, removed, events, tick: () => tick(), advance: ms => { now += ms; }, routeUpdates: () => routeUpdates, message: () => stopMessage,
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

const trafficResponse = () => ({routes: [{summary: {lengthInMeters: 1850, travelDurationInSeconds: 600, trafficDelayDurationInSeconds: 300},
  legs: [{path: response().routes[0].geometry}], instructions: [
    {maneuver: 'depart', routeOffsetInMeters: 0, message: 'Start on First Street'},
    {maneuver: 'turnRight', routeOffsetInMeters: 1112, message: 'Turn right onto Second Street'},
    {maneuver: 'arrive', routeOffsetInMeters: 1850, message: 'Arrive at your destination'}]}]});

test('live traffic refreshes only with fresh visible GPS; stopping cancels a pending refresh', async () => {
  const h = harness({connected: true}); h.live.start(core.readRoute(response()), 'driving', destination); h.fix(origin);
  h.advance(121000); h.tick(); assert.equal(h.pending.length, 0);
  h.fix(origin); h.tick(); assert.equal(h.pending.length, 1); assert(h.pending[0].url.includes('tomtom'));
  h.pending[0].resolve({ok: true, status: 200, json: async () => trafficResponse()}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.routeUpdates(), 1); assert.match(h.el('navigation-traffic-note').textContent, /Live traffic included/);
  assert.equal(h.el('navigation-traffic-row').hidden, true);
  h.context.document.hidden = true; h.advance(121000); h.fix(origin); h.tick(); assert.equal(h.pending.length, 1);
  h.context.document.hidden = false; h.tick(); assert.equal(h.pending.length, 2);
  h.live.stop(); assert.equal(h.pending[1].options.signal.aborted, true);
  h.pending[1].resolve({ok: true, status: 200, json: async () => trafficResponse()}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.routeUpdates(), 1);
});

test('changing traffic mid-navigation aborts the old request and applies only the latest choice', async () => {
  const h = harness({connected: true}); h.live.start(core.readRoute(response()), 'driving', destination); h.fix(origin);
  h.routing.setEnabled(false); const first = h.live.refreshTraffic(); assert(h.pending[0].url.includes('project-osrm'));
  h.routing.setEnabled(true); const second = h.live.refreshTraffic(); assert(h.pending[1].url.includes('tomtom')); assert.equal(h.pending[0].options.signal.aborted, true);
  h.pending[0].resolve({ok: true, json: async () => response()}); await first; assert.equal(h.routeUpdates(), 0);
  h.pending[1].resolve({ok: true, status: 200, json: async () => trafficResponse()}); await second;
  assert.equal(h.routeUpdates(), 1); assert.equal(h.el('navigation-traffic').attributes['aria-checked'], 'true');
  h.live.stop();
});

test('traffic controls stay hidden during driving, walking and arrival', () => {
  const h = harness(); h.live.start(core.readRoute(response()), 'driving', destination);
  assert.equal(h.el('navigation-traffic-row').hidden, true);
  assert.equal(h.el('navigation-traffic').disabled, true); assert.equal(h.el('navigation-traffic').attributes['aria-checked'], 'false');
  h.fix(origin); h.fix(destination); assert.equal(h.el('navigation-traffic-row').hidden, true); h.live.stop();
  h.live.start(core.readRoute(response()), 'walking', destination); assert.equal(h.el('navigation-traffic-row').hidden, true); h.live.stop();
});


test('3D shares GPS and reroutes, and poor or stale GPS clears lane guidance', async () => {
  const calls = [], view = {active:true, enter:async()=>true, exit:()=>calls.push('exit'), setFollow(){}, update:()=>calls.push('position'), setRoute:()=>calls.push('route'), guidance:()=>calls.push('guidance'), clearGuidance:()=>calls.push('clear')};
  const h=harness({threeDFactory:()=>view});
  h.live.start(core.readRoute(response()),'driving',destination); h.fix(origin);
  const work=h.el('navigation-3d').click(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.pending.length,1); assert(h.pending[0].url.includes('gregle-mapbox'));
  h.pending[0].resolve({ok:true,json:async()=>response()}); await work;
  assert.equal(h.el('navigation-3d').textContent,'2D mode'); assert(calls.includes('route')); assert(calls.includes('guidance'));
  h.fix(origin,150); assert.equal(calls.at(-1),'clear');
  h.fix(origin); h.advance(16000); h.tick(); assert.equal(calls.at(-1),'clear');
  await h.el('navigation-3d').click(); assert.equal(h.el('navigation-3d').textContent,'3D mode');
  h.live.stop(); assert.deepEqual(h.cleared,[0]); assert(calls.filter(x=>x==='exit').length>=2);
});

test('stopping or cancelling while 3D loads cannot start a late route request', async () => {
  let finish, exits=0;
  const h=harness({threeDFactory:()=>({active:false, enter:()=>new Promise(resolve=>finish=resolve),exit(){exits++;},setFollow(){},clearGuidance(){}})});
  h.live.start(core.readRoute(response()),'driving',destination);
  const first=h.el('navigation-3d').click(); assert.equal(h.el('navigation-3d').textContent,'Cancel 3D');
  await h.el('navigation-3d').click(); finish(false); await first; assert.equal(h.pending.length,0);
  const second=h.el('navigation-3d').click(); h.live.stop(); finish(true); await second;
  assert.equal(h.pending.length,0); assert.equal(h.live.active,false); assert(exits>=3);
});

test('a failed 3D map load returns to 2D without ending GPS navigation', async () => {
  let exited=false;
  const h=harness({threeDFactory:()=>({active:false, enter:async()=>{throw Error('WebGL unavailable');},exit(){exited=true;},setFollow(){},clearGuidance(){}})});
  h.live.start(core.readRoute(response()),'driving',destination); await h.el('navigation-3d').click();
  assert(h.live.active); assert(exited); assert.match(h.el('navigation-status').textContent,/Continuing navigation in 2D/);
  assert.equal(h.el('navigation-3d').attributes['aria-pressed'],'false'); h.live.stop();
});

test('navigation requests fullscreen and restores the page when stopped', async () => {
  const h=harness(), classes=new Set(); let entered=0, exited=0;
  h.context.document.body={classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}};
  h.context.document.fullscreenEnabled=true;
  h.el('stage').requestFullscreen=async()=>{entered++;h.context.document.fullscreenElement=h.el('stage');};
  h.context.document.exitFullscreen=async()=>{exited++;h.context.document.fullscreenElement=null;};
  h.live.start(core.readRoute(response()),'driving',destination);
  await new Promise(resolve=>setImmediate(resolve));
  assert(classes.has('navigation-fullscreen'));assert.equal(entered,1);
  h.live.stop();assert(!classes.has('navigation-fullscreen'));assert.equal(exited,1);
  // A user-entered fullscreen view belongs to the user, including after Stop.
  h.context.document.fullscreenElement=h.el('stage');
  h.live.start(core.readRoute(response()),'driving',destination);h.live.stop();
  assert.equal(entered,1);assert.equal(exited,1);
});

test('a pending fullscreen request cannot leave the stopped page in fullscreen', async () => {
  const h=harness();let finish,exited=0;
  h.context.document.fullscreenEnabled=true;
  h.el('stage').requestFullscreen=()=>new Promise(resolve=>finish=()=>{h.context.document.fullscreenElement=h.el('stage');resolve();});
  h.context.document.exitFullscreen=async()=>{exited++;h.context.document.fullscreenElement=null;};
  h.live.start(core.readRoute(response()),'driving',destination);h.live.stop();finish();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(exited,1);
});

test('live rerouting retains an unvisited stop and drops it only after reaching it', async () => {
  const h = harness(), route = core.readRoute(response()), requests = [];
  route.stops = [{...corner, name: 'Coffee', at: route.cumulative[1]}];
  h.routing.request = async (...args) => {requests.push(args); return route;};
  h.live.start(route, 'driving', destination);
  h.fix({lat: 48.421, lng: origin.lng});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0][3].via[0].name, 'Coffee');
  h.fix(corner); h.fix({lat: corner.lat, lng: -123.357});
  h.routing.setEnabled(true); await h.live.refreshTraffic();
  assert.equal(requests.at(-1)[3].via.length, 0);
  h.live.stop();
});
