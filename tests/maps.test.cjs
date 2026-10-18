const { test } = require('node:test');
const assert = require('node:assert/strict');
const maps = require('../assets/maps-core.js');
const fs = require('node:fs');
const path = require('node:path');

test('map links preserve the view, pin and names containing URL characters', () => {
  const view = { lat: 48.4284, lng: -123.3656, zoom: 13 };
  const pin = { lat: 48.42, lng: -123.37, name: 'Harbour & park / café #1', detail: '' };
  assert.deepEqual(maps.readHash(maps.makeHash(view, pin)), { view, pin });
  const url = new URL(maps.osmURL(view, pin));
  assert.equal(url.origin, 'https://www.openstreetmap.org');
  assert.equal(url.searchParams.get('mlat'), '48.42000');
  assert.equal(url.searchParams.get('mlon'), '-123.37000');
  assert.equal(url.hash, '#map=13/48.42840/-123.36560');
});

test('invalid or empty coordinates cannot create a pin or unusable view', () => {
  for (const hash of ['', '#map=0/1/2', '#map=20/1/2', '#map=13/NaN/2', '#map=13/90/2', '#map=13/4/181', '#map=13//']) {
    assert.deepEqual(maps.readHash(hash).view, maps.defaultView, hash);
  }
  for (const hash of ['#pin=,', '#pin=1,', '#pin=,2', '#pin=91,0', '#pin=0,181', '#pin=1,2,3', '#pin=null,2']) assert.equal(maps.readHash(hash).pin, null, hash);
  assert.equal(maps.validPoint(null, 0), false);
  assert.equal(maps.validPoint('48', -123), false);
  assert.equal(maps.validPoint(Infinity, 0), false);
  assert.equal(maps.readHash('#map=2/0/0').view.lat, 0);
  assert.deepEqual(maps.readHash('#pin=0,0').pin, { lat: 0, lng: 0, name: 'Dropped pin', detail: '' });
});

test('panning around the world normalizes longitude and clamps map bounds', () => {
  assert.equal(maps.wrapLongitude(540), -180);
  assert.equal(maps.wrapLongitude(-541), 179);
  const state = maps.readHash(maps.makeHash({ lat: 89, lng: 541, zoom: 22 }));
  assert.equal(state.view.lat, 85.05113);
  assert.equal(state.view.lng, -179);
  assert.equal(state.view.zoom, 19);
});

const feature = (properties = {}, coordinates = [-123.3656, 48.4284]) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
test('Photon results validate coordinates, remove duplicates and provide useful address labels', () => {
  const city = feature({ name: 'Victoria', state: 'British Columbia', country: 'Canada', osm_value: 'city' });
  const address = feature({ housenumber: '675', street: 'Belleville Street', city: 'Victoria', country: 'Canada' });
  const results = maps.readResults({ features: [null, feature({}, [null, null]), feature({}, [0, 91]), { ...city, geometry: { type: 'Polygon', coordinates: [] } }, city, city, address] });
  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Victoria');
  assert.equal(results[0].zoom, 12);
  assert.equal(results[1].name, '675 Belleville Street');
  assert.equal(results[1].detail, 'Victoria, Canada');
  assert.equal(results[1].zoom, 16);
  assert.throws(() => maps.readResults({ error: 'Unavailable' }));
  assert.deepEqual(maps.readResults({ features: [] }), []);
});

test('results are bounded and external names remain plain text', () => {
  const features = Array.from({ length: 12 }, (_, i) => feature({ name: '<img src=x onerror=alert(1)> ' + i }, [i, i]));
  const results = maps.readResults({ features });
  assert.equal(results.length, 6);
  assert.equal(results[0].name, '<img src=x onerror=alert(1)> 0');
  assert(maps.makeHash(maps.defaultView, results[0]).includes('%3Cimg'));
});

test('nearby searches include Victoria suburbs while excluding distant same-name places', () => {
  const area = maps.searchArea(maps.defaultView, [-123.49, 48.38, -123.24, 48.48]);
  const results = maps.readResults({ features: [
    feature({ name: 'Walmart', city: 'Sequim' }, [-123.1344, 48.0788]),
    feature({ name: 'Walmart', city: 'Victoria' }, [-123.3363, 48.4472]),
    feature({ name: 'Walmart', city: 'Langford' }, [-123.5055, 48.444]),
    feature({ name: 'Walmart', city: 'Florida' }, [-80.2, 25.8])
  ] }, area);
  assert.deepEqual(results.map(result => result.detail), ['Victoria', 'Langford']);
  const tiny = maps.searchArea({ ...maps.defaultView, zoom: 19 }, [-123.366,48.428,-123.365,48.429]);
  assert(tiny.east - tiny.west > .3); assert(tiny.north - tiny.south > .25);
});

test('search URLs carry the current area and separate region caches from worldwide results', () => {
  const endpoint = 'https://photon.komoot.io/api/';
  const victoria = maps.searchArea(maps.defaultView, [-123.49,48.38,-123.24,48.48]);
  const vancouver = maps.searchArea({ lat: 49.28, lng: -123.12, zoom: 13 }, [-123.25,49.23,-123,49.33]);
  const local = new URL(maps.searchURL(endpoint, 'Walmart & groceries', victoria));
  assert.equal(local.searchParams.get('q'), 'Walmart & groceries');
  assert.equal(local.searchParams.get('lat'), String(victoria.lat));
  assert.equal(local.searchParams.get('lon'), String(victoria.lng));
  assert.equal(local.searchParams.get('zoom'), '13');
  assert.equal(local.searchParams.get('bbox'), [victoria.west,victoria.south,victoria.east,victoria.north].join(','));
  assert.notEqual(local.href, maps.searchURL(endpoint, 'Walmart & groceries', vancouver));
  const worldwide = new URL(maps.searchURL(local.href, 'Paris'));
  for (const key of ['lat','lon','zoom','bbox','location_bias_scale']) assert.equal(worldwide.searchParams.has(key), false, key);
  assert.equal(worldwide.searchParams.get('limit'), '6');
});

test('area filtering checks all candidates before capping the results and handles the dateline', () => {
  const area = maps.searchArea({ lat: 0, lng: 179.8, zoom: 13 }, [179.5,-.1,180.1,.1]);
  const data = { features: [
    ...Array.from({ length: 8 }, (_, i) => feature({ name: 'Far away ' + i }, [i,0])),
    feature({ name: 'Across the dateline' }, [-179.99,0]),
    feature({ name: 'Same side' }, [179.9,0])
  ] };
  assert.deepEqual(maps.readResults(data, area).map(result => result.name), ['Across the dateline', 'Same side']);
  const url = new URL(maps.searchURL('https://photon.komoot.io/api/', 'shop', area));
  assert.equal(url.searchParams.has('bbox'), false); assert.equal(url.searchParams.get('lon'), '179.8');
  assert.deepEqual(maps.searchArea({ lat: 0, lng: 539.8, zoom: 13 }, [539.5,-.1,540.1,.1]), area);
  const polar = maps.searchArea({ lat: 85, lng: 0, zoom: 2 }, [-200,-85,200,90]);
  assert(polar.west >= -180 && polar.east <= 180 && polar.south >= -90 && polar.north <= 90);
  assert.throws(() => maps.searchArea({ lat: NaN, lng: 0 }));
});

test('map uses attributable HTTPS tiles and a search provider configurable independently of the page', () => {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'assets/maps-config.json')));
  assert.equal(config.tileURL, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(new URL(config.searchURL).protocol, 'https:');
  const script = fs.readFileSync(path.join(root, 'assets/maps.js'), 'utf8') + fs.readFileSync(path.join(root, 'assets/maps-layers.js'), 'utf8');
  assert(script.includes('https://www.openstreetmap.org/copyright'));
  assert(!script.includes('nominatim.openstreetmap.org'));
  const page = fs.readFileSync(path.join(root, 'maps.html'), 'utf8');
  assert(page.includes('strict-origin-when-cross-origin'));
  assert(page.includes('https://www.openstreetmap.org/fixthemap'));
  assert(page.includes('<noscript>'));
});

test('map links preserve layer choices without serializing credentials or arbitrary providers', () => {
  const layers = { base: 'topographic', maritime: true, drivebc: true, traffic: true, google: true, apiKey: 'must-not-be-shared', tileURL: 'https://example.org' };
  const pin = { lat: 48.42, lng: -123.37, name: 'Harbour & park' };
  const hash = maps.makeHash(maps.defaultView, pin, layers);
  assert.deepEqual(maps.readLayers(hash), { base: 'topographic', maritime: true, drivebc: true, traffic: true, google: true });
  assert.equal(maps.readHash(hash).pin.name, pin.name);
  assert(!hash.includes('must-not-be-shared'));
  assert(!hash.includes('example.org'));
  assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView, null, { base: 'street' })), { base: 'street', maritime: false, drivebc: false, traffic: false, google: false });
  assert.equal(maps.readLayers('#map=13/48/-123'), null);
});

test('saved and linked layer preferences ignore invalid types and unknown overlays', () => {
  assert.deepEqual(maps.normalizeLayers(null), { base: 'street', maritime: false, drivebc: false, traffic: false, google: false });
  assert.deepEqual(maps.normalizeLayers({ base: 'javascript:alert(1)', maritime: 'true', traffic: 1, google: 'true' }), { base: 'street', maritime: false, drivebc: false, traffic: false, google: false });
  assert.deepEqual(maps.readLayers('#base=unknown&overlays=maritime,drivebc,other,traffic'), { base: 'street', maritime: true, drivebc: true, traffic: true, google: false });
  assert.deepEqual(maps.readLayers('#base=street&overlays='), { base: 'street', maritime: false, drivebc: false, traffic: false, google: false });
});

test('Google traffic is opt-in and copied Google layer links keep other layers and the pin', () => {
  assert.equal(maps.normalizeLayers({ base: 'street', traffic: true }).google, false);
  const layers = maps.readLayers('#map=13/48.42840/-123.36560&base=topographic&overlays=google,drivebc');
  assert.deepEqual(layers, { base: 'topographic', maritime: false, drivebc: true, traffic: false, google: true });
  const pin = { lat: 48.42, lng: -123.37, name: 'Harbour & park' };
  const hash = maps.makeHash(maps.defaultView, pin, layers);
  assert.deepEqual(maps.readLayers(hash), layers);
  assert.equal(maps.readHash(hash).pin.name, pin.name);
  assert.equal(maps.readLayers(hash.replace('drivebc,google', 'drivebc')).google, false);
});

test('DriveBC events validate geometry, deduplicate IDs and keep report text separate from markup', () => {
  const event = { id: 'drivebc.ca/test', status: 'ACTIVE', headline: '<img onerror=alert(1)>', description: '<script>not markup</script>', event_type: 'CONSTRUCTION', severity: 'MAJOR', roads: [{ state: 'CLOSED' }], updated: '2026-10-17T12:00:00-07:00', geography: { type: 'Point', coordinates: [-123.36, 48.43] } };
  const results = maps.readRoadEvents({ events: [null, {}, { ...event, id: '' }, { ...event, id: 'archived', status: 'ARCHIVED' }, { ...event, id: 'invalid', geography: { type: 'Point', coordinates: [null, null] } }, event, event] });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, event.headline);
  assert.equal(results[0].description, event.description);
  assert.deepEqual(results[0].point, [48.43, -123.36]);
  assert.equal(results[0].closed, true);
  assert.equal(results[0].severity, 'MAJOR');
  assert.throws(() => maps.readRoadEvents({ error: 'Unavailable' }));
  assert.deepEqual(maps.readRoadEvents({ events: [] }), []);
});

test('DriveBC supports legacy points and samples long road geometries while retaining both endpoints', () => {
  const event = { id: 'road', status: 'ACTIVE', event_type: 'UNKNOWN', severity: 'n/a', updated: 'invalid' };
  const coords = Array.from({ length: 1601 }, (_, i) => [-123 + i / 100000, 49 + i / 100000]);
  const results = maps.readRoadEvents({ events: [{ ...event, geography: { type: 'LineString', coordinates: coords } }, { ...event, id: 'point', geography: { type: 'Point', coordinates: [[-124, 50]] } }] });
  assert.equal(results.length, 2);
  assert.equal(results[0].coordinates.length, 800);
  assert.deepEqual(results[0].coordinates[0], [49, -123]);
  assert.deepEqual(results[0].coordinates.at(-1), [coords.at(-1)[1], coords.at(-1)[0]]);
  assert.equal(results[0].type, 'ROAD_CONDITION');
  assert.equal(results[0].severity, 'UNKNOWN');
  assert.equal(results[0].updated, null);
  assert.deepEqual(results[1].point, [50, -124]);
});
