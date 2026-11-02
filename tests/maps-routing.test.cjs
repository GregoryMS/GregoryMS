const { test } = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../assets/maps-routing.js');
const core = require('../assets/maps-navigation-core.js');
const from = {lat: 48.42, lng: -123.36}, to = {lat: 48.43, lng: -123.35};
const key = 'test-key-1234567890';
const storage = connected => {
  const values = new Map(connected ? [['gregle-maps-tomtom-key', key]] : []);
  return {getItem: name => values.get(name), setItem: (name, value) => values.set(name, value)};
};
const osrm = () => ({code: 'Ok', routes: [{distance: 1850, duration: 300, geometry: {type: 'LineString', coordinates: [[from.lng, from.lat], [from.lng, to.lat], [to.lng, to.lat]]}, legs: []}]});
const traffic = () => ({routes: [{summary: {lengthInMeters: 1850, travelDurationInSeconds: 600, trafficDelayDurationInSeconds: 300}, legs: [{path: osrm().routes[0].geometry}],
  instructions: [
    {maneuver: 'depart', routeOffsetInMeters: 0, message: 'Start on First Street'},
    {maneuver: 'turnRight', routeOffsetInMeters: 1112, message: 'Turn right onto Second Street'},
    {maneuver: 'arriveRight', routeOffsetInMeters: 1850, message: 'Arrive at your destination on the right'}
  ], progressPoints: [{pathIndex: 0, travelDurationInSeconds: 0}, {pathIndex: 1, travelDurationInSeconds: 500}, {pathIndex: 2, travelDurationInSeconds: 600}]}]});
const ok = data => ({ok: true, status: 200, json: async () => data});

test('traffic requests use current traffic and guidance with the key in a header', () => {
  const request = routing.trafficRequest(from, to, key), body = JSON.parse(request.options.body);
  assert.equal(new URL(request.url).origin, 'https://api.tomtom.com');
  assert.equal(request.options.headers['TomTom-Api-Key'], key);
  assert(!request.url.includes(key)); assert(!request.options.body.includes(key));
  assert.deepEqual(body.routePlanningLocations.origin.coordinates, [from.lng, from.lat]);
  assert.deepEqual(body.routePlanningLocations.destination.coordinates, [to.lng, to.lat]);
  assert.equal(body.traffic, 'live'); assert.equal(body.departureDateTime, 'now');
  assert.equal(body.guidance, 'instructions'); assert.equal(body.travelMode, 'car');
});

test('traffic routes preserve provider guidance, geometry, delays and non-uniform journey time', () => {
  const route = routing.readTrafficRoute(traffic());
  assert.equal(route.traffic, true); assert.equal(route.provider, 'tomtom'); assert.equal(route.duration, 600);
  assert.equal(route.steps[1].text, 'Turn right onto Second Street'); assert.equal(route.steps[1].modifier, 'right');
  assert.equal(route.steps[2].type, 'arrive'); assert.equal(route.trafficDelay, 300);
  const progress = core.progress(route, {lat: to.lat, lng: from.lng});
  assert.equal(Math.round(progress.seconds), 100);
  assert.match(routing.note(route), /Live traffic included.*5 min/);
});

test('invalid traffic estimates, paths and guidance cannot become navigation routes', () => {
  for (const modify of [d => d.routes[0].summary.travelDurationInSeconds = -1,
    d => d.routes[0].legs[0].path.coordinates[0][0] = 181,
    d => d.routes[0].instructions = [], d => d.routes[0].instructions[1].routeOffsetInMeters = NaN,
    d => d.routes[0].instructions[2].routeOffsetInMeters = 2,
    d => d.routes[0].instructions[1].message = {}]) {
    const data = traffic(); modify(data); assert.throws(() => routing.readTrafficRoute(data));
  }
});

test('traffic defaults on, persists off, and walking never calls TomTom', async () => {
  const saved = storage(true), calls = [];
  const service = routing.create({storage: saved, fetch: async url => {calls.push(url); return ok(osrm());}});
  assert.equal(service.enabled, true); assert.equal(service.connected, true);
  service.setEnabled(false);
  const route = await service.request(from, to);
  assert.equal(route.traffic, false); assert.equal(route.trafficReason, 'off');
  assert(calls[0].includes('project-osrm.org'));
  assert.equal(routing.create({storage: saved}).enabled, false);
  service.setEnabled(true); await service.request(from, to, 'walking');
  assert(calls[1].includes('routed-foot')); assert.equal(calls.length, 2);
});

test('missing credentials and denied or exhausted keys use explicit traffic-free fallback', async () => {
  const missing = routing.create({storage: storage(false), fetch: async () => ok(osrm())});
  assert.equal(missing.enabled, false);
  const route = await missing.request(from, to);
  assert.equal(route.trafficReason, 'missing-key'); assert.match(routing.note(route), /Connect TomTom/);
  for (const status of [403, 429]) {
    const calls = [], service = routing.create({storage: storage(true), fetch: async url => {
      calls.push(url); return url.includes('tomtom') ? {ok: false, status} : ok(osrm());
    }});
    const result = await service.request(from, to);
    assert.equal(result.traffic, false); assert.equal(result.trafficReason, 'unavailable');
    assert.match(routing.note(result), /Live traffic unavailable/);
    await service.request(from, to); assert.equal(calls.filter(url => url.includes('tomtom')).length, 1);
    service.setEnabled(true); await service.request(from, to);
    assert.equal(calls.filter(url => url.includes('tomtom')).length, 2);
  }
});

test('a cancelled traffic request cannot fall back or return stale geometry', async () => {
  const controller = new AbortController(), calls = [];
  let complete;
  const service = routing.create({storage: storage(true), fetch: url => {calls.push(url); return new Promise(resolve => {complete = resolve;});}});
  const request = service.request(from, to, 'driving', {signal: controller.signal});
  controller.abort(); complete(ok(traffic()));
  await assert.rejects(request, {name: 'AbortError'}); assert.equal(calls.length, 1);
});

test('successful traffic data never calls the fallback provider; storage failure remains usable', async () => {
  const calls = [], service = routing.create({storage: storage(true), fetch: async url => {calls.push(url); return ok(traffic());}});
  assert.equal((await service.request(from, to)).traffic, true); assert.equal(calls.length, 1);
  const unavailableStorage = routing.create({storage: {getItem() {throw Error();}, setItem() {throw Error();}}, fetch: async () => ok(osrm())});
  unavailableStorage.setEnabled(false); assert.equal((await unavailableStorage.request(from, to)).traffic, false);
});

test('connecting or forgetting a key updates the default without overwriting an explicit off choice', () => {
  const saved = storage(false), service = routing.create({storage: saved});
  assert.equal(service.enabled, false);
  saved.setItem('gregle-maps-tomtom-key', key); assert.equal(service.enabled, true);
  service.setEnabled(false); assert.equal(service.enabled, false);
  saved.setItem('gregle-maps-tomtom-key', ''); assert.equal(service.enabled, false);
  saved.setItem('gregle-maps-tomtom-key', key); assert.equal(service.enabled, false);
});
