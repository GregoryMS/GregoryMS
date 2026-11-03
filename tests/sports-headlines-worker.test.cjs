const {test} = require('node:test');
const assert = require('node:assert/strict');
const worker = import('../workers/site-router/worker.mjs').then(m=>m.default);
const endpoint = 'https://sports.gregle.uk/api/sports/headlines';

test('sports relay fetches only the fixed BBC feed with bounded caching and no visitor credentials', async t => {
  let options;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://feeds.bbci.co.uk/sport/rss.xml'); options=init;
    return new Response('<rss><channel/></rss>', {headers:{'Content-Type':'application/rss+xml','Set-Cookie':'ignore=1'}});
  });
  const response = await (await worker).fetch(new Request(endpoint+'?url=https://evil.test/', {headers:{Cookie:'private=1',Authorization:'secret'}}));
  assert.equal(response.status,200);
  assert.equal(await response.text(),'<rss><channel/></rss>');
  assert.equal(response.headers.get('Set-Cookie'),null);
  assert.equal(response.headers.get('Cache-Control'),'public, max-age=60');
  assert(!options.headers.Cookie && !options.headers.Authorization);
  assert.equal(options.redirect,'manual'); assert.equal(options.cf.cacheTtlByStatus['200-299'],300);
});

test('relay rejects provider errors, unexpected content, oversized feeds and timeouts', async t => {
  for (const reply of [
    () => new Response('Error',{status:500}),
    () => new Response('<html>Unavailable</html>',{headers:{'Content-Type':'text/html'}}),
    () => new Response('x'.repeat(500001),{headers:{'Content-Type':'text/xml'}}),
    () => {throw Error('Timeout');},
  ]) {
    const mock=t.mock.method(globalThis,'fetch',async()=>reply());
    const response=await (await worker).fetch(new Request(endpoint));
    assert.equal(response.status,503); assert.equal(response.headers.get('Cache-Control'),'no-store');
    mock.mock.restore();
  }
});

test('relay rejects writes, omits HEAD bodies, and leaves other hosts on their existing route', async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async url=>{calls++; return new Response(String(url),{headers:{'Content-Type':'text/xml'}});});
  const router=await worker;
  assert.equal((await router.fetch(new Request(endpoint,{method:'POST'}))).status,405); assert.equal(calls,0);
  const head=await router.fetch(new Request(endpoint,{method:'HEAD'})); assert.equal(head.status,200); assert.equal(await head.text(),'');
  const other=await router.fetch(new Request(endpoint.replace('sports.','weather.')));
  assert.equal(await other.text(),'https://gregle.uk/api/sports/headlines');
});
