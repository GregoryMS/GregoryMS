const {test} = require('node:test');
const assert = require('node:assert/strict');
const key = 'synthetic-server-key-1234567890';
const allowed = {limit: async () => ({success: true})};
const env = () => ({TOMTOM_API_KEY: key, TOMTOM_ROUTE_LIMIT: allowed, TOMTOM_TILE_LIMIT: allowed});
const endpoints = {from: {lat: 48.4284, lng: -123.3656}, to: {lat: 48.4126, lng: -123.3618}};
const request = (path = '/api/maps/tomtom/route', extra = {}) => new Request('https://maps.gregle.uk' + path, {
  method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://maps.gregle.uk', 'CF-Connecting-IP': '192.0.2.10'}, body: JSON.stringify(endpoints), ...extra,
});
const handler = async () => (await import('../workers/site-router/maps-tomtom.mjs')).mapsTomTom;

test('configuration exposes availability, never the default key; cross-site calls are rejected', async () => {
  const run = await handler();
  const response = await run(request('/api/maps/tomtom-config', {method: 'GET', body: null}), env());
  assert.deepEqual(await response.json(), {enabled: true}); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(await (await run(request('/api/maps/tomtom-config', {method: 'HEAD', body: null}), env())).text(), '');
  assert.deepEqual(await (await run(request('/api/maps/tomtom-config', {method: 'GET', body: null}), {})).json(), {enabled: false});
  assert.equal((await run(request('/api/maps/tomtom-config'), env())).status, 405);
  assert.equal((await run(request('/api/maps/tomtom/route', {headers: {Origin: 'https://foreign.test'}}), env())).status, 403);
  assert.equal((await run(new Request('https://gregle.uk/api/maps/tomtom-config'), env())).status, 404);
});

test('route proxy rebuilds a fixed request, sends the secret only to TomTom, and strips provider headers', async () => {
  const run = await handler(); let sent;
  const response = await run(request(), env(), async (url, options) => {
    sent = {url, options}; return new Response(JSON.stringify({routes: [{summary: {lengthInMeters: 100}}]}), {headers: {'Content-Type': 'application/json', 'X-Private-Header': key}});
  });
  assert.equal(response.status, 200); assert(!sent.url.includes(key)); assert.equal(sent.options.headers['TomTom-Api-Key'], key);
  assert.equal(sent.options.redirect, 'manual'); assert.equal(sent.url, 'https://api.tomtom.com/maps/orbis/routing/routes/calculate?apiVersion=3');
  const body = JSON.parse(sent.options.body); assert.equal(body.traffic, 'live');
  assert.deepEqual(body.routePlanningLocations.origin.coordinates, [-123.3656, 48.4284]);
  assert.equal(response.headers.get('X-Private-Header'), null); assert(!(await response.text()).includes(key));
});

test('default upstream fetch preserves the runtime global receiver', async () => {
  const run = await handler(), saved = global.fetch;
  global.fetch = async function () { assert.equal(this, globalThis); return new Response('{"routes":[]}', {headers: {'Content-Type': 'application/json'}}); };
  try { assert.equal((await run(request(), env())).status, 200); }
  finally { global.fetch = saved; }
});

test('invalid, oversized, arbitrary upstream and unsupported route requests cannot use the shared key', async () => {
  const run = await handler(); let calls = 0; const send = async () => {calls++; throw Error();};
  for (const req of [request('/api/maps/tomtom/route?key=anything'), request('/api/maps/tomtom/other'),
    request('/api/maps/tomtom/route', {body: 'x'.repeat(2049)}),
    request('/api/maps/tomtom/route', {body: JSON.stringify({...endpoints, url: 'https://foreign.test/'})}),
    request('/api/maps/tomtom/route', {body: JSON.stringify({...endpoints, from: {lat: 91, lng: 0}})}),
    request('/api/maps/tomtom/route', {method: 'GET', body: null}),
    request('/api/maps/tomtom/route', {headers: {'Content-Type': 'text/plain'}})]) {
    assert((await run(req, env(), send)).status >= 400);
  }
  assert.equal(calls, 0);
});

test('quota failures, provider errors and accidental credential echoes never disclose the key', async () => {
  const run = await handler();
  for (const status of [401, 403, 429, 500]) {
    const response = await run(request(), env(), async () => new Response(key, {status}));
    assert.equal(response.status, status === 500 ? 502 : status); assert(!(await response.text()).includes(key));
  }
  const echoed = await run(request(), env(), async () => new Response(JSON.stringify({routes: [], debug: key}), {headers: {'Content-Type': 'application/json'}}));
  assert.equal(echoed.status, 502); assert(!(await echoed.text()).includes(key));
  let calls = 0;
  const limited = await run(request(), {...env(), TOMTOM_ROUTE_LIMIT: {limit: async () => ({success: false})}}, async () => {calls++;});
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60'); assert.equal(calls, 0);
});

test('tile proxy validates coordinates and only returns bounded PNG data', async () => {
  const run = await handler(); let calls = 0;
  const tileRequest = path => request(path, {method: 'GET', body: null});
  const response = await run(tileRequest('/api/maps/tomtom/tiles/12/1000/1200'), env(), async (url, options) => {
    calls++; assert.equal(options.headers['TomTom-Api-Key'], key); assert(!url.includes(key));
    assert.equal(url, 'https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/12/1000/1200?apiVersion=2&style=light&tileSize=256');
    return new Response(new Uint8Array([137, 80, 78, 71]), {headers: {'Content-Type': 'image/png'}});
  });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'private, max-age=60');
  for (const path of ['/api/maps/tomtom/tiles/23/0/0', '/api/maps/tomtom/tiles/1/2/0', '/api/maps/tomtom/tiles/2/-1/0']) assert((await run(tileRequest(path), env())).status >= 400);
  assert.equal(calls, 1);
  const huge = await run(tileRequest('/api/maps/tomtom/tiles/1/0/0'), env(), async () => new Response('x'.repeat(500001), {headers: {'Content-Type': 'image/png'}}));
  assert.equal(huge.status, 502);
});
