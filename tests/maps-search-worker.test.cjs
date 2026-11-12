const {test} = require('node:test');
const assert = require('node:assert/strict');
const handler = import('../workers/site-router-recovery/worker.mjs').then(m => m.default);
const core = require('../assets/maps-core.js');
const testKey = 'ovp_synthetic_test_key_1234567890';
const env = {OVERPASS_GEOCODING_API_KEY: testKey, TOMTOM_API_KEY: 'unused_tomtom_navigation_key'};
const endpoint = 'https://maps.gregle.uk/api/maps/search';
const point = {type: 'Feature', geometry: {type: 'Point', coordinates: [-123.12, 49.28]}, properties: {name: 'Vancouver', country: 'Canada'}};

test('search and suggestions use overpass.ch with header authentication and no exposed key', async t => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({url: new URL(url), options});
    return Response.json({type: 'FeatureCollection', features: [point]});
  });
  const area = core.searchArea({lat: 49.28, lng: -123.12, zoom: 13}, [-123.25,49.2,-123,49.4]);
  const router = await handler;
  const response = await router.fetch(new Request(core.searchURL(endpoint, 'Vancouver', area)), env);
  assert.equal(response.status, 200);
  assert.deepEqual(core.readResults(await response.json(), area).map(p => p.name), ['Vancouver']);
  assert.equal(calls[0].url.origin, 'https://api.overpass.ch');
  assert.equal(calls[0].url.pathname, '/v1/geocode/api');
  assert.equal(calls[0].url.href.includes(testKey), false);
  assert.equal(calls[0].options.headers['X-API-Key'], testKey);
  assert.equal(calls[0].url.searchParams.get('bbox'), [area.west,area.south,area.east,area.north].join(','));
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const worldwide = await router.fetch(new Request(core.searchURL(endpoint, 'Paris'), {headers: {Origin: 'https://gregle.uk'}}), env);
  assert.equal(worldwide.status, 200);
  assert.equal(worldwide.headers.get('Access-Control-Allow-Origin'), 'https://gregle.uk');
  assert.equal(calls[1].url.searchParams.has('bbox'), false);
});

test('invalid searches, foreign origins and rate limits never reach the search provider', async t => {
  t.mock.method(global, 'fetch', () => {throw Error('Unexpected upstream call');});
  const router = await handler;
  for (const query of ['q=x', 'q=Vancouver&url=https://example.com', 'q=Vancouver&lat=NaN', 'q=Vancouver&limit=999', 'q=Vancouver&bbox=1,2,-1,-2', 'q=Vancouver&q=Paris']) {
    assert.equal((await router.fetch(new Request(`${endpoint}?${query}`))).status, 400, query);
  }
  assert.equal((await router.fetch(new Request(`${endpoint}?q=Vancouver`, {headers: {Origin: 'https://example.com'}}))).status, 403);
  assert.equal((await router.fetch(new Request(endpoint, {method: 'POST'}))).status, 405);
  assert.equal((await router.fetch(new Request(`${endpoint}?q=Vancouver`), {MAPS_SEARCH_LIMIT: {limit: async () => ({success: false})}})).status, 429);
});

test('missing search credentials cannot fall back to the TomTom navigation key', async t => {
  t.mock.method(global, 'fetch', () => {throw Error('Unexpected provider call');});
  for (const credentials of [{}, {TOMTOM_API_KEY: env.TOMTOM_API_KEY}, {OVERPASS_GEOCODING_API_KEY: 'invalid'}]) {
    const response = await (await handler).fetch(new Request(`${endpoint}?q=Vancouver`), credentials);
    assert.equal(response.status, 503);
  }
});

test('high zoom is compatible with the hosted Photon API and accidental key echoes are removed', async t => {
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(new URL(url).searchParams.get('zoom'), '18');
    assert.equal(options.headers['X-API-Key'], testKey);
    return Response.json({type: 'FeatureCollection', features: [{...point, properties: {name: 'Cafe ' + testKey}}]});
  });
  const response = await (await handler).fetch(new Request(`${endpoint}?q=cafe&zoom=19`), env);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(body.includes(testKey), false);
  assert.equal(core.readResults(JSON.parse(body))[0].name, 'Cafe');
});

test('upstream errors, invalid data and oversized responses fail safely', async t => {
  const router = await handler;
  for (const response of [new Response('Unavailable', {status: 503}), new Response('Too many requests', {status: 429}), Response.json({error: 'invalid'}), new Response('x'.repeat(262145))]) {
    const mock = t.mock.method(global, 'fetch', async () => response);
    const result = await router.fetch(new Request(`${endpoint}?q=Vancouver`), env);
    assert.equal(result.status, response.status === 429 ? 429 : 502);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    mock.mock.restore();
  }
  const calls = [];
  t.mock.method(global, 'fetch', async url => {calls.push(new URL(url).hostname); throw Error('Timed out');});
  assert.equal((await router.fetch(new Request(`${endpoint}?q=Vancouver`), env)).status, 502);
  assert.deepEqual(calls, ['api.overpass.ch']);
});
