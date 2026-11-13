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

test('traffic defaults off even with a key, persists off, and walking never calls TomTom', async () => {
  const saved = storage(true), calls = [];
  const service = routing.create({storage: saved, fetch: async url => {calls.push(url); return ok(osrm());}});
  assert.equal(service.enabled, false); assert.equal(service.connected, true);
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
    service.setEnabled(true);
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
  service.setEnabled(true);
  const request = service.request(from, to, 'driving', {signal: controller.signal});
  controller.abort(); complete(ok(traffic()));
  await assert.rejects(request, {name: 'AbortError'}); assert.equal(calls.length, 1);
});

test('successful traffic data never calls the fallback provider; storage failure remains usable', async () => {
  const calls = [], service = routing.create({storage: storage(true), fetch: async url => {calls.push(url); return ok(traffic());}});
  service.setEnabled(true);
  assert.equal((await service.request(from, to)).traffic, true); assert.equal(calls.length, 1);
  const unavailableStorage = routing.create({storage: {getItem() {throw Error();}, setItem() {throw Error();}}, fetch: async () => ok(osrm())});
  unavailableStorage.setEnabled(false); assert.equal((await unavailableStorage.request(from, to)).traffic, false);
});

test('connecting a key stays off until explicitly enabled, and remembers that choice', () => {
  const saved = storage(false), service = routing.create({storage: saved});
  assert.equal(service.enabled, false);
  saved.setItem('gregle-maps-tomtom-key', key); assert.equal(service.enabled, false);
  service.setEnabled(false); assert.equal(service.enabled, false);
  saved.setItem('gregle-maps-tomtom-key', ''); assert.equal(service.enabled, false);
  saved.setItem('gregle-maps-tomtom-key', key); assert.equal(service.enabled, false);
});

test('the private default stays off until opted in and never exposes a key to the browser request', async () => {
  const calls = [], service = routing.create({defaultAvailable: true, storage: storage(false), fetch: async (url, options) => {
    calls.push({url, options}); return ok(url === '/api/maps/tomtom/route' ? traffic() : osrm());
  }});
  assert.equal(service.connected, true); assert.equal(service.enabled, false); assert.equal(service.hasOwnKey, false);
  await service.request(from, to); assert(calls[0].url.includes('project-osrm'));
  service.setEnabled(true); assert.equal((await service.request(from, to)).traffic, true);
  assert.equal(calls[1].url, '/api/maps/tomtom/route'); assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.headers['TomTom-Api-Key'], undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body), {from, to});
});

test('a personal key replaces the private default and never falls back to that default when declined', async () => {
  const calls = [], service = routing.create({defaultAvailable: true, storage: storage(true), fetch: async (url, options) => {
    calls.push({url, options}); return url.includes('tomtom.com') ? {ok: false, status: 403} : ok(osrm());
  }});
  service.setEnabled(true); assert.equal(service.hasOwnKey, true);
  const route = await service.request(from, to); assert.equal(route.traffic, false);
  assert.equal(calls[0].options.headers['TomTom-Api-Key'], key);
  assert.equal(calls.length, 2); assert(calls[1].url.includes('project-osrm'));
  assert(!calls.some(c => c.url === '/api/maps/tomtom/route'));
});

test('a malformed personal override cannot silently spend the shared default allowance', async () => {
  const saved = storage(false), calls = [];
  saved.setItem('gregle-maps-tomtom-key', 'invalid-personal-key!');
  const service = routing.create({defaultAvailable: true, storage: saved, fetch: async url => {calls.push(url); return url.includes('tomtom.com') ? {ok: false, status: 403} : ok(osrm());}});
  service.setEnabled(true); await service.request(from, to);
  assert.equal(service.hasOwnKey, true); assert.equal(calls.length, 2);
  assert(!calls.includes('/api/maps/tomtom/route'));
});

test('a stop routes each leg in order and preserves guidance and travel time', async () => {
  const stop = {lat: 48.425, lng: -123.355, name: 'Coffee'}, calls = [];
  const service = routing.create({fetch: async url => {
    calls.push(url);
    const ends = new URL(url).pathname.split('/').at(-1).split(';').map(pair => pair.split(',').map(Number));
    return ok({code: 'Ok', routes: [{geometry: {type: 'LineString', coordinates: ends}, distance: 1000, duration: 120,
      legs: [{steps: [{distance: 1000, maneuver: {type: 'depart', location: ends[0]}}, {distance: 0, maneuver: {type: 'arrive', location: ends[1]}}]}]}]});
  }, storage: storage(false)});
  const route = await service.request(from, to, 'walking', {via: [stop]});
  assert.equal(calls.length, 2);
  assert(calls[0].includes('-123.360000,48.420000;-123.355000,48.425000'));
  assert(calls[1].includes('-123.355000,48.425000;-123.350000,48.430000'));
  assert.equal(route.points.length, 3); assert.equal(route.duration, 240); assert.equal(route.distance, 2000);
  assert.equal(route.stops[0].at, route.cumulative[1]);
  assert.equal(route.timings.at(-1), 240); assert.equal(route.steps[1].type, 'stop');
  assert.match(route.steps[1].text, /Coffee/); assert.equal(route.steps.at(-1).type, 'arrive');
  assert.equal(core.progress(route, stop).arrived, false); assert.equal(core.progress(route, to).arrived, true);
  assert.equal(new URL(core.links(from, to, 'walking', [stop]).google).searchParams.get('waypoints'), '48.425000,-123.355000');
});

test('removing a stop aborts the remaining legs without publishing a partial route', async () => {
  const abort = new AbortController(), stop = {lat: 48.425, lng: -123.355}; let calls = 0;
  const service = routing.create({storage: storage(false), fetch: async () => {calls++; abort.abort(); return ok(osrm());}});
  await assert.rejects(service.request(from, to, 'driving', {via: [stop], signal: abort.signal}), {name: 'AbortError'});
  assert.equal(calls, 1);
});


test('four intermediate stops compose five ordered legs and reject a fifth before any request',async()=>{
 const via=Array.from({length:4},(_,i)=>({lat:48.421+i*.002,lng:-123.36,name:'Stop '+(i+1)})),calls=[];
 const service=routing.create({storage:storage(false),fetch:async url=>{
  calls.push(url);const coordinates=new URL(url).pathname.split('/').at(-1).split(';').map(pair=>pair.split(',').map(Number));
  return ok({code:'Ok',routes:[{geometry:{type:'LineString',coordinates},distance:100,duration:30,legs:[{steps:[{distance:100,maneuver:{type:'depart',location:coordinates[0]}},{distance:0,maneuver:{type:'arrive',location:coordinates[1]}}]}]}]});
 }});
 const route=await service.request(from,to,'driving',{via});assert.equal(calls.length,5);assert.equal(route.stops.length,4);assert.equal(route.duration,150);
 assert.deepEqual(route.stops.map(p=>p.name),via.map(p=>p.name));assert.equal(route.steps.filter(s=>s.type==='stop').length,4);
 const places=[from,...via,to];for(let i=0;i<5;i++)assert(calls[i].includes(places[i].lng.toFixed(6)+','+places[i].lat.toFixed(6)+';'+places[i+1].lng.toFixed(6)+','+places[i+1].lat.toFixed(6)));
 await assert.rejects(service.request(from,to,'driving',{via:[...via,via[0]]}),/four/);assert.equal(calls.length,5);
 assert.equal(core.links(from,to,'driving',[...via,via[0]]),null);
});
