const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('../assets/site-routes.json');
const root = path.join(__dirname, '..');

async function router(run, fetcher = async () => new Response('origin')) {
  const saved = global.fetch;
  const worker = (await import('../workers/site-router/worker.mjs')).default;
  const calls = [];
  global.fetch = async (...args) => { calls.push(args); return fetcher(...args); };
  try { await run(worker, calls); } finally { global.fetch = saved; }
}

test('every subdomain root serves the corresponding existing page, preserving query strings', async () => {
  await router(async (worker, calls) => {
    for (const [page, host] of Object.entries(routes)) {
      if (page === 'index.html') continue;
      const response = await worker.fetch(new Request(`https://${host}/?lat=48.43&name=Victoria`));
      assert.equal(response.status, 200);
      assert.equal(String(calls.at(-1)[0]), `https://gregle.uk/${page}?lat=48.43&name=Victoria`);
      assert.equal(response.headers.get('Link'), `<https://${host}/>; rel="canonical"`);
    }
  });
});

test('shared assets and live snapshots stream with correct paths and conditional request headers', async () => {
  await router(async (worker, calls) => {
    for (const file of ['/assets/maps.js?v=1', '/assets/maps-app/icon-192.png', '/data/bbc-news.json']) {
      const response = await worker.fetch(new Request('https://maps.gregle.uk' + file, {headers: {
        'If-None-Match': 'snapshot-1', Cookie: 'private=value', Authorization: 'Bearer private',
      }}));
      assert.equal(await response.text(), 'snapshot');
      const [url, options] = calls.at(-1);
      assert.equal(String(url), 'https://gregle.uk' + file);
      assert.equal(options.headers.get('If-None-Match'), 'snapshot-1');
      assert.equal(options.headers.get('Cookie'), null);
      assert.equal(options.headers.get('Authorization'), null);
      assert.equal(options.redirect, 'manual');
    }
  }, async () => new Response('snapshot', {headers: {'Content-Type': 'application/json'}}));
});

test('existing Cloud, Docs, www and apex keep their original request and origin', async () => {
  await router(async (worker, calls) => {
    for (const host of ['cloud.gregle.uk', 'docs.gregle.uk', 'www.gregle.uk', 'gregle.uk']) {
      const request = new Request(`https://${host}/login?next=files`, {method: 'POST', body: 'existing-form'});
      assert.equal((await worker.fetch(request)).status, 200);
      assert.equal(calls.at(-1)[0], request);
      assert.equal(calls.at(-1).length, 1);
    }
  });
});

test('legacy links on a subdomain route to their app and preserve query strings', async () => {
  await router(async (worker, calls) => {
    for (const [url, destination] of [
      ['https://maps.gregle.uk/weather.html?lat=0&lon=0', 'https://weather.gregle.uk/?lat=0&lon=0'],
      ['https://maps.gregle.uk/maps.html?view=street', 'https://maps.gregle.uk/?view=street'],
      ['https://weather.gregle.uk/index.html', 'https://gregle.uk/'],
      ['https://maps.gregle.uk/environment-canada.html?lat=48', 'https://weather.gregle.uk/?lat=48'],
      ['http://maps.gregle.uk/assets/maps.js?v=2', 'https://maps.gregle.uk/assets/maps.js?v=2'],
    ]) {
      const response = await worker.fetch(new Request(url));
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('Location'), destination);
    }
    assert.equal(calls.length, 0);
  });
});

test('installed apps launch at the new origin root with local icons, while source manifests retain legacy IDs', async () => {
  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.webmanifest'))) {
    const original = fs.readFileSync(path.join(root, file), 'utf8');
    const host = routes[file.replace('.webmanifest', '.html')];
    await router(async worker => {
      const response = await worker.fetch(new Request(`https://${host}/${file}`));
      const manifest = await response.json();
      assert.equal(manifest.id, '/');
      assert.equal(manifest.start_url, '/');
      assert.equal(manifest.scope, '/');
      for (const icon of manifest.icons) assert(fs.existsSync(path.join(root, new URL(icon.src, `https://${host}`).pathname)));
      assert.equal(response.headers.get('ETag'), null);
      assert.equal(response.headers.get('Content-Encoding'), null);
    }, async () => new Response(original, {headers: {'ETag': 'old', 'Content-Encoding': 'gzip'}}));
    assert.equal(JSON.parse(original).start_url, '/' + file.replace('.webmanifest', '.html'));
  }
});

test('HEAD, errors and missing resources keep their status; invalid manifests and origin failures are recoverable', async () => {
  await router(async (worker, calls) => {
    const response = await worker.fetch(new Request('https://maps.gregle.uk/', {method: 'HEAD'}));
    assert.equal(calls[0][1].method, 'HEAD'); assert.equal(response.body, null);
    const invalid = await worker.fetch(new Request('https://maps.gregle.uk/', {method: 'POST', body: 'data'}));
    assert.equal(invalid.status, 405); assert.equal(calls.length, 1);
  }, async () => new Response(null));
  await router(async worker => assert.equal((await worker.fetch(new Request('https://weather.gregle.uk/missing.png'))).status, 404), async () => new Response('Missing', {status: 404}));
  for (const body of ['{invalid', 'x'.repeat(17000)]) {
    await router(async worker => assert.equal((await worker.fetch(new Request('https://weather.gregle.uk/weather.webmanifest'))).status, 502), async () => new Response(body));
  }
  await router(async worker => assert.equal((await worker.fetch(new Request('https://weather.gregle.uk/'))).status, 502), async () => {throw Error('offline');});
});

test('every content page has a unique destination and all its local HTML resources exist at the new root', () => {
  const hosts = new Set(Object.values(routes));
  assert.equal(hosts.size, Object.keys(routes).length);
  for (const [page, host] of Object.entries(routes)) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    assert(source.includes(`rel="canonical" href="https://${host}/"`), page);
    const markup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    for (const [, reference] of markup.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      const url = new URL(reference.replaceAll('&amp;', '&'), `https://${host}/`);
      if (url.origin !== `https://${host}` || url.pathname === '/') continue;
      assert(fs.existsSync(path.join(root, decodeURIComponent(url.pathname))), `${page}: ${reference}`);
    }
  }
});

test('all map services accept only the additional Maps origin and reject deceptive hostnames', async () => {
  for (const [name, endpoint] of [
    ['aircraft/worker', '/aircraft'], ['aviation/worker', '/tiles/9/81/177.png'],
    ['drivebc/worker', '/messages'], ['ev/worker', '/charging'],
    ['ev/osm', '/charging'], ['ev/fuel-prices', '/fuel-prices'], ['vessels/worker', '/vessels'],
  ]) {
    const worker = (await import(`../workers/${name}.mjs`)).default;
    const allowed = await worker.fetch(new Request('https://service.test' + endpoint, {method: 'OPTIONS', headers: {Origin: 'https://maps.gregle.uk'}}), {}, {});
    assert.equal(allowed.status, name === 'ev/fuel-prices' ? 405 : 204, name);
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://maps.gregle.uk', name);
    for (const origin of ['https://maps.gregle.uk.evil.example', 'https://evil.gregle.uk', 'null']) {
      assert.equal((await worker.fetch(new Request('https://service.test' + endpoint, {method: 'OPTIONS', headers: {Origin: origin}}), {}, {})).status, 403, name);
    }
  }
});
