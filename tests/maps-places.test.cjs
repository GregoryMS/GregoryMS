const { test } = require('node:test');
const assert = require('node:assert/strict');
const maps = require('../assets/maps-core.js');
const places = require('../assets/maps-places-core.js');
const point = { lat: 48.45, lng: -123.37, name: 'Dropped pin' };
const node = (id, tags, offset = 0) => ({ type: 'node', id, lat: point.lat + offset, lon: point.lng, tags });

test('Photon identities and copied links reopen the exact OSM element', () => {
  const data = { features: [{ geometry: { type: 'Point', coordinates: [point.lng, point.lat] }, properties: { name: 'Café & shop', osm_type: 'W', osm_id: 123 } }] };
  const result = maps.readResults(data)[0];
  assert.equal(result.osm, 'way/123');
  assert.equal(maps.readHash(maps.makeHash(maps.defaultView, result)).pin.osm, 'way/123');
  for (const [type, id] of [['way', 0], ['W', -1], ['node', '123);out;'], ['unknown', 1], ['node', 9007199254740992]]) assert.equal(maps.osmReference(type, id), null);
  assert.equal(maps.readHash('#pin=48,-123&osm=evil/123').pin.osm, undefined);
});

test('place queries are small explicit lookups and search IDs avoid nearby guesses', () => {
  assert.equal(places.query({ ...point, osm: 'way/123' }, 16), '[out:json][timeout:12][maxsize:8388608];way(123);out tags center;');
  const nearby = places.query(point, 16);
  assert(nearby.includes('is_in(48.45000,-123.37000)'));
  assert(nearby.includes('out body center geom 40'));
  assert(nearby.includes('around:32,'));
  assert(places.query(point, 13).includes('around:90,'));
  assert(places.query(point, 19).includes('around:18,'));
  assert.throws(() => places.query({ lat: NaN, lng: 1 }, 16));
});

test('place responses validate, deduplicate and retain tags as plain text', () => {
  const tags = { name: '<img src=x onerror=alert(1)>', phone: '+1 250 555 0123', opening_hours: 'Mo-Fr 09:00-17:00', invalid: null };
  const result = places.readPlaces({ elements: [null, node(1, tags), node(1, tags), node(2, {}), { ...node(3, tags), lat: 91 }] }, point);
  assert.equal(result.length, 1); assert.equal(result[0].name, tags.name); assert.equal(result[0].tags.invalid, undefined);
  assert.equal(result[0].tags.opening_hours, tags.opening_hours);
  assert.throws(() => places.readPlaces({ elements: [], remark: 'runtime error: timed out' }, point));
  assert.throws(() => places.readPlaces({}, point));
  assert.deepEqual(places.readPlaces({ elements: [] }, point), []);
  assert.equal(places.readPlaces({ elements: [node(1, tags), node(2, tags)] }, { ...point, osm: 'node/2' })[0].osm, 'node/2');
});

test('clicks inside a business prefer its geometry and nearest centre over a surrounding mall', () => {
  const ring = size => [[-size,-size],[-size,size],[size,size],[size,-size],[-size,-size]].map(([y,x]) => ({ lat: point.lat+y, lon: point.lng+x }));
  const mall = { type: 'way', id: 1, center: { lat: point.lat+.001, lon: point.lng }, geometry: ring(.003), tags: { shop: 'mall', name: 'Mall' } };
  const shop = { type: 'way', id: 2, center: { lat: point.lat, lon: point.lng }, geometry: ring(.0004), tags: { shop: 'supermarket', name: 'Shop' } };
  const results = places.readPlaces({ elements: [mall, shop, node(3, { shop: 'pet', name: 'Pet shop' }, .0001)] }, point);
  assert.equal(results[0].name, 'Shop'); assert.equal(results[0].distance, 0);
  assert.equal(results[1].name, 'Mall'); assert(results[2].distance > 10);
  const courtyard = { type: 'relation', id: 4, center: {lat:point.lat+.002,lon:point.lng}, members: [{ role:'outer',geometry:ring(.003) }, {role:'inner',geometry:ring(.001)}], tags:{leisure:'park',name:'Courtyard park'} };
  assert(places.readPlaces({elements:[courtyard]},point)[0].distance > 50, 'a hole in a polygon is not inside the place');
});

test('contact tags become safe actions and hours remain the recorded schedule', () => {
  const rows = places.facts({ 'contact:phone': '+1 (250) 555-0123', opening_hours: 'Mo-Sa 09:00-21:00; Su 10:00-19:00', 'contact:website': 'example.com/shop', 'contact:email': 'hello@example.com', wheelchair: 'limited' });
  assert.equal(rows.find(x => x.label === 'Phone').href, 'tel:+12505550123');
  assert.equal(rows.find(x => x.label === 'Hours').value, 'Mo-Sa 09:00-21:00; Su 10:00-19:00');
  assert.equal(rows.find(x => x.label === 'Website').href, 'https://example.com/shop');
  assert.equal(rows.find(x => x.label === 'Email').href, 'mailto:hello@example.com');
  assert.equal(rows.find(x => x.label === 'Wheelchair access').value, 'Limited');
  assert.equal(places.facts({ opening_hours: '24/7' })[0].value, 'Open 24 hours');
  assert.deepEqual(places.facts({}), []);
});

test('fallback lookups keep exact identities and reject distant reverse-geocoding matches', () => {
  const url = new URL(places.fallbackURL('https://nominatim.openstreetmap.org/', { ...point, osm: 'node/123' }));
  assert.equal(url.pathname, '/lookup'); assert.equal(url.searchParams.get('osm_ids'), 'N123');
  assert.equal(url.searchParams.get('extratags'), '1');
  const reverse = new URL(places.fallbackURL('https://nominatim.openstreetmap.org/', point));
  assert.equal(reverse.pathname, '/reverse'); assert.equal(reverse.searchParams.get('layer'), 'poi');
  const raw = { osm_type: 'node', osm_id: 123, lat: String(point.lat), lon: String(point.lng), name: 'Café', category: 'amenity', type: 'cafe', extratags: { phone: '+1 250 555 0123' }, address: { house_number: '10', road: 'Main Street' } };
  const result = places.readFallback(raw, point)[0];
  assert.equal(result.osm, 'node/123'); assert.equal(result.partial, true);
  assert.equal(result.tags.phone, raw.extratags.phone); assert.equal(result.tags['addr:street'], 'Main Street');
  assert.equal(places.readFallback({ ...raw, lat: '49' }, point).length, 0);
  assert.equal(places.readFallback([raw], { ...point, osm: 'node/999' }).length, 0);
  assert.deepEqual(places.readFallback({ error: 'Unable to geocode' }, point), []);
});

test('weekly hours list every day using 24-hour times and keep Sunday separate', () => {
  const schedule = places.readHours('Mo-Sa 09:00-21:00; Su 10:00-19:00');
  assert.equal(schedule.weekly, true);
  assert.deepEqual(schedule.days.map(day => day.day), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.deepEqual(schedule.days[0].times, ['09:00 – 21:00']);
  assert.deepEqual(schedule.days[5].times, ['09:00 – 21:00']);
  assert.deepEqual(schedule.days[6].times, ['10:00 – 19:00']);
  assert.equal(schedule.raw, 'Mo-Sa 09:00-21:00; Su 10:00-19:00');
});

test('split shifts, closed days, weekday lists and later overrides stay clear', () => {
  const schedule = places.readHours('Mo-Fr 08:00-12:00,13:30-17:00; We off; Sa,Su 10:00-14:00');
  assert.deepEqual(schedule.days[0].times, ['08:00 – 12:00', '13:30 – 17:00']);
  assert.deepEqual(schedule.days[2].times, ['Closed']);
  assert.equal(schedule.days[2].closed, true);
  assert.deepEqual(schedule.days[5].times, ['10:00 – 14:00']);
  assert.deepEqual(places.readHours('Mo-Fr 09:00-17:00').days[6].times, ['Closed']);
  assert.deepEqual(places.readHours('08:00-22:00').days[4].times, ['08:00 – 22:00']);
});

test('holidays and quoted instructions remain visible alongside daily hours', () => {
  const schedule = places.readHours('Mo-Fr 09:00-17:00 "Call first; appointments preferred"; PH off; SH 10:00-14:00');
  assert.equal(schedule.weekly, true);
  assert.deepEqual(schedule.days[0].times, ['09:00 – 17:00', 'Call first; appointments preferred']);
  assert.deepEqual(schedule.notes, [{label:'Public holidays',times:['Closed']},{label:'School holidays',times:['10:00 – 14:00']}]);
});

test('24-hour businesses, midnight and overnight shifts avoid ambiguous AM/PM labels', () => {
  for (const raw of ['24/7', '00:00-24:00']) assert(places.readHours(raw).days.every(day => day.times[0] === 'Open 24 hours'));
  assert.deepEqual(places.readHours('09:00-24:00').days[0].times, ['09:00 – 24:00']);
  const schedule = places.readHours('Fr-Mo 20:00-02:00');
  assert.deepEqual(schedule.days[4].times, ['20:00 – 02:00 (next day)']);
  assert.deepEqual(schedule.days[0].times, ['20:00 – 02:00 (next day)']);
  assert.deepEqual(schedule.days[2].times, ['Closed']);
  assert.deepEqual(places.readHours('Mo 20:00-26:00').days[0].times, ['20:00 – 02:00 (next day)']);
});

test('seasonal, solar and complex overnight schedules preserve their original conditions', () => {
  for (const raw of ['Jun-Aug Mo-Fr 09:00-17:00', 'Mo-Fr 09:00-17:00; Dec 25 off', 'sunrise-sunset', 'Mo[1] 10:00-14:00', 'Mo 20:00-26:00; Tu 20:00-24:00', 'Mo-Fr 09:00-17:00 || "By appointment"', 'Mo 99:00-12:00', 'Mo 09:90-12:00', 'Mo 00:00-48:00']) {
    const schedule = places.readHours(raw);
    assert.equal(schedule.weekly, false, raw); assert.equal(schedule.raw, raw); assert.deepEqual(schedule.days, []);
  }
});

test('unsafe external tag values cannot become executable or header-injecting links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'https://user:pass@example.com', 'https://example.com\\evil']) {
    assert.equal(places.safeLink('website', value), null, value);
  }
  assert.equal(places.safeLink('website', '//example.com'), 'https://example.com/');
  assert.equal(places.safeLink('website', 'https://example.com/\nattack'), null);
  assert.equal(places.safeLink('email', 'hello@example.com?subject=attack'), null);
  assert.equal(places.safeLink('phone', '+1 250 555; +1 250 666'), null);
  assert.equal(places.safeLink('phone', '+---'), null);
});
