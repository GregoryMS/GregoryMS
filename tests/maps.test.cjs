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

test('map uses attributable HTTPS tiles and a search provider configurable independently of the page', () => {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'assets/maps-config.json')));
  assert.equal(config.tileURL, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(new URL(config.searchURL).protocol, 'https:');
  const script = fs.readFileSync(path.join(root, 'assets/maps.js'), 'utf8');
  assert(script.includes('https://www.openstreetmap.org/copyright'));
  assert(!script.includes('nominatim.openstreetmap.org'));
  const page = fs.readFileSync(path.join(root, 'maps.html'), 'utf8');
  assert(page.includes('strict-origin-when-cross-origin'));
  assert(page.includes('https://www.openstreetmap.org/fixthemap'));
  assert(page.includes('<noscript>'));
});
