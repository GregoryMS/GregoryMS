const {test} = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/astro-core.js');
const W = require('../assets/weather-core.js');
const S = require('../assets/vendor/suncalc.js');
const fs = require('node:fs');
const vm = require('node:vm');
const now = Date.parse('2026-09-30T04:20:00Z');
const place = {latitude:49.28, longitude:-123.12};
function response() {
  const time = Array.from({length:72}, (_, i) => Date.parse('2026-09-30T00:00:00Z') / 1000 + i * 3600);
  return {timezone:'America/Vancouver', current:{time:now/1000, cloud_cover:0}, hourly:{time,
    ...Object.fromEntries(A.fields.map(key => [key, time.map(() => 10)]))}};
}
test('forecast uses epoch times, rounded coordinates and a full 48-hour window', () => {
  const url = new URL(A.forecastURL({latitude:49.28273, longitude:-123.12073}));
  assert.equal(url.searchParams.get('latitude'), '49.28');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  const parsed = A.parseForecast(response(), now);
  assert.equal(parsed.rows.length, 48);
  assert.equal(parsed.rows[0].time, Date.parse('2026-09-30T04:00:00Z'));
  assert.equal(parsed.rows.at(-1).time, Date.parse('2026-10-02T03:00:00Z'));
});
test('missing data stays unknown instead of becoming clear skies or no dew', () => {
  const data = response(); data.hourly.cloud_cover[4] = null; data.hourly.dew_point_2m[4] = null;
  const row = A.parseForecast(data, now).rows[0];
  assert.equal(row.cloud_cover, null); assert.equal(A.outlook(row, -25), 'Unknown');
  assert.equal(A.dewRisk(row.temperature_2m, row.dew_point_2m), 'Unknown');
  assert.equal(A.dewRisk(3, 2), 'High'); assert.equal(A.dewRisk(4, 1), 'Moderate'); assert.equal(A.dewRisk(10, 2), 'Low');
});
test('stale, malformed and misaligned forecasts fail explicitly', () => {
  const data = response(); data.current.time -= 3 * 3600;
  assert.equal(A.parseForecast(data, now).current, null);
  assert.throws(() => A.parseForecast(data, now + 7 * 24 * A.HOUR), /out of date/);
  data.hourly.cloud_cover.pop(); assert.throws(() => A.parseForecast(data, now), /Incomplete/);
  const duplicate = response(); duplicate.hourly.time[1] = duplicate.hourly.time[0];
  assert.throws(() => A.parseForecast(duplicate, now), /Invalid forecast times/);
  const badZone = response(); badZone.timezone = 'Unknown/Zone'; assert.throws(() => A.parseForecast(badZone, now));
});
test('outlook distinguishes darkness, twilight, weather limitations and unknown values', () => {
  const good = {cloud_cover:0, wind_speed_10m:0, precipitation_probability:0};
  assert.equal(A.outlook(good, 10), 'Daylight'); assert.equal(A.outlook(good, -10), 'Twilight');
  assert.equal(A.outlook(good, -20), 'Promising'); assert.equal(A.outlook({...good, cloud_cover:40}, -20), 'Mixed');
  assert.equal(A.outlook({...good, wind_speed_10m:35}, -20), 'Poor');
  assert.equal(A.outlook({...good, precipitation_probability:60}, -20), 'Poor');
  assert.equal(A.outlook({...good, cloud_cover:null}, -20), 'Unknown');
});
test('chart cycles cross UTC dates correctly and retain one validity time during fallback', () => {
  const charts = A.chartCandidates(place, 'seeing', 48, now);
  assert.equal(charts.length, 4);
  assert.match(charts[0].url, /2026093000_054_R1_north@america@astro_I_ASTRO_seeing_053\.png$/);
  assert.match(charts[1].url, /2026092918_054_R1_north@america@astro_I_ASTRO_seeing_059\.png$/);
  assert.equal(new Set(charts.map(c => c.valid)).size, 1);
  assert.ok(charts.every(c => c.lead <= 84 && c.run < now));
  assert.match(A.chartCandidates(place, 'cloud', 0, now)[0].url, /northwest_I_ASTRO_nt/);
  assert.match(A.chartCandidates(place, 'transparency', 0, now)[0].url, /astro_I_ASTRO_transp/);
});
test('unsupported regions and invalid input cannot generate misleading chart or map URLs', () => {
  assert.equal(A.chartRegion({latitude:51.5, longitude:-0.12}), null);
  assert.deepEqual(A.chartCandidates({latitude:-33.86, longitude:151.2}, 'seeing', 0, now), []);
  assert.deepEqual(A.chartCandidates(place, 'cloud', NaN, now), []);
  assert.throws(() => A.mapURL({latitude:91, longitude:0}));
  assert.throws(() => A.forecastURL({latitude:null, longitude:0}));
  const map = new URL(A.mapURL(place)); assert.equal(map.hostname, 'www.lightpollutionmap.info');
  assert.match(map.hash, /lat=49\.2800&lon=-123\.1200/);
});
test('location search handles no matches and does not accept invalid coordinates', () => {
  assert.deepEqual(W.searchLocations({}), []);
  assert.deepEqual(W.searchLocations({results:[{name:'Invalid', latitude:100, longitude:0, country_code:'CA'}]}), []);
});
test('astronomical darkness handles polar day and polar night without missing rise/set assumptions', () => {
  const summer = S.getPosition(new Date('2026-06-21T00:00:00Z'), 80, 0).altitude * 180 / Math.PI;
  const winter = S.getPosition(new Date('2026-12-21T12:00:00Z'), 89, 0).altitude * 180 / Math.PI;
  assert.ok(summer > 0); assert.ok(winter < -18);
});

function harness() {
  class El {
    constructor() { this.children=[]; this.listeners={}; this.dataset={}; this.value=''; this.checked=true; this.textContent=''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=children; this.textContent=''; }
    addEventListener(name, fn) { this.listeners[name]=fn; }
    fire(name) { return this.listeners[name]?.({preventDefault(){}}); }
  }
  const nodes=new Map(), get=id=>{if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id);};
  get('chart-kind').value='cloud'; get('chart-offset').value='0';
  const buttons=['vancouver','victoria','chilliwack'].map(name=>{const b=new El();b.dataset.place=name;return b;});
  const pending=[]; let geoSuccess;
  const document={getElementById:get,createElement:()=>new El(),querySelectorAll:()=>buttons,addEventListener(){},hidden:false};
  class FixedDate extends Date { static now(){return now;} }
  const context={window:{GregleAstro:A,GregleWeather:W,SunCalc:S},document,Date:FixedDate,Intl,URLSearchParams,AbortController,
    setTimeout,clearTimeout,setInterval(){},navigator:{geolocation:{getCurrentPosition(success){geoSuccess=success;}}},
    Image:class {set src(value){if(value)queueMicrotask(()=>this.onload?.());}},
    fetch:url=>new Promise((resolve,reject)=>pending.push({url,resolve:body=>resolve({ok:true,json:async()=>body}),reject}))};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/astro.js'),'utf8'),context);
  return {get,pending,buttons,geo:()=>geoSuccess,async flush(){await new Promise(resolve=>setImmediate(resolve));}};
}
test('a slow forecast cannot overwrite a newly selected location', async () => {
  const h=harness();
  h.buttons[1].fire('click');
  h.pending[1].resolve({...response(),current:{time:now/1000,cloud_cover:72}}); await h.flush();
  assert.equal(h.get('place-name').textContent,'Victoria');
  h.pending[0].resolve({...response(),current:{time:now/1000,cloud_cover:1}}); await h.flush();
  assert.equal(h.get('conditions').children[0].children[1].textContent,'72%');
});
test('search failure is recoverable and pending geolocation cannot override a shortcut', async () => {
  const h=harness(); h.pending[0].resolve(response()); await h.flush();
  h.get('location-query').value='London'; const search=h.get('location-form').fire('submit');
  h.pending[1].reject(Error('Offline')); await search;
  assert.match(h.get('search-status').textContent,/unavailable/);
  h.get('my-location').fire('click'); h.buttons[2].fire('click');
  h.geo()({coords:{latitude:1,longitude:2}});
  assert.equal(h.get('place-name').textContent,'Chilliwack');
  h.pending[2].resolve(response()); await h.flush();
});
test('failed location forecast clears old readings while keeping map and chart independent', async () => {
  const h=harness(); h.pending[0].resolve(response()); await h.flush();
  h.buttons[1].fire('click'); h.pending[1].reject(Error('Offline')); await h.flush();
  assert.match(h.get('forecast-status').textContent,/Forecast unavailable/);
  assert.equal(h.get('conditions').children[0].children[1].textContent,'—');
  assert.match(h.get('map-link').href,/48.4300/);
  assert.equal(h.get('chart-image').children.length,1);
});
