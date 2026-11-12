const {test} = require('node:test');
const assert = require('node:assert/strict');
const handler = import('../workers/site-router-recovery/worker.mjs').then(m => m.default);
const core = require('../assets/maps-core.js');
const endpoint = 'https://maps.gregle.uk/api/maps/search';
const point = {type: 'Feature', geometry: {type: 'Point', coordinates: [-123.12, 49.28]}, properties: {name: 'Vancouver', country: 'Canada'}};

test('search and suggestions work through the recovery router without provider secrets or upstream CORS', async t => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({url: new URL(url), options});
    return Response.json({type: 'FeatureCollection', features: [point]});
  });
  const area = core.searchArea({lat: 49.28, lng: -123.12, zoom: 13}, [-123.25,49.2,-123,49.4]);
  const router = await handler;
  const response = await router.fetch(new Request(core.searchURL(endpoint, 'Vancouver', area)));
  assert.equal(response.status, 200);
  assert.deepEqual(core.readResults(await response.json(), area).map(p => p.name), ['Vancouver']);
  assert.equal(calls[0].url.origin, 'https://photon.komoot.io');
  assert.equal(calls[0].url.searchParams.get('bbox'), [area.west,area.south,area.east,area.north].join(','));
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const worldwide = await router.fetch(new Request(core.searchURL(endpoint, 'Paris'), {headers: {Origin: 'https://gregle.uk'}}));
  assert.equal(worldwide.status, 200);
  assert.equal(worldwide.headers.get('Access-Control-Allow-Origin'), 'https://gregle.uk');
  assert.equal(calls[1].url.searchParams.has('bbox'), false);
});

test('invalid searches, foreign origins and rate limits never reach Photon', async t => {
  t.mock.method(global, 'fetch', () => {throw Error('Unexpected upstream call');});
  const router = await handler;
  for (const query of ['q=x', 'q=Vancouver&url=https://example.com', 'q=Vancouver&lat=NaN', 'q=Vancouver&limit=999', 'q=Vancouver&bbox=1,2,-1,-2', 'q=Vancouver&q=Paris']) {
    assert.equal((await router.fetch(new Request(`${endpoint}?${query}`))).status, 400, query);
  }
  assert.equal((await router.fetch(new Request(`${endpoint}?q=Vancouver`, {headers: {Origin: 'https://example.com'}}))).status, 403);
  assert.equal((await router.fetch(new Request(endpoint, {method: 'POST'}))).status, 405);
  assert.equal((await router.fetch(new Request(`${endpoint}?q=Vancouver`), {MAPS_SEARCH_LIMIT: {limit: async () => ({success: false})}})).status, 429);
});

test('configured TomTom search preserves nearby bounds, normalizes results and keeps the key private', async t => {
  const key = 'test_tomtom_private_key_12345', calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({url: new URL(url), options});
    return Response.json({results: [{position: {lat: 49.28, lon: -123.12}, poi: {name: 'Coffee ' + key}, address: {streetName: 'Main Street', streetNumber: '123', municipality: 'Vancouver', country: 'Canada'}}, {position: {lat: 999, lon: 999}}]});
  });
  const response = await (await handler).fetch(new Request(`${endpoint}?q=coffee&lat=49.28&lon=-123.12&bbox=-123.4,49.1,-122.9,49.5&limit=20`), {TOMTOM_API_KEY: key});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes(key), false);
  const places = core.readResults(JSON.parse(body));
  assert.equal(places.length, 1);
  assert.equal(places[0].name, 'Coffee');
  assert.match(places[0].detail, /123 Main Street/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://api.tomtom.com');
  assert.equal(calls[0].url.searchParams.get('geobias'), 'point:49.28,-123.12');
  assert.equal(calls[0].url.searchParams.get('topLeft'), '49.5,-123.4');
  assert.equal(calls[0].url.searchParams.get('btmRight'), '49.1,-122.9');
  assert.equal(calls[0].url.searchParams.get('typeahead'), 'true');
});

test('a failed TomTom connection falls back to Photon without forwarding credentials', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    if (++calls === 1) return new Response('Forbidden', {status: 403});
    assert.equal(new URL(url).origin, 'https://photon.komoot.io');
    assert.equal(new URL(url).searchParams.has('key'), false);
    assert.deepEqual(options.headers, {Accept: 'application/json'});
    return Response.json({type: 'FeatureCollection', features: [point]});
  });
  const response = await (await handler).fetch(new Request(`${endpoint}?q=Vancouver`), {TOMTOM_API_KEY: 'test_tomtom_private_key_12345'});
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal((await response.json()).features.length, 1);
});

test('upstream errors, invalid data and oversized responses fail safely', async t => {
  const router = await handler;
  for (const response of [new Response('Unavailable', {status: 503}), new Response('Too many requests', {status: 429}), Response.json({error: 'invalid'}), new Response('x'.repeat(262145))]) {
    const mock = t.mock.method(global, 'fetch', async () => response);
    const result = await router.fetch(new Request(`${endpoint}?q=Vancouver`));
    assert.equal(result.status, response.status === 429 ? 429 : 502);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    mock.mock.restore();
  }
  t.mock.method(global, 'fetch', async () => {throw Error('Timed out');});
  assert.equal((await router.fetch(new Request(`${endpoint}?q=Vancouver`))).status, 502);
});
