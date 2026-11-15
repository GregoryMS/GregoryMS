const {test} = require('node:test');
const assert = require('node:assert/strict');
const request = (query='latitude=48.43&longitude=-123.37', init) => new Request('https://astro.gregle.uk/api/astro/forecast?' + query, init);
test('forecast relay fixes upstream parameters and omits visitor credentials', async () => {
  const {astroForecast} = await import('../workers/site-router/astro-forecast.mjs');
  let call;
  const response = await astroForecast(request(undefined,{headers:{Cookie:'private',Authorization:'Bearer private'}}), async (url,options) => {
    call={url:new URL(url),options}; return Response.json({current:{cloud_cover:0}});
  });
  assert.equal(response.status,200); assert.equal((await response.json()).current.cloud_cover,0);
  assert.equal(call.url.hostname,'api.open-meteo.com');
  assert.equal(call.url.searchParams.get('forecast_days'),'4');
  assert.equal(call.url.searchParams.get('wind_speed_unit'),'kmh');
  assert.deepEqual(call.options.headers,{Accept:'application/json'});
  assert.equal(call.options.redirect,'manual');
});
test('forecast relay rejects invalid and arbitrary queries without fetching', async () => {
  const {astroForecast} = await import('../workers/site-router/astro-forecast.mjs');
  for (const query of ['', 'latitude=&longitude=0','latitude=91&longitude=0','latitude=0&longitude=-181',
    'latitude=0&latitude=1&longitude=0','latitude=0&longitude=0&url=https://evil.test']) {
    assert.equal((await astroForecast(request(query),()=>assert.fail('Unexpected fetch'))).status,400);
  }
  assert.equal((await astroForecast(request(undefined,{method:'POST'}))).status,405);
});
test('forecast relay bounds failures, redirects, content types and body size', async () => {
  const {astroForecast} = await import('../workers/site-router/astro-forecast.mjs');
  for (const fetcher of [async()=>{throw Error('offline');},async()=>new Response(null,{status:302}),
    async()=>new Response('<html>Error</html>'),async()=>new Response('x'.repeat(300001),{headers:{'Content-Type':'application/json'}})]) {
    const response = await astroForecast(request(),fetcher);
    assert.equal(response.status,503); assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  assert.equal((await astroForecast(request(undefined,{method:'HEAD'}),async()=>Response.json({}))).body,null);
});
