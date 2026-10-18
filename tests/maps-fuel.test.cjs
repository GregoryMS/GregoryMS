const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const core = require('../assets/maps-fuel-core.js'), maps = require('../assets/maps-core.js');
const now = Date.parse('2026-10-18T20:00:00Z');
const html = fs.readFileSync(__dirname + '/fixtures/canada-daily-fuel.html', 'utf8');
const box = [-123.4, 48.4, -123.3, 48.5];
test('daily source parser reads pump columns rather than tax or margin columns and retains all markets and the actual report date', async () => {
  const {parseSurvey} = await import('../workers/ev/fuel-prices.mjs');
  const data = parseSurvey(html, now), report = core.read(data, now);
  assert.equal(data.markets.length, 77); assert.equal(data.date, '2026-10-16');
  assert.deepEqual(report.markets.find(m => m.name === 'Victoria').prices, {regular: 198.9, midgrade: 217.8, premium: 225.8, diesel: 288.3});
  assert(report.markets.some(m => m.name === 'Montréal')); assert(report.markets.some(m => m.name === 'Québec City'));
  assert.equal(core.format(198.9), '$1.989'); assert.equal(core.format(0), 'Unavailable');
});
test('changed, empty, old or future reports fail closed, and a retrieval date cannot make an old price current', async () => {
  const {parseSurvey} = await import('../workers/ev/fuel-prices.mjs');
  for (const bad of ['', html.replace('October 16, 2026', 'October 19, 2026'), html.replace('October 16, 2026', 'October 1, 2026'), html.replace('Regular/Ordinaire', 'Price category changed')]) assert.throws(() => parseSurvey(bad, now));
  const data = parseSurvey(html, now);
  assert.throws(() => core.read({...data, date: '2026-10-01', fetchedAt: now}, now));
  assert.throws(() => core.read({...data, date: '2026-10-19'}, now));
  assert.equal(core.age('2026-02-30', now), Infinity);
  assert.equal(core.age('2026-10-16', now), 2);
  assert.equal(core.today(Date.parse('2026-10-19T00:30:00Z')), '2026-10-18');
});
test('nearest city follows the visible area without extrapolating distant cities or silently changing fuel grades', async () => {
  const {parseSurvey} = await import('../workers/ev/fuel-prices.mjs'), data = core.read(parseSurvey(html, now), now);
  assert.equal(core.select(data.markets, {lat: 48.43, lng: -123.36}, box, 'regular').name, 'Victoria');
  const vancouver = [-123.3, 49.1, -123, 49.4];
  assert.equal(core.select(data.markets, {lat: 49.28, lng: -123.12}, vancouver, 'diesel').name, 'Vancouver');
  assert.equal(core.select(data.markets, {lat: 51, lng: -127}, [-127.1, 50.9, -126.9, 51.1], 'regular'), null);
  assert.equal(core.select([{...data.markets[0], prices: {regular: 100, diesel: null}}], data.markets[0], [-180, 0, 0, 90], 'diesel'), null);
});
test('OSM fuel points have validated coordinates and identities, and never inherit city prices', () => {
  const node = {type: 'node', id: 12, lat: 48.43, lon: -123.36, tags: {amenity: 'fuel', name: '<img onerror=alert(1)>', opening_hours: '24/7'}};
  const points = core.stations({elements: [node, node, {...node, id: 13, lat: 0}, {...node, id: 14, tags: {amenity: 'charging_station'}}]}, box);
  assert.equal(points.length, 1); assert.equal(points[0].id, 'node/12'); assert.equal(points[0].name, node.tags.name); assert(!Object.hasOwn(points[0], 'prices'));
  assert.throws(() => core.stations({}, box));
});
test('fuel layer and grade survive copied links and invalid grades are ignored', () => {
  const state = maps.normalizeLayers({fuel: true, fuelType: 'diesel'}), hash = maps.makeHash(maps.defaultView, null, state);
  assert(hash.includes('fueltype=diesel')); assert.deepEqual(maps.readLayers(hash), state);
  assert.equal(maps.normalizeLayers(null).fuel, false);
  assert.equal(maps.readLayers('#base=street&overlays=fuel&fueltype=unknown').fuelType, 'regular');
});
test('station coverage includes city views at zoom 10 and saved areas validate their age, location and fields', () => {
  assert(core.stationArea(box, 10)); assert.equal(core.stationArea(box, 9), null);
  assert.equal(core.stationArea([-180, -80, 180, 80], 10), null);
  const data = {area: box, fetchedAt: now, elements: [{type: 'node', id: 1, lat: 48.43, lon: -123.36, tags: {amenity: 'fuel', name: 'Shell', private: 'omit'}}]};
  const saved = core.stationCache(data, now);
  assert.equal(saved.elements[0].tags.name, 'Shell'); assert(!Object.hasOwn(saved.elements[0].tags, 'private'));
  assert(core.covers(saved.area, [-123.39,48.41,-123.31,48.49])); assert(!core.covers(saved.area, [-123.5,48.41,-123.31,48.49]));
  for (const bad of [{...data, fetchedAt: now + 1}, {...data, fetchedAt: now - 7 * 86400000}, {...data, area: [-180,-80,180,80]}, {...data, elements: [{type: 'node', id: 1, lat: 0, lon: 0, tags: {amenity: 'fuel'}}]}]) assert.throws(() => core.stationCache(bad, now));
});
test('fuel gateway shares one dated daily report, uses no OCM credentials, and refuses arbitrary queries and origins', async () => {
  const worker = (await import('../workers/ev/worker.mjs')).default;
  const saved = {fetch: global.fetch, caches: global.caches, now: Date.now}, store = new Map(), calls = [];
  Date.now = () => now;
  global.caches = {default: {match: async key => store.get(key.url)?.clone(), put: async (key, value) => store.set(key.url, value.clone())}};
  global.fetch = async (url, options) => { calls.push({url, ...options}); return new Response(html); };
  const request = (path = '/fuel-prices', origin = 'https://gregle.uk') => worker.fetch(new Request('https://worker.test' + path, {headers: {Origin: origin}}), {OCM_API_KEY: 'private-secret'}, {waitUntil() {}});
  try {
    const first = await (await request()).json(); assert.equal(first.date, '2026-10-16');
    assert.equal((await request()).status, 200); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, core.sourceURL); assert(!JSON.stringify(calls).includes('private-secret'));
    assert.equal((await request('/fuel-prices?url=https://evil.example')).status, 400);
    assert.equal((await request('/fuel-prices', 'https://evil.example')).status, 403); assert.equal(calls.length, 1);
    for (const [key, value] of store) { const stale = await value.json(); stale.fetchedAt -= 1800001; store.set(key, new Response(JSON.stringify(stale))); }
    global.fetch = async () => { throw Error('offline'); };
    const retained = await (await request()).json(); assert.equal(retained.date, first.date); assert.equal(retained.delayed, true);
  } finally { global.fetch = saved.fetch; global.caches = saved.caches; Date.now = saved.now; }
});
test('petrol relay reuses bounded Overpass fetching with distinct caches and filters out EV chargers', async () => {
  const worker = (await import('../workers/ev/worker.mjs')).default;
  const saved = {fetch: global.fetch, caches: global.caches}, store = new Map(), calls = [];
  global.caches = {default: {match: async key => store.get(key.url)?.clone(), put: async (key, value) => store.set(key.url, value.clone())}};
  global.fetch = async (url, options) => { calls.push({url, ...options}); return new Response(JSON.stringify({osm3s: {timestamp_osm_base: new Date().toISOString()}, elements: [{type: 'node', id: 1, lat: 48.43, lon: -123.36, tags: {amenity: 'fuel', 'fuel:diesel': 'yes', name: 'Petrol station'}}, {type: 'node', id: 2, lat: 48.43, lon: -123.36, tags: {amenity: 'charging_station'}}]})); };
  const request = path => worker.fetch(new Request('https://worker.test' + path, {headers: {Origin: 'https://gregle.uk'}}), {OCM_API_KEY: 'private-secret'}, {waitUntil() {}});
  try {
    const data = await (await request('/fuel-stations?bbox=' + box.join(','))).json();
    assert.equal(data.elements.length, 1); assert.equal(data.elements[0].tags['fuel:diesel'], 'yes');
    assert.equal(calls[0].method, 'GET'); assert(!calls[0].body); assert(new URL(calls[0].url).searchParams.get('data').includes('amenity=fuel')); assert(new URL(calls[0].url).searchParams.get('data').includes('[timeout:20]')); assert(!JSON.stringify(calls).includes('private-secret'));
    assert([...store.keys()].some(key => key.includes('/fuel-v1/'))); assert(![...store.keys()].some(key => key.includes('/ev-v1/')));
    assert.equal((await request('/fuel-stations?bbox=' + box.join(',') + '&scope=tesla')).status, 400);
  } finally { Object.assign(global, saved); }
});
