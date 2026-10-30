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
