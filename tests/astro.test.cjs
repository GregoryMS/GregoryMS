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
test('chart directory validates coordinates, keys, colours and duplicates', () => {
  const record = ['WnrObAZ','Winer Observatory',31.665572,-110.601793,'Bortle 3 - Rural sky','#013EDC'];
  const data = {version:1,updated:'2026-09-30',sites:[record]};
  assert.equal(A.parseSites(data)[0].key, 'WnrObAZ');
  assert.throws(() => A.parseSites({...data,sites:[record,record]}));
  for (const [index, value] of [[0,'../../evil'],[2,91],[3,null],[5,'red;display:none']]) {
    const bad = [...record]; bad[index] = value;
    assert.throws(() => A.parseSites({...data,sites:[bad]}));
  }
});
test('site search and nearest-site matching use real catalog entries within 200 km', () => {
  const sites = A.parseSites(require('../data/astro-sites.json'));
  assert.ok(sites.length >= 5000);
  assert.equal(A.searchSites(sites,'Winer Observatory')[0].key,'WnrObAZ');
  assert.equal(A.searchSites(sites,'wnrobaz')[0].name,'Winer Observatory');
  assert.deepEqual(A.searchSites(sites,' '),[]);
  const nearby = A.nearbySites(sites,place);
  assert.equal(nearby.length,12); assert.ok(nearby[0].distance < 5);
  assert.ok(nearby.every((s,i) => s.distance <= 200 && (!i || s.distance >= nearby[i-1].distance)));
  assert.deepEqual(A.nearbySites(sites,{latitude:51.5,longitude:-0.12}),[]);
  assert.equal(A.chartURL({key:'WnrObAZ'},true),'https://test.cleardarksky.com/c/WnrObAZ/chart.gif');
  assert.equal(A.chartURL({key:'WnrObAZ'}),'https://test.cleardarksky.com/c/WnrObAZ.html');
  assert.throws(() => A.chartURL({key:'../invalid'}));
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

function harness(deferImages = false) {
  class El {
    constructor() { this.children=[]; this.listeners={}; this.dataset={}; this.value=''; this.checked=true; this.textContent=''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=children; this.textContent=''; }
    addEventListener(name, fn) { this.listeners[name]=fn; }
    fire(name) { return this.listeners[name]?.({preventDefault(){}}); }
  }
  const nodes=new Map(), get=id=>{if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id);};
  const buttons=['vancouver','victoria','chilliwack'].map(name=>{const b=new El();b.dataset.place=name;return b;});
  const pending=[], images=[]; let geoSuccess;
  const document={getElementById:get,createElement:()=>new El(),querySelectorAll:()=>buttons,addEventListener(){},hidden:false};
  class FixedDate extends Date { static now(){return now;} }
  const siteDirectory=A.parseSites(require('../data/astro-sites.json'));
  const browser={create({onChart}){return {setLocation(place){onChart(A.nearbySites(siteDirectory,place)[0] || null);}};}};
  const context={window:{GregleAstro:A,GregleWeather:W,SunCalc:S,GregleAstroSites:browser},document,Date:FixedDate,Intl,URLSearchParams,AbortController,
    setTimeout,clearTimeout,setInterval(){},navigator:{geolocation:{getCurrentPosition(success){geoSuccess=success;}}},
    Image:class {set src(value){if(value){images.push(this);if(!deferImages)queueMicrotask(()=>this.onload?.());}}},
    fetch:url=>new Promise((resolve,reject)=>pending.push({url,resolve:body=>resolve({ok:true,json:async()=>body}),reject}))};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/astro.js'),'utf8'),context);
  return {get,pending,buttons,images,geo:()=>geoSuccess,async flush(){await new Promise(resolve=>setImmediate(resolve));}};
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
  assert.match(h.get('chart-source').href,/test.cleardarksky.com/);
  assert.equal(h.get('chart-image').children.length,1);
});

test('late chart images cannot replace a newer site and failed images leave a useful fallback', async () => {
  const h=harness(true);
  h.pending[0].resolve(response()); await h.flush();
  h.buttons[1].fire('click'); h.pending[1].resolve(response());
  h.images[1].onload(); await h.flush();
  const selectedURL=h.get('chart-source').href;
  assert.match(h.get('chart-heading').textContent,/Victoria/);
  h.images[0].onload(); await h.flush();
  assert.equal(h.get('chart-image').children[0].href,selectedURL);
  h.buttons[2].fire('click'); h.pending[2].resolve(response()); h.images[2].onerror(); await h.flush();
  assert.equal(h.get('chart-image').children.length,0);
  assert.match(h.get('chart-status').textContent,/Chart image unavailable/);
  assert.match(h.get('chart-source').href,/test.cleardarksky.com/);
});
