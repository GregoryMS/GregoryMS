const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const scripts = file => [...fs.readFileSync(path.join(root, file), 'utf8')
  .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).join('\n');
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = data => ({ ok: true, json: async () => data });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Minimal DOM and Leaflet doubles keep these regressions runnable without packages or network access.
function element(tag = 'div') {
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(), value: '', textContent: '', innerHTML: '', children: [],
    style: { setProperty() {} }, classList: {
      toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains: name => classes.has(name)
    },
    listeners: {}, attributes: {}, disabled: false,
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    querySelectorAll: () => [], focus() {}, contains: () => false
  };
}

function environment(file, fetch = () => new Promise(() => {}), storage = {}) {
  const nodes = {};
  const get = id => nodes[id] ||= element();
  const ready = {};
  const timers = new Map();
  let timerId = 0;
  const map = { handlers: {}, setView() { return this; }, removeLayer() {}, fitBounds() {},
    on(name, callback) { this.handlers[name] = callback; } };
  const markers = [];
  const layer = () => ({ addTo() { return this; }, bindPopup(content) { this.popup = content; return this; }, getBounds: () => [] });
  const document = { getElementById: get, createElement: element,
    querySelector: get, querySelectorAll: () => [], body: element(), documentElement: element(), head: element(),
    addEventListener(name, callback) { ready[name] = callback; } };
  const context = vm.createContext({ document, console, URL, AbortController,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }, setInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {}, ...storage },
    navigator: { geolocation: { getCurrentPosition() {} } },
    matchMedia: () => ({ matches: false }), addEventListener() {}, fetch,
    L: { map: () => map, tileLayer: layer, geoJSON: layer, marker() { const m = layer(); markers.push(m); return m; } }
  });
  context.window = context;
  Object.entries({ fuelPrice: '1.85', currency: '$', consumptionMode: 'lPer100', consumptionValue: '8.5', distance: '100' })
    .forEach(([id, value]) => { get(id).value = value; });
  vm.runInContext(scripts(file), context, { filename: file });
  return { context, get, ready, map, markers, timers };
}

const click = (env, lat, lng) => env.map.handlers.click({ latlng: { lat, lng } });
const routeResponse = (distance = 1500) => response({ routes: [{ distance, geometry: {} }] });

test('all inline scripts parse', () => {
  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
    new vm.Script(scripts(file), { filename: file });
  }
});

test('ticker escapes headline markup and rejects executable link protocols', () => {
  const { context } = environment('index.html');
  context.items = [
    { title: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)' },
    { title: 'Safe & sound', link: 'https://example.com/?q=" onclick="alert(1)' },
    { title: 'Data URL', link: 'data:text/html,test' }
  ];
  const markup = vm.runInContext('makeTickerMarkup(items)', context);
  assert(!markup.includes('<img'));
  assert(markup.includes('&lt;img'));
  assert(!markup.includes('javascript:'));
  assert(!markup.includes('data:text/html'));
  assert(!markup.includes(' onclick="'));
  assert(markup.includes('Safe &amp; sound'));
});

test('map routing preserves coordinates even when both points have the same address', async () => {
  const urls = [];
  const env = environment('petrol.html', async url => {
    urls.push(url);
    return url.includes('/reverse') ? response({ display_name: 'Same Road' }) : routeResponse();
  });
  click(env, 48.41, -123.31);
  await flush();
  await click(env, 48.42, -123.32);
  assert(urls.some(url => url.includes('/driving/-123.31,48.41;-123.32,48.42?')));
  assert(!urls.some(url => url.includes('/search')));
  assert.equal(env.get('distance').value, '1.5');
  assert.equal(env.get('tripCost').textContent, '$0.24');
});

test('rapid clicks route immediately while reverse lookups are pending', async () => {
  const lookups = [];
  const env = environment('petrol.html', url => {
    if (!url.includes('/reverse')) return Promise.resolve(routeResponse());
    const pending = deferred(); lookups.push(pending); return pending.promise;
  });
  click(env, 1, 2);
  await click(env, 3, 4);
  assert.equal(env.get('endLocation').value, '3.00000, 4.00000');
  assert.equal(env.get('distance').value, '1.5');
  lookups[1].resolve(response({ display_name: 'End' }));
  lookups[0].resolve(response({ display_name: 'Start' }));
  await flush();
  assert.equal(env.get('startLocation').value, 'Start');
  assert.equal(env.get('endLocation').value, 'End');
});

test('failed reverse lookups do not prevent routing', async () => {
  const env = environment('petrol.html', async url => {
    if (url.includes('/reverse')) throw new Error('Unavailable');
    return routeResponse();
  });
  click(env, 1, 2);
  await click(env, 3, 4);
  assert.equal(env.get('distance').value, '1.5');
});

test('clearing the route ignores pending route and address responses', async () => {
  const route = deferred(), reverse = deferred();
  const env = environment('petrol.html', url => url.includes('/reverse') ? reverse.promise : route.promise);
  click(env, 1, 2);
  const calculation = click(env, 3, 4);
  await flush();
  env.get('clearRouteButton').listeners.click();
  route.resolve(routeResponse(99000));
  reverse.resolve(response({ display_name: 'Stale address' }));
  await calculation;
  await flush();
  assert.equal(env.get('startLocation').value, '');
  assert.equal(env.get('endLocation').value, '');
  assert.equal(env.get('distance').value, '100');
  assert.match(env.get('statusBox').textContent, /^Route cleared/);
  assert.equal(env.get('routeButton').disabled, false);
});

test('starting another route ignores old reverse-geocoding responses', async () => {
  const lookups = [];
  const env = environment('petrol.html', url => {
    if (!url.includes('/reverse')) return Promise.resolve(routeResponse());
    const pending = deferred(); lookups.push(pending); return pending.promise;
  });
  click(env, 1, 2);
  await click(env, 3, 4);
  click(env, 5, 6);
  lookups[0].resolve(response({ display_name: 'Old start' }));
  lookups[1].resolve(response({ display_name: 'Old end' }));
  await flush();
  assert.equal(env.get('startLocation').value, '5.00000, 6.00000');
  assert.equal(env.get('endLocation').value, '');
  lookups[2].resolve(response({ display_name: 'New start' }));
  await flush();
  assert.equal(env.get('startLocation').value, 'New start');
});

test('editing a selected location geocodes the new text', async () => {
  const urls = [];
  const env = environment('petrol.html', async url => {
    urls.push(url);
    if (url.includes('/reverse')) return response({ display_name: 'Old place' });
    if (url.includes('/search')) return response([{ lat: '5', lon: '6', display_name: 'New place' }]);
    return routeResponse();
  });
  click(env, 1, 2); await click(env, 3, 4);
  env.get('startLocation').value = 'New place';
  env.get('startLocation').listeners.input();
  await env.get('routeButton').listeners.click();
  assert(urls.some(url => url.includes('/search?') && url.endsWith('q=New%20place')));
  assert(urls.some(url => url.includes('/driving/6,5;4,3?')));
});

test('route error messages and marker popups treat markup as text', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const env = environment('petrol.html', async () => response([]));
  env.get('startLocation').value = payload;
  env.get('endLocation').value = 'Victoria';
  await env.get('routeButton').listeners.click();
  assert(env.get('statusBox').textContent.includes(payload));
  assert.equal(env.get('statusBox').innerHTML, '');
  env.context.label = payload;
  vm.runInContext('setStartPoint(1, 2, label)', env.context);
  assert.equal(env.markers.at(-1).popup.textContent, payload);
  assert.equal(env.markers.at(-1).popup.innerHTML, '');
});

test('xkcd keeps and searches the full archive when caching throws', async () => {
  let downloads = 0;
  const env = environment('xkcd.html', async () => {
    downloads++;
    return { ok: true, text: async () => Array.from({ length: 1001 }, (_, i) => `<a href="/${i + 1}/">Comic ${i + 1}</a>`).join('') };
  }, { setItem() { throw new Error('Quota exceeded'); } });
  env.ready.DOMContentLoaded();
  await flush();
  assert.equal(downloads, 1);
  assert.match(env.get('status').textContent, /Loaded 1001 comics/);
  env.get('q').value = 'Comic 1001';
  env.get('search').onclick();
  assert.match(env.get('results').innerHTML, /#1001/);
});

test('Victoria loads official forecast data and renders it as text', async () => {
  let requested;
  const env = environment('Victoria_weather.html', async url => {
    requested = url;
    return response({ properties: { forecastGroup: { timestamp: { en: '2026-09-08T23:00:00Z' },
      forecasts: [{ period: { textForecastName: { en: 'Tonight' } }, textSummary: { en: '<img src=x> Clear. Low 12.' } }] } } });
  });
  await flush();
  assert.equal(requested, 'https://api.weather.gc.ca/collections/citypageweather-realtime/items/bc-85?f=json');
  const [card] = env.get('forecast').children;
  assert.equal(card.children[0].textContent, 'Tonight');
  assert.equal(card.children[1].textContent, '<img src=x> Clear. Low 12.');
  assert.equal(card.children[1].innerHTML, '');
  assert.match(env.get('status').textContent, /^Forecast issued/);
});

test('Victoria shows a useful fallback for network or missing forecast failures', async () => {
  for (const fetch of [async () => { throw new Error('Offline'); }, async () => response({})]) {
    const env = environment('Victoria_weather.html', fetch);
    await flush();
    assert.match(env.get('status').textContent, /temporarily unavailable.*official forecast link/);
  }
  const html = fs.readFileSync(path.join(root, 'Victoria_weather.html'), 'utf8');
  assert(html.includes('href="https://weather.gc.ca/en/location/'));
  assert(!html.includes('weather.json'));
});

function vancouverWeather() {
  return { properties: {
    currentConditions: {
      condition: { en: '<img src=x> Clear' }, temperature: { value: { en: 0 } },
      station: { value: { en: "Vancouver Int'l Airport" } },
      timestamp: { en: '2026-09-09T04:00:00Z' },
      relativeHumidity: { value: { en: 80 } },
      wind: { direction: { value: { en: 'W' } }, speed: { value: { en: 5 } } }
    },
    forecastGroup: { timestamp: { en: '2026-09-08T23:00:00Z' },
      forecasts: [{ period: { textForecastName: { en: 'Tonight' }, value: { en: 'Tuesday night' } }, textSummary: { en: '<img src=x> Low 13.' },
        abbreviatedForecast: { textSummary: { en: 'Clear' } }, temperatures: { temperature: [{ class: { en: 'low' }, value: { en: 13 } }] } }] }
  } };
}

test('Vancouver loads current conditions and forecasts directly and safely', async () => {
  let requested;
  const env = environment('environment-canada.html', async url => { requested = url; return response(vancouverWeather()); });
  await flush();
  assert.equal(requested, 'https://api.weather.gc.ca/collections/citypageweather-realtime/items/bc-74?f=json');
  assert.equal(env.get('temperature').textContent, '0°C');
  assert.equal(env.get('condition').textContent, '<img src=x> Clear');
  assert.equal(env.get('condition').innerHTML, '');
  assert.match(env.get('currentDetails').textContent, /Vancouver.*Sep/);
  assert.equal(env.get('humidity').textContent, '80%');
  assert.equal(env.get('wind').textContent, 'W 5 km/h');
  const [card] = env.get('forecastGrid').children;
  assert.equal(card.children[0].textContent, 'Tonight');
  assert.match(card.children[1].innerHTML, /^<svg/);
  const copy = card.children[4].children[1].children[1];
  assert.equal(copy.textContent, '<img src=x> Low 13.');
  assert.equal(copy.innerHTML, '');
  assert.equal(env.get('currentHigh').textContent, '—');
  assert.equal(env.get('currentLow').textContent, '13°');
  assert.match(env.get('updated').textContent, /^Forecast issued/);
  assert.equal(env.get('weatherFallback').style.display, 'none');
  assert.equal(env.timers.size, 0);
});

test('Vancouver keeps the forecast available if observations are missing', async () => {
  const data = vancouverWeather();
  delete data.properties.currentConditions;
  const env = environment('environment-canada.html', async () => response(data));
  await flush();
  assert.equal(env.get('temperature').textContent, '--°C');
  assert.equal(env.get('condition').textContent, 'Unavailable');
  assert.equal(env.get('forecastGrid').children.length, 1);
});

test('Vancouver recovers with retry after HTTP or malformed forecast failures', async () => {
  for (const badResponse of [{ ok: false }, response({}), response({ properties: { forecastGroup: { forecasts: [] } } })]) {
    let fail = true;
    const env = environment('environment-canada.html', async () => fail ? badResponse : response(vancouverWeather()));
    await flush();
    assert.match(env.get('status').textContent, /temporarily unavailable/);
    assert.equal(env.get('weatherFallback').style.display, 'block');
    assert.equal(env.get('retryWeather').disabled, false);
    fail = false;
    await env.get('retryWeather').listeners.click();
    assert.equal(env.get('weatherFallback').style.display, 'none');
    assert.equal(env.get('forecastGrid').children.length, 1);
    assert.equal(env.get('retryWeather').disabled, false);
  }
  const html = fs.readFileSync(path.join(root, 'environment-canada.html'), 'utf8');
  assert(!/rss2json|allorigins|wxlink|<iframe/.test(html));
  assert(html.includes('href="https://weather.gc.ca/en/location/'));
});

test('Vancouver aborts a stalled request and offers retry', async () => {
  const env = environment('environment-canada.html', (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Timed out')));
  }));
  assert.equal(env.get('retryWeather').disabled, true);
  [...env.timers.values()][0]();
  await flush();
  assert.equal(env.get('weatherFallback').style.display, 'block');
  assert.equal(env.get('retryWeather').disabled, false);
  assert.match(env.get('status').textContent, /temporarily unavailable/);
  assert.equal(env.timers.size, 0);
});

test('daily forecasts pair a daytime high with that night’s low', () => {
  const env = environment('environment-canada.html');
  const period = (name, type, value) => ({ period:{ value:{en:name}, textForecastName:{en:name} },
    temperatures:{ temperature:[{class:{en:type},value:{en:value}}] },
    abbreviatedForecast:{textSummary:{en:'Sunny'}}, textSummary:{en:name} });
  env.context.forecasts = [period('Tuesday night','low',-2), period('Wednesday','high',0), period('Wednesday night','low',-5), period('Thursday','high',4)];
  const days = vm.runInContext('forecastDays(forecasts,"2026-09-08T23:00:00Z")',env.context);
  assert.equal(days.length,3);
  assert.equal(days[0].high,null);
  assert.equal(days[0].low,-2);
  assert.equal(days[1].high,0);
  assert.equal(days[1].low,-5);
  assert.equal(days[1].periods.length,2);
  assert.equal(days[2].low,null);
  assert.equal(vm.runInContext('degrees(0)',env.context),'0°');
  assert.equal(vm.runInContext('degrees(null)',env.context),'—');
});

test('icons distinguish common conditions and night without accepting remote markup', () => {
  const env = environment('environment-canada.html');
  const samples = [['Sunny',false,'sun'],['Clear',true,'moon'],['Partly cloudy',true,'partly-night'],['Chance of showers',false,'rain'],['Snow',false,'snow'],['Rain and snow',false,'sleet'],['Thunderstorms',false,'storm'],['Fog patches',false,'fog']];
  for (const [condition,night,expected] of samples) {
    env.context.sample = {condition,night};
    assert.equal(vm.runInContext('iconKind(sample.condition,sample.night)',env.context),expected);
  }
  assert(!vm.runInContext('weatherIcon("<img src=x onerror=alert(1)>")',env.context).includes('<img'));
});

test('all three city choices use the right endpoint and official forecast link', async () => {
  const urls = [];
  const env = environment('environment-canada.html',async url => { urls.push(url); return response(vancouverWeather()); });
  await flush();
  for (const [city,id,coords] of [['victoria','bc-85','48.43,-123.36'],['chilliwack','bc-24','49.17,-121.94'],['vancouver','bc-74','49.24,-123.12']]) {
    env.context.city = city;
    await vm.runInContext('selectCity(city)',env.context);
    assert(urls.at(-1).includes(`/items/${id}?`));
    assert.equal(env.get('officialLink').href, 'https://weather.gc.ca/en/location/index.html?coords='+encodeURIComponent(coords));
    assert.equal(env.get('cityName').textContent.toLowerCase(),city);
  }
});

test('switching cities aborts the old request and ignores its late response', async () => {
  const requests=[];
  const env = environment('environment-canada.html',(url,options) => {const pending=deferred(); requests.push({url,signal:options.signal,...pending});return pending.promise;});
  const next=vm.runInContext('selectCity("victoria")',env.context);
  assert.equal(requests[0].signal.aborted,true);
  assert.equal(env.get('cityName').textContent,'Victoria');
  assert.equal(env.get('temperature').textContent,'--°C');
  const victoria=vancouverWeather(); victoria.properties.currentConditions.temperature.value.en=22;
  requests[1].resolve(response(victoria)); await next;
  requests[0].resolve(response(vancouverWeather())); await flush();
  assert.equal(env.get('temperature').textContent,'22°C');
  assert.match(env.get('status').textContent,/^Victoria weather loaded/);
  assert.equal(env.get('weatherContent').attributes['aria-busy'],'false');
});

test('saved city and Gregle theme are restored and storage failure is harmless', async () => {
  const env=environment('environment-canada.html',async () => response(vancouverWeather()),{
    getItem:key => key==='gregle-weather-city' ? 'chilliwack' : 'dark',
    setItem(){throw new Error('Storage blocked');}
  });
  await flush();
  assert.equal(env.get('cityName').textContent,'Chilliwack');
  assert.equal(env.context.document.documentElement.classList.contains('dark-mode'),true);
  env.get('themeToggle').listeners.click();
  assert.equal(env.context.document.documentElement.classList.contains('dark-mode'),false);
  const invalid=environment('environment-canada.html',async () => response(vancouverWeather()),{getItem:()=> 'not-a-city'});
  await flush();
  assert.equal(invalid.get('cityName').textContent,'Vancouver');
});
