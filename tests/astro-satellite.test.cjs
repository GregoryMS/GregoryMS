const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {parsePosition, trackSegments, passesURL} = require('../assets/astro-satellite.js');
const sample = () => ({id:25544, units:'kilometers', latitude:49, longitude:-123,
  altitude:420, velocity:27600, timestamp:Date.now()/1000, visibility:'daylight'});

test('satellite positions reject stale, malformed and out-of-range readings', () => {
  assert.equal(parsePosition(sample()).sunlight, 'In sunlight');
  assert.equal(parsePosition({...sample(), visibility:'eclipsed'}).sunlight, 'In Earth’s shadow');
  assert.equal(parsePosition({...sample(), visibility:'unknown'}).sunlight, 'Unknown');
  for (const override of [{timestamp:0}, {timestamp:Date.now()/1000+120},
    {latitude:91}, {longitude:181}, {altitude:null}, {velocity:'27600'}, {units:'miles'}, {id:1}]) {
    assert.throws(() => parsePosition({...sample(), ...override}));
  }
});
test('recent tracks break at the date line and after paused updates', () => {
  const points = [
    {latitude:1, longitude:179, timestamp:1}, {latitude:2, longitude:-179, timestamp:11},
    {latitude:3, longitude:-178, timestamp:21}, {latitude:4, longitude:-175, timestamp:100}
  ];
  assert.deepEqual(trackSegments(points), [[[1,179]], [[2,-179],[3,-178]], [[4,-175]]]);
});
test('pass links preserve observing coordinates and safely encode the name', () => {
  const url = new URL(passesURL({latitude:48.43, longitude:-123.37, name:'Victoria & Harbour'}));
  assert.equal(url.hostname, 'www.heavens-above.com');
  assert.equal(url.searchParams.get('satid'), '25544');
  assert.equal(url.searchParams.get('lat'), '48.43');
  assert.equal(url.searchParams.get('lng'), '-123.37');
  assert.equal(url.searchParams.get('loc'), 'Victoria & Harbour');
  assert.equal(url.searchParams.has('tz'), false);
  assert.equal(passesURL({latitude:NaN, longitude:0}), 'https://www.heavens-above.com/');
});

function harness() {
  const nodes = new Map(), events = {}, windowEvents = {}, timers = new Map(), calls = [];
  let observer, fetchImpl = async () => ({ok:true, json:async () => sample()});
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {textContent:'', checked:true, disabled:false,
      events:{}, addEventListener(type, handler) { this.events[type] = handler; }});
    return nodes.get(id);
  }
  let time = Date.now(), nextTimer = 0;
  class Clock extends Date { static now() { return time; } }
  const document = {hidden:false, getElementById:node, addEventListener(type, handler) {events[type] = handler;}};
  const window = {document, AbortController, URLSearchParams,
    fetch:(...args) => {calls.push(args); return fetchImpl(...args);},
    setTimeout(fn, ms) {const id = ++nextTimer; timers.set(id, {fn, ms}); return id;},
    clearTimeout(id) {timers.delete(id);},
    addEventListener(type, handler) {windowEvents[type] = handler;},
    IntersectionObserver:class {constructor(handler) {observer = handler;} observe() {}}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/astro-satellite.js'), 'utf8'),
    {window, Date:Clock, URLSearchParams, AbortController});
  const flush = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};
  return {window, document, nodes, calls, timers, events, windowEvents, node, flush,
    setFetch(fn) {fetchImpl = fn;},
    advance(ms) {time += ms;},
    view(value) {observer([{isIntersecting:value}]);},
    async tick() {const entry = [...timers].find(([,t]) => t.ms === 10000); assert.ok(entry);
      timers.delete(entry[0]); time += 10000; entry[1].fn(); await flush();}
  };
}
test('tracker loads only on screen, pauses when hidden and retains failed data with a timestamp', async () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  h.window.GregleSatellite.setLocation({name:'Victoria', latitude:48.43, longitude:-123.37});
  assert.match(h.node('satellite-passes').href, /lat=48.43/);
  h.view(true); await h.flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.node('satellite-altitude').textContent, '420 km');
  assert.match(h.node('satellite-status').textContent, /Position at/);
  h.setFetch(async () => {throw Error('Offline');});
  await h.tick();
  assert.equal(h.node('satellite-altitude').textContent, '420 km');
  assert.match(h.node('satellite-status').textContent, /Showing the last position at/);
  h.document.hidden = true; h.events.visibilitychange();
  assert.equal(h.timers.size, 0);
  h.advance(10000); h.document.hidden = false; h.events.visibilitychange(); await h.flush();
  assert.equal(h.calls.length, 3);
  h.view(false); assert.equal(h.timers.size, 0);
  h.advance(10000); h.view(true); await h.flush();
  assert.equal(h.calls.length, 4);
  h.windowEvents.pagehide(); assert.equal(h.timers.size, 0);
  assert.equal(h.calls[0][0], 'https://api.wheretheiss.at/v1/satellites/25544');
});
test('an invalid first response exposes a recoverable error without invented telemetry', async () => {
  const h = harness(); h.setFetch(async () => ({ok:true, json:async () => ({})}));
  h.view(true); await h.flush();
  assert.match(h.node('satellite-status').textContent, /Live position unavailable/);
  assert.equal(h.node('satellite-altitude').textContent, '');
  assert.equal(h.node('satellite-refresh').disabled, false);
  assert.ok(h.timers.size);
});
