const {test} = require('node:test');
const assert = require('node:assert/strict');
const key = 'test-browser-key-not-a-real-credential';
const endpoint = 'https://maps.gregle.uk/api/maps/google-config';

test('Google browser config is supplied only at runtime, never cached and supports HEAD', async () => {
  const {mapsGoogleConfig} = await import('../workers/site-router/maps-config.mjs');
  for (const value of [undefined, '', 'invalid secret', '<script>']) {
    const response = mapsGoogleConfig(new Request(endpoint), {GOOGLE_MAPS_BROWSER_KEY: value});
    assert.equal(response.status, 503); assert.equal((await response.json()).enabled, false);
  }
  const response = mapsGoogleConfig(new Request(endpoint), {GOOGLE_MAPS_BROWSER_KEY: key});
  assert.deepEqual(await response.json(), {enabled: true, browserKey: key});
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  const head = mapsGoogleConfig(new Request(endpoint, {method: 'HEAD'}), {GOOGLE_MAPS_BROWSER_KEY: key});
  assert.equal(head.status, 200); assert.equal(head.body, null);
});

test('cross-site browsers, other hosts and unsupported methods do not receive the runtime key', async () => {
  const {mapsGoogleConfig} = await import('../workers/site-router/maps-config.mjs');
  for (const headers of [{'Sec-Fetch-Site': 'cross-site'}, {Origin: 'https://evil.example'}, {Origin: 'null'}]) {
    const response = mapsGoogleConfig(new Request(endpoint, {headers}), {GOOGLE_MAPS_BROWSER_KEY: key});
    assert.equal(response.status, 403); assert(!(await response.text()).includes(key));
  }
  assert.equal(mapsGoogleConfig(new Request(endpoint, {headers: {Origin: 'https://maps.gregle.uk'}}), {GOOGLE_MAPS_BROWSER_KEY: key}).status, 200);
  assert.equal(mapsGoogleConfig(new Request(endpoint.replace('maps.gregle.uk', 'docs.gregle.uk')), {GOOGLE_MAPS_BROWSER_KEY: key}).status, 404);
  assert.equal(mapsGoogleConfig(new Request(endpoint, {method: 'POST'}), {GOOGLE_MAPS_BROWSER_KEY: key}).status, 405);
});

test('the router serves only the Maps config locally; every other host and asset keeps its existing origin', async () => {
  const worker = (await import('../workers/site-router/worker.mjs')).default;
  const saved = global.fetch, calls = [];
  global.fetch = async (...args) => {calls.push(args); return new Response('original origin');};
  try {
    const response = await worker.fetch(new Request(endpoint), {GOOGLE_MAPS_BROWSER_KEY: key});
    assert.equal((await response.json()).browserKey, key); assert.equal(calls.length, 0);
    assert.equal((await worker.fetch(new Request(endpoint.replace('https:', 'http:')))).status, 308);
    for (const host of ['cloud.gregle.uk', 'docs.gregle.uk', 'www.gregle.uk', 'gregle.uk']) {
      const request = new Request(`https://${host}/api/maps/google-config`);
      assert.equal(await (await worker.fetch(request)).text(), 'original origin'); assert.equal(calls.at(-1)[0], request);
    }
    assert.equal(await (await worker.fetch(new Request('https://maps.gregle.uk/assets/maps.js'))).text(), 'original origin');
    assert.equal(String(calls.at(-1)[0]), 'https://gregle.uk/assets/maps.js');
  } finally {global.fetch = saved;}
});
