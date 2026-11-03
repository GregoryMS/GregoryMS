const {test} = require('node:test');
const assert = require('node:assert/strict');
const worker = import('../workers/site-router-recovery/worker.mjs').then(m => m.default);

test('missing provider secrets disable optional providers without breaking page startup', async () => {
  const router = await worker;
  const env = {};
  for (const name of ['google', 'tomtom']) {
    const response = await router.fetch(new Request(`https://maps.gregle.uk/api/maps/${name}-config`), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {enabled: false, reason: 'temporarily_unavailable'});
  }
  const response = await router.fetch(new Request('https://maps.gregle.uk/api/maps/tomtom/route', {method: 'POST'}), env);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('killed'), false);
});

test('workers.dev health requests cannot recursively fetch the same Worker', async () => {
  const response = await (await worker).fetch(new Request('https://gregle-site-router-recovery.example.workers.dev/'), {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Gregle app router ready');
});

test('provider secrets enable local Maps configuration with origin validation', async () => {
  const router = await worker;
  const env = {GOOGLE_MAPS_BROWSER_KEY: 'test_google_browser_key_12345', TOMTOM_API_KEY: 'test_tomtom_private_key_12345'};
  const google = await router.fetch(new Request('https://maps.gregle.uk/api/maps/google-config'), env);
  assert.deepEqual(await google.json(), {enabled: true, browserKey: env.GOOGLE_MAPS_BROWSER_KEY});
  const tomtom = await router.fetch(new Request('https://maps.gregle.uk/api/maps/tomtom-config'), env);
  assert.deepEqual(await tomtom.json(), {enabled: true});
  const forbidden = await router.fetch(new Request('https://maps.gregle.uk/api/maps/google-config', {headers: {Origin: 'https://example.com'}}), env);
  assert.equal(forbidden.status, 403);
});
