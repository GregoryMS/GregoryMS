const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/astro-space-weather-core.js');
const now = Date.parse('2026-10-30T13:40:00Z');
const time_tag = '2026-10-30T13:38:00';

test('NOAA timestamps without an offset are UTC, not the browser time zone', () => {
  assert.equal(C.timestamp(time_tag), Date.parse(time_tag + 'Z'));
  assert.equal(C.timestamp(time_tag + 'Z'), Date.parse(time_tag + 'Z'));
  assert.ok(Number.isNaN(C.timestamp(null)));
});

test('observations select the latest valid primary spacecraft in either feed order', () => {
  const good = {time_tag, active:true, overall_quality:0, proton_speed:338, proton_density:4.1};
  const data = [
    {...good, time_tag:'2026-10-30T13:39:00', active:false, proton_speed:800},
    {...good, time_tag:'2026-10-30T13:39:00', overall_quality:1},
    {...good, time_tag:'2026-10-30T13:39:00', proton_density:null},
    {...good, time_tag:'2026-10-29T13:39:00'}, good
  ];
  assert.equal(C.wind(data, now).proton_speed, 338);
  assert.equal(C.wind(data.reverse(), now).time, Date.parse(time_tag + 'Z'));
  assert.equal(C.magnetic([{...good, bz_gsm:-4.9}], now).bz_gsm, -4.9);
  assert.throws(() => C.magnetic([{...good, bz_gsm:-9999}], now));
});

test('missing, expired and future observations cannot become current zero readings', () => {
  assert.throws(() => C.kp([{time_tag, estimated_kp:null}], now));
  assert.throws(() => C.kp([{time_tag:'2026-10-30T12:00:00', estimated_kp:2}], now));
  assert.throws(() => C.kp([{time_tag:'2026-10-31T13:40:00', estimated_kp:2}], now));
  assert.equal(C.kp([{time_tag, estimated_kp:0}], now).estimated_kp, 0);
});

test('outlook excludes observations and expired intervals and groups remaining UTC days', () => {
  const data = Array.from({length:24}, (_, i) => ({time_tag:new Date(Date.parse('2026-10-30T12:00:00Z') + i * 3 * 3600000).toISOString(), kp:i === 5 ? 5 : 2, observed:i < 4 ? 'estimated' : 'predicted'}));
  data.push({time_tag:'2026-10-30T09:00:00', kp:9, observed:'observed'});
  const result = C.forecast(data.reverse(), now);
  assert.equal(result.rows[0].time, Date.parse('2026-10-30T12:00:00Z'));
  assert.equal(result.days.length, 3);
  assert.equal(result.days[1].date, '2026-10-31');
  assert.equal(result.days[1].peak, 5);
  assert.throws(() => C.forecast(data, now + 96 * 3600000));
  assert.throws(() => C.forecast([{time_tag, kp:8, observed:'observed'}], now));
});

test('fractional Kp storm categories match NOAA thirds', () => {
  assert.match(C.activity(4.67), /^G1/);
  assert.match(C.activity(7.67), /^G4/);
  assert.match(C.activity(8.67), /^G4/);
  assert.match(C.activity(9), /^G5/);
});

const solarData = (...rows) => ':Product: Daily Solar Data            DSD.txt\n' + rows.join('\n');
const solarRow = '2026 10 30   90     36      100      1    -999      *   0  0  0  1  0  0  0';

test('daily sunspot numbers use the SESC column, retain zero and select the newest UTC date', () => {
  const yesterday = solarRow.replace('10 30', '10 29').replace('    36', '    22');
  const result = C.sunspots(solarData(solarRow, yesterday), now);
  assert.equal(result.number, 36);
  assert.equal(result.time, Date.parse('2026-10-30T00:00:00Z'));
  assert.equal(C.sunspots(solarData(solarRow.replace('    36', '     0')), now).number, 0);
});

test('blank and invalid sunspot readings never turn the following area field into a count', () => {
  for (const value of ['      ', '  -999', '   3.6', '  1001']) {
    const row = solarRow.slice(0, 16) + value + solarRow.slice(22);
    assert.throws(() => C.sunspots(solarData(row), now));
  }
  assert.throws(() => C.sunspots('<html>NOAA unavailable</html>', now));
});

test('daily sunspot observations reject future, impossible and expired dates', () => {
  for (const date of ['2026 10 31', '2026 10 26', '2026 02 30']) {
    assert.throws(() => C.sunspots(solarData(date + solarRow.slice(10)), now));
  }
  const missing = solarRow.slice(0, 16) + '      ' + solarRow.slice(22);
  const previous = solarRow.replace('10 30', '10 29');
  assert.equal(C.sunspots(solarData(previous, missing), now).time, Date.parse('2026-10-29T00:00:00Z'));
});

function sunHarness(text = solarData(solarRow)) {
  const fs = require('node:fs'), vm = require('node:vm');
  const nodes = new Map(), requests = [];
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {textContent:'', hidden:false, complete:false, listeners:{}, addEventListener(name, fn) { this.listeners[name] = fn; }, replaceChildren() {}});
    return nodes.get(id);
  };
  const document = {getElementById:get, hidden:false, addEventListener(){}, createElement:() => ({})};
  class FixedDate extends Date { static now() { return now; } }
  let fail = false, interval;
  const context = {document, window:{GregleSpaceWeatherCore:{...C, sunspots:value => C.sunspots(value, now)}}, Date:FixedDate, Intl, AbortController, setTimeout, clearTimeout,
    setInterval(fn) { interval = fn; }, fetch:async url => {
      requests.push(url);
      return {ok:!fail, text:async () => text, json:async () => []};
    }};
  vm.runInNewContext(fs.readFileSync('assets/astro-space-weather.js', 'utf8'), context);
  return {get, requests, interval:() => interval(), fail() { fail = true; }};
}

test('solar number loads independently, and failed manual refresh clears it while retrying both images', async () => {
  const h = sunHarness();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.get('sw-sunspots').textContent, '36');
  assert.match(h.get('sw-sunspots-detail').textContent, /30 Oct 2026 \(UTC\)/);
  assert.equal(h.get('sw-kp').textContent, '—');
  h.get('sunspots-image').onload();
  h.get('coronal-holes-image').onerror();
  assert.equal(h.get('sunspots-image').hidden, false);
  assert.equal(h.get('coronal-holes-image').hidden, true);
  assert.equal(h.get('coronal-holes-image-fallback').hidden, false);
  const before = h.requests.length;
  h.interval();
  assert.equal(h.requests.length, before);
  h.fail();
  await h.get('space-weather-refresh').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.get('sw-sunspots').textContent, '—');
  assert.match(h.get('sw-sunspots-detail').textContent, /unavailable/);
  assert.match(h.get('sunspots-image').src, /latest_1024_HMIIC.jpg\?v=/);
  assert.match(h.get('coronal-holes-image').src, /latest_1024_0193.jpg\?v=/);
  assert.equal(h.get('coronal-holes-image-fallback').hidden, true);
});
