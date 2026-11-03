const {test} = require('node:test');
const assert = require('node:assert/strict');
const worker = import('../workers/site-router-recovery/worker.mjs').then(m => m.default);

test('a killed Maps backend disables optional providers without breaking page startup', async () => {
  const router = await worker;
  const env = {MAPS_API: {fetch: async () => {throw Error('This script has been killed.');}}};
  for (const name of ['google', 'tomtom']) {
    const response = await router.fetch(new Request(`https://maps.gregle.uk/api/maps/${name}-config`), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {enabled: false, reason: 'temporarily_unavailable'});
  }
  const response = await router.fetch(new Request('https://maps.gregle.uk/api/maps/tomtom/route', {method: 'POST'}), env);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('killed'), false);
});

test('a recovered Maps backend receives the original request and returns its response', async () => {
  const request = new Request('https://maps.gregle.uk/api/maps/tomtom-config');
  const expected = Response.json({enabled: true});
  const response = await (await worker).fetch(request, {MAPS_API: {fetch: async r => {
    assert.equal(r, request);
    return expected;
  }}});
  assert.equal(response, expected);
});

test('workers.dev health requests cannot recursively fetch the same Worker', async () => {
  const response = await (await worker).fetch(new Request('https://gregle-site-router-recovery.example.workers.dev/'), {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Gregle app router ready');
});
