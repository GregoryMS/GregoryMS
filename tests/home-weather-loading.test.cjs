const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/weather-core.js');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const source = html.slice(html.indexOf('    const DEFAULT_WEATHER_LOCATION'), html.indexOf('    let tickerPaused'));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const forecast = temperature => ({current:{temperature_2m:temperature, weather_code:0, is_day:1}, timezone:'UTC'});
function setup(cached = null, {blocked = false, geo = true} = {}) {
  const requests = [], writes = [], timers = new Map();
  let next = 0, locate, deny;
  const chip = {innerHTML:'', setAttribute() {}};
  const context = vm.createContext({URL, URLSearchParams, AbortController, Date,
    GregleWeather:core, weatherChip:chip,
    navigator:geo ? {geolocation:{getCurrentPosition(success, failure) {locate = success; deny = failure;}}} : {},
    localStorage:{getItem() {if (blocked) throw Error('blocked'); return JSON.stringify(cached);}, setItem(key, value) {if (blocked) throw Error('blocked'); writes.push(JSON.parse(value));}},
    setTimeout(fn, ms) {timers.set(++next, {fn, ms}); return next;}, clearTimeout(id) {timers.delete(id);},
    fetch(url, {signal}) {return new Promise((resolve, reject) => {
      requests.push({url:new URL(url), signal, resolve, reject});
      signal.addEventListener('abort', () => reject(Error('timeout')));
    });}
  });
  vm.runInContext(source, context);
  return {context, chip, requests, writes, timers,
    start:() => vm.runInContext('loadWeather()', context),
    locate:(latitude, longitude) => locate({coords:{latitude, longitude}}), deny:() => deny(Error('denied')),
    async respond(index, temperature) {requests[index].resolve({ok:true, json:async () => forecast(temperature)}); await flush();},
    async json(index, data) {requests[index].resolve({ok:true, json:async () => data}); await flush();}
  };
}
const cache = () => ({temperature:8, weatherCode:0, latitude:35.68, longitude:139.69, label:'Tokyo', country:'JP', timezone:'Asia/Tokyo', savedAt:Date.now()});

test('weather is requested and rendered while location permission is still pending', async () => {
  const h = setup(); h.start();
  assert.equal(h.requests.filter(r => r.url.hostname === 'api.open-meteo.com').length, 1);
  assert.equal(h.requests[0].url.searchParams.get('latitude'), '48.4284');
  await h.respond(0, 12);
  assert.match(h.chip.innerHTML, /12°C/);
  assert.equal(new URL(h.chip.href).searchParams.get('name'), 'Victoria');
});

test('cached weather paints immediately and refreshes without waiting for GPS', async () => {
  const h = setup(cache()); h.start();
  assert.match(h.chip.innerHTML, /8°C/);
  assert.equal(h.requests[0].url.searchParams.get('latitude'), '35.68');
  await h.respond(0, 9);
  assert.match(h.chip.innerHTML, /9°C/);
  assert.equal(new URL(h.chip.href).searchParams.get('name'), 'Tokyo');
});

test('detected local weather wins when the initial fallback responds last', async () => {
  const h = setup(); h.start(); h.locate(51.5, -0.12); await flush();
  assert.equal(h.requests.filter(r => r.url.hostname === 'api.open-meteo.com').length, 2);
  await h.respond(2, 4); await h.respond(0, 12);
  assert.match(h.chip.innerHTML, /4°C/);
  assert.equal(new URL(h.chip.href).searchParams.get('lat'), '51.5');
  assert.equal(h.writes.at(-1).latitude, 51.5);
});

test('fallback remains usable if detected-location weather fails', async () => {
  const h = setup(); h.start(); h.locate(51.5, -0.12); await flush();
  h.requests[2].reject(Error('offline')); h.requests[3].reject(Error('offline')); await flush(); await h.respond(0, 12);
  assert.match(h.chip.innerHTML, /12°C/);
});

test('nearby GPS fixes reuse the in-flight request instead of duplicating it', async () => {
  const h = setup(); const loading = h.start(); h.locate(48.4285, -123.3657);
  await h.respond(0, 12); await loading;
  assert.equal(h.requests.filter(r => r.url.hostname === 'api.open-meteo.com').length, 1);
});

test('network deadline preserves cached weather and does not start serial retries', async () => {
  const h = setup(cache()); const loading = h.start(); h.deny();
  assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0]; assert.equal(timer.ms, 6000); timer.fn();
  await loading;
  assert(h.requests[0].signal.aborted); assert.equal(h.requests.length, 1);
  assert.match(h.chip.innerHTML, /8°C/); assert.equal(h.timers.size, 0);
});

test('older refreshes cannot overwrite a newer successful refresh', async () => {
  const h = setup(); h.start(); h.start();
  await h.respond(2, 7); await h.respond(0, 12);
  assert.match(h.chip.innerHTML, /7°C/); assert.equal(h.writes.length, 1);
});

test('blocked storage and missing location access still load fallback weather', async () => {
  const h = setup(null, {blocked:true, geo:false}); const loading = h.start();
  await h.respond(0, 12); await loading;
  assert.match(h.chip.innerHTML, /12°C/);
});

test('the deadline also covers a stalled response body', async () => {
  const h = setup(null, {geo:false}); const loading = h.start();
  h.requests[0].resolve({ok:true, json:() => new Promise((resolve, reject) => h.requests[0].signal.addEventListener('abort', () => reject(Error('body timeout'))))});
  await flush(); assert.equal(h.timers.size, 1);
  [...h.timers.values()][0].fn(); await loading;
  assert.equal(h.timers.size, 0); assert.equal(h.requests.filter(r => r.url.hostname === 'api.open-meteo.com').length, 1);
});

const observed = (temperature = 11, timestamp = Date.now()) => ({properties:{currentConditions:{
  temperature:{value:{en:temperature}}, timestamp:{en:new Date(timestamp).toISOString()}, condition:{en:'Mostly Cloudy'}, iconCode:{value:30}
}}});

test('fresh Environment Canada weather renders while the model provider remains stalled', async () => {
  const h = setup(); h.start();
  assert.equal(h.requests[1].url.hostname, 'api.weather.gc.ca');
  await h.json(1, observed());
  assert.match(h.chip.innerHTML, /11°C/); assert.match(h.chip.title, /Environment Canada/);
  assert(h.requests[0].signal.aborted); assert.equal(h.timers.size, 0);
  assert.equal(h.writes.at(-1).country, 'CA'); assert.equal(h.writes.at(-1).details.condition, 'Mostly Cloudy');
});

test('a failed or stale Canadian observation does not prevent valid model weather', async () => {
  for (const data of [observed(11, Date.now() - 4 * 3600000), observed(null), {}]) {
    const h = setup(); h.start(); await h.json(1, data);
    assert.match(h.chip.innerHTML, /--°C/);
    await h.respond(0, 12); assert.match(h.chip.innerHTML, /12°C/);
  }
});

test('Canadian GPS locations outside Victoria use their own nearest station', async () => {
  const h = setup(); h.start(); h.locate(43.65, -79.38); await flush();
  await h.json(3, {countryCode:'CA'});
  await h.json(4, {features:[{geometry:{coordinates:[-79.38,43.65]}, properties:{identifier:'on-143',name:{en:'Toronto'}}}]});
  assert.match(h.requests[5].url.pathname, /on-143$/);
  await h.json(5, observed(5)); assert.match(h.chip.innerHTML, /5°C/);
  assert.equal(new URL(h.chip.href).searchParams.get('lat'), '43.65');
  await h.respond(0, 12); assert.match(h.chip.innerHTML, /5°C/);
});

test('restored official weather retains its condition, icon, and source', () => {
  const h = setup({...cache(), weatherCode:-1, details:{condition:'Mostly Cloudy',source:'Environment Canada'}});
  h.start(); assert.match(h.chip.title, /Environment Canada/);
  assert(h.chip.innerHTML.includes(core.weatherIcon('Mostly Cloudy', false)));
});
