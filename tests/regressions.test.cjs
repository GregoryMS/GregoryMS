const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const scripts = (file, isolateTides = false) => [...fs.readFileSync(path.join(root, file), 'utf8')
  .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => {
    const src = match[0].match(/src="(assets\/[^"?]+\.js)(?:\?[^"]*)?"/);
    // Map controllers are exercised in their dedicated suites.
    if (isolateTides && /assets\/weather-(?:radar|map-layers)\.js$/.test(src?.[1] || "")) return "";
    // Weather regressions isolate the independent tide service; tides.test.cjs covers the real integration.
    if (isolateTides && src?.[1] === 'assets/tide-data.js') return 'globalThis.GregleTideData={load:()=>new Promise(()=>{})};';
    return src ? fs.readFileSync(path.join(root, src[1]), 'utf8') : match[1];
  }).join('\n');
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
    removeAttribute(name) { delete this.attributes[name]; },
    scrollIntoView() {},
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    querySelectorAll: () => [], focus() {}, select() {}, remove() {}, contains: () => false
  };
}

function environment(file, fetch = () => new Promise(() => {}), storage = {}, overrides = {}) {
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
  if (file === 'ev.html') Object.entries({ electricityPrice: '0.30', currency: '$', consumptionMode: 'kwh100',
    consumptionValue: '18', distance: '100', distanceUnit: 'km', journeyType: '1', chargingEfficiency: '90' })
    .forEach(([id, value]) => { get(id).value = value; });
  Object.assign(context, overrides);
  vm.runInContext(scripts(file, true), context, { filename: file });
  return { context, get, ready, map, markers, timers };
}

const click = (env, lat, lng) => env.map.handlers.click({ latlng: { lat, lng } });
const routeResponse = (distance = 1500) => response({ routes: [{ distance, geometry: {} }] });

test('all page scripts parse', () => {
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
  env.context.fetch = async () => response({ display_name: payload });
  click(env, 1, 2);
  await flush();
  assert.equal(env.markers.at(-1).popup.textContent, payload);
  assert.equal(env.markers.at(-1).popup.innerHTML, '');
});

test('xkcd keeps and searches the full archive when caching throws', async () => {
  let downloads = 0;
  const env = environment('xkcd.html', async () => {
    downloads++;
    return archiveResponse('Comic');
  }, { setItem() { throw new Error('Quota exceeded'); } });
  env.ready.DOMContentLoaded();
  await flush();
  assert.equal(downloads, 1);
  assert.match(env.get('status').textContent, /1,001 comics/);
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
  const env = environment('weather.html', async url => { requested = url; return response(vancouverWeather()); });
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
  const env = environment('weather.html', async () => response(data));
  await flush();
  assert.equal(env.get('temperature').textContent, '--°C');
  assert.equal(env.get('condition').textContent, 'Unavailable');
  assert.equal(env.get('forecastGrid').children.length, 1);
});

test('Vancouver recovers with retry after HTTP or malformed forecast failures', async () => {
  for (const badResponse of [{ ok: false }, response({}), response({ properties: { forecastGroup: { forecasts: [] } } })]) {
    let fail = true;
    const env = environment('weather.html', async () => fail ? badResponse : response(vancouverWeather()));
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
  const html = fs.readFileSync(path.join(root, 'weather.html'), 'utf8');
  assert(!/rss2json|allorigins|wxlink|<iframe/.test(html));
  assert(html.includes('href="https://weather.gc.ca/en/location/'));
});

test('Vancouver aborts a stalled request and offers retry', async () => {
  const env = environment('weather.html', (url, options) => new Promise((resolve, reject) => {
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
  const env = environment('weather.html');
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
  const env = environment('weather.html');
  const samples = [['Sunny',false,'sun'],['Clear',true,'moon'],['Partly cloudy',true,'partly-night'],['Chance of showers',false,'rain'],['Snow',false,'snow'],['Rain and snow',false,'sleet'],['Thunderstorms',false,'storm'],['Fog patches',false,'fog']];
  for (const [condition,night,expected] of samples) {
    env.context.sample = {condition,night};
    assert.equal(vm.runInContext('iconKind(sample.condition,sample.night)',env.context),expected);
  }
  assert(!vm.runInContext('weatherIcon("<img src=x onerror=alert(1)>")',env.context).includes('<img'));
});

test('all three city choices use the right endpoint and official forecast link', async () => {
  const urls = [];
  const env = environment('weather.html',async url => { urls.push(url); return response(vancouverWeather()); });
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
  const env = environment('weather.html',(url,options) => {const pending=deferred(); requests.push({url,signal:options.signal,...pending});return pending.promise;});
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
  const env=environment('weather.html',async () => response(vancouverWeather()),{
    getItem:key => key==='gregle-weather-city' ? 'chilliwack' : 'dark',
    setItem(){throw new Error('Storage blocked');}
  });
  await flush();
  assert.equal(env.get('cityName').textContent,'Chilliwack');
  assert.equal(env.context.document.documentElement.classList.contains('dark-mode'),true);
  env.get('themeToggle').listeners.click();
  assert.equal(env.context.document.documentElement.classList.contains('dark-mode'),false);
  const invalid=environment('weather.html',async () => response(vancouverWeather()),{getItem:()=> 'not-a-city'});
  await flush();
  assert.equal(invalid.get('cityName').textContent,'Vancouver');
});

test('malformed stored search history never blocks search navigation', () => {
  for (const saved of ['null', '{}', '42', '"text"', '[null,42,{}," valid "]', 'invalid json']) {
    const env = environment('index.html', undefined, { getItem: key => key === 'gregle-recent-searches' ? saved : null });
    env.context.location = { href: '' };
    env.get('searchInput').value = 'test query';
    env.get('braveSearch').listeners.click();
    assert.equal(env.context.location.href, 'https://search.brave.com/search?q=test%20query');
    assert(Array.isArray(vm.runInContext('getRecentSearches()', env.context)));
  }
});

test('typing invalidates old autocomplete responses before the debounce fires', async () => {
  const env = environment('index.html');
  const pending = deferred();
  env.context.pendingSuggestions = pending.promise;
  vm.runInContext('fetchSearchSuggestions = () => pendingSuggestions', env.context);
  const render = vm.runInContext('renderSuggestions("old")', env.context);
  env.get('searchInput').value = 'new';
  env.get('searchInput').listeners.input();
  pending.resolve(['old suggestion']);
  await render;
  assert.equal(env.get('autocompleteList').innerHTML, '');
  assert.equal(env.get('autocompleteList').classList.contains('open'), false);
});

test('Escape cancels pending autocomplete even before the list opens', async () => {
  const env = environment('index.html');
  const pending = deferred();
  env.context.pendingSuggestions = pending.promise;
  vm.runInContext('fetchSearchSuggestions = () => pendingSuggestions', env.context);
  const render = vm.runInContext('renderSuggestions("query")', env.context);
  env.get('searchInput').listeners.keydown({ key: 'Escape' });
  pending.resolve(['suggestion']);
  await render;
  assert.equal(env.get('autocompleteList').classList.contains('open'), false);
});

test('wallet copying reports failure honestly and always cleans up fallback controls', async () => {
  for (const outcome of [false, true, 'throw']) {
    const env = environment('donate.html');
    let removed = false, restored = false;
    const create = env.context.document.createElement;
    env.context.document.createElement = tag => {
      const node = create(tag);
      node.remove = () => { removed = true; };
      return node;
    };
    env.context.document.activeElement = { focus() { restored = true; } };
    env.context.document.execCommand = () => {
      if (outcome === 'throw') throw new Error('Copy blocked');
      return outcome;
    };
    await vm.runInContext('copyAddress(CRYPTO_WALLETS[0])', env.context);
    assert.equal(removed, true);
    assert.equal(restored, true);
    assert.match(env.get('toast').textContent, outcome === true ? /address copied/ : /Could not copy/);
  }
  const env = environment('donate.html');
  let copied;
  env.context.navigator.clipboard = { async writeText(text) { copied = text; } };
  await vm.runInContext('copyAddress(CRYPTO_WALLETS[0])', env.context);
  assert.equal(copied, vm.runInContext('CRYPTO_WALLETS[0].address', env.context));
  assert.match(env.get('toast').textContent, /address copied/);
});

test('wallet arrow navigation focuses the newly rendered active tab', () => {
  const env = environment('donate.html');
  const selector = env.get('walletSelector');
  let tabs = [], focused;
  Object.defineProperty(selector, 'innerHTML', { set(html) {
    tabs = [...html.matchAll(/data-wallet-id="([^"]+)"/g)].map(match => {
      const tab = element('button');
      tab.dataset = { walletId: match[1] };
      tab.focus = () => { focused = tab; };
      return tab;
    });
  } });
  selector.querySelectorAll = () => tabs;
  env.context.document.getElementById = id => tabs.find(tab => id === 'tab-' + tab.dataset.walletId) || env.get(id);
  vm.runInContext('renderWalletSelector()', env.context);
  const first = tabs[0], oldSecond = tabs[1];
  first.listeners.keydown({ key: 'ArrowRight', currentTarget: first, preventDefault() {} });
  assert.equal(focused, tabs[1]);
  assert.notEqual(focused, oldSecond);
  tabs[1].listeners.keydown({ key: 'ArrowLeft', currentTarget: tabs[1], preventDefault() {} });
  assert.equal(focused, tabs[0]);
});

const archiveResponse = title => response({ latest: 1002, updated: '2026-09-18', comics: Array.from({ length: 1002 }, (_, i) => ({ id: i + 1, title: `${title} ${i + 1}` })).filter(comic => comic.id !== 404) });

test('xkcd ignores malformed caches and rebuilds cached links from comic IDs', async () => {
  for (const cached of ['x'.repeat(1001), { length: 1001 }, Array(1001).fill(null)]) {
    let downloads = 0;
    const env = environment('xkcd.html', async () => { downloads++; return archiveResponse('Fresh'); }, { getItem: () => JSON.stringify({ comics: cached }) });
    env.ready.DOMContentLoaded();
    await flush();
    assert.equal(downloads, 1);
    env.get('q').value = 'Fresh'; env.get('search').onclick();
    assert.match(env.get('results').innerHTML, /Fresh/);
  }
  const cached = Array.from({ length: 1002 }, (_, i) => ({ id: i + 1, title: 'Cached', url: 'javascript:alert(1)', context: '<img src=x>' }));
  const env = environment('xkcd.html', undefined, { getItem: () => JSON.stringify({ comics: cached }) });
  env.ready.DOMContentLoaded();
  env.get('q').value = 'Cached'; env.get('search').onclick();
  assert(!env.get('results').innerHTML.includes('javascript:'));
  assert.match(env.get('results').innerHTML, /href="https:\/\/xkcd.com\/1002\/"/);
});

test('clearing xkcd survives blocked storage and ignores in-flight downloads', async () => {
  const pending = deferred();
  let writes = 0;
  const env = environment('xkcd.html', () => pending.promise, {
    removeItem() { throw new Error('Storage blocked'); }, setItem() { writes++; }
  });
  env.ready.DOMContentLoaded();
  env.get('results').innerHTML = 'Old results';
  env.get('clear').onclick();
  pending.resolve(archiveResponse('Stale'));
  await flush();
  assert.equal(writes, 0);
  assert.equal(env.get('results').innerHTML, '');
  assert.match(env.get('status').textContent, /storage could not be cleared/);
  env.get('q').value = 'Stale'; env.get('search').onclick();
  assert.match(env.get('results').innerHTML, /No match this time/);
});

test('an older xkcd download cannot overwrite a newer reload', async () => {
  const old = deferred();
  let calls = 0;
  const env = environment('xkcd.html', () => ++calls === 1 ? old.promise : Promise.resolve(archiveResponse('Newest')));
  env.ready.DOMContentLoaded();
  await env.get('refresh').onclick();
  old.resolve(archiveResponse('Old'));
  await flush();
  env.get('q').value = 'Newest'; env.get('search').onclick();
  assert.match(env.get('results').innerHTML, />Newest 1002<\/a>/);
});

test('manifest icons resolve to real image assets relative to the manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'favicons/site.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, 'https://example.test/favicons/site.webmanifest');
    const bytes = fs.readFileSync(path.join(root, url.pathname));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  }
});

test('xkcd aborts a stalled local index and keeps the starter collection searchable', async () => {
  let signal;
  const env = environment('xkcd.html', (url, options) => {
    assert.equal(url, 'data/xkcd-index.json');
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Timed out'))));
  });
  env.ready.DOMContentLoaded();
  [...env.timers.values()][0]();
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(env.timers.size, 0);
  assert.match(env.get('status').textContent, /starter collection/);
  env.get('q').value = 'random guy internet'; env.get('search').onclick();
  assert.match(env.get('results').innerHTML, />Dependency<\/a>/);
});

const shippedIndex = JSON.parse(fs.readFileSync(path.join(root, 'data/xkcd-index.json'), 'utf8'));

test('shipped xkcd index covers every official comic except the missing 404', () => {
  const ids = new Set(shippedIndex.comics.map(comic => comic.id));
  assert.equal(ids.size, shippedIndex.latest - 1);
  assert.equal(shippedIndex.comics.length, ids.size);
  assert.equal(ids.has(404), false);
  for (let id = 1; id <= shippedIndex.latest; id++) if (id !== 404) assert(ids.has(id));
  assert(shippedIndex.comics.every(comic => typeof comic.title === 'string' && comic.title.trim()));
});

test('xkcd searches the full local index by title, number and remembered clues', async () => {
  const urls = [];
  const env = environment('xkcd.html', async url => { urls.push(url); return response(shippedIndex); });
  env.ready.DOMContentLoaded(); await flush();
  assert.deepEqual(urls, ['data/xkcd-index.json']);
  for (const [query, title] of [['#927', 'Standards'], ['xkcd 2347', 'Dependency'], ['comic 936', 'Password Strength'], ['one random guy internet', 'Dependency'], [shippedIndex.comics[0].title, shippedIndex.comics[0].title]]) {
    env.get('q').value = query; env.get('search').onclick();
    assert(env.get('results').innerHTML.includes(title));
    if (/^(#|xkcd|comic)/.test(query)) assert.equal(env.get('resultCount').textContent, '1 matching comic');
  }
  env.get('q').value = '#404'; env.get('search').onclick();
  assert.match(env.get('results').innerHTML, /intentionally missing/);
});

test('a failed or malformed index refresh keeps a working full archive', async () => {
  let attempt = 0;
  const env = environment('xkcd.html', async () => ++attempt === 1 ? response(shippedIndex) : response({ comics: [] }));
  env.ready.DOMContentLoaded(); await flush();
  await env.get('refresh').onclick();
  assert.match(env.get('status').textContent, /saved comic titles/);
  env.get('q').value = String(shippedIndex.latest); env.get('search').onclick();
  assert(env.get('results').innerHTML.includes(shippedIndex.comics[0].title));
});

test('queries entered during index loading render when the index arrives', async () => {
  const pending = deferred();
  const env = environment('xkcd.html', () => pending.promise);
  env.ready.DOMContentLoaded();
  env.get('q').value = String(shippedIndex.latest); env.get('search').onclick();
  pending.resolve(response(shippedIndex)); await flush();
  assert.equal(env.get('resultCount').textContent, '1 matching comic');
  assert(env.get('results').innerHTML.includes(shippedIndex.comics[0].title));
});

test('shared tool theme restores preference and works with blocked storage', () => {
  for (const blocked of [false, true]) {
    const env = environment('links.html', undefined, {
      getItem: () => blocked ? null : 'dark',
      setItem() { if (blocked) throw new Error('Blocked'); }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/theme.js'), 'utf8'), env.context);
    const before = env.context.document.documentElement.classList.contains('dark-mode');
    assert.equal(before, !blocked);
    env.get('themeToggle').listeners.click();
    assert.equal(env.context.document.documentElement.classList.contains('dark-mode'), !before);
  }
});

test('homepage tools menu and tool cards resolve to the intended local pages', () => {
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const links = fs.readFileSync(path.join(root, 'links.html'), 'utf8');
  assert.match(home, /href="\/links.html">Tools<\/a>/);
  for (const target of ['petrol.html', 'ev.html', 'xkcd.html']) {
    assert(links.includes('href="' + target + '"'));
    assert(fs.existsSync(path.join(root, target)));
  }
  for (const page of ['links.html', 'xkcd.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert(html.includes('href="assets/tools.css"'));
    assert(html.includes('src="assets/theme.js"'));
  }
});

test('EV estimate includes charging losses and doubles energy and cost for a return trip', () => {
  const env = environment('ev.html');
  assert.equal(env.get('tripCost').textContent, '$6.00');
  assert.equal(env.get('energyUsed').textContent, '18.00 kWh');
  assert.equal(env.get('energyPurchased').textContent, '20.00 kWh');
  env.get('journeyType').value = '2';
  env.get('journeyType').listeners.input();
  assert.equal(env.get('tripCost').textContent, '$12.00');
  assert.equal(env.get('energyPurchased').textContent, '40.00 kWh');
  assert.equal(env.get('routeDistance').textContent, '200.0 km');
});

test('EV distance and efficiency unit changes preserve the same journey cost', () => {
  const env = environment('ev.html');
  env.get('distanceUnit').value = 'miles';
  env.get('distanceUnit').listeners.change();
  assert(Math.abs(Number(env.get('distance').value) - 62.137119) < 0.000001);
  assert.equal(env.get('tripCost').textContent, '$6.00');
  assert.equal(env.get('costPerUnitLabel').textContent, 'Cost per mile');
  assert.equal(env.get('costPerUnit').textContent, '$0.097');
  for (const mode of ['milesKwh', 'kmKwh', 'kwh100']) {
    env.get('consumptionMode').value = mode;
    env.get('consumptionMode').listeners.change();
    assert.equal(env.get('tripCost').textContent, '$6.00');
  }
  env.get('distanceUnit').value = 'km';
  env.get('distanceUnit').listeners.change();
  assert.equal(env.get('routeDistance').textContent, '100.0 km');
});

test('EV miles per kWh estimates use reciprocal efficiency and the selected distance unit', () => {
  const env = environment('ev.html');
  Object.entries({ distance: '120', distanceUnit: 'miles', consumptionMode: 'milesKwh',
    consumptionValue: '4', chargingEfficiency: '100', electricityPrice: '0.25' })
    .forEach(([id, value]) => { env.get(id).value = value; });
  env.get('distance').listeners.input();
  assert.equal(env.get('energyUsed').textContent, '30.00 kWh');
  assert.equal(env.get('energyPurchased').textContent, '30.00 kWh');
  assert.equal(env.get('tripCost').textContent, '$7.50');
});

test('EV incomplete or invalid numbers clear the estimate and recover after correction', () => {
  for (const [id, value] of [['electricityPrice', ''], ['electricityPrice', '-1'], ['consumptionValue', '0'],
    ['distance', '-10'], ['distance', 'Infinity'], ['chargingEfficiency', '0'], ['chargingEfficiency', '101']]) {
    const env = environment('ev.html');
    const original = env.get(id).value;
    env.get(id).value = value;
    env.get(id).listeners.input();
    assert.equal(env.get('tripCost').textContent, '—');
    assert.equal(env.get(id).attributes['aria-invalid'], 'true');
    assert(env.get('validationMessage').textContent);
    env.get(id).value = original;
    env.get(id).listeners.input();
    assert.equal(env.get('tripCost').textContent, '$6.00');
    assert.equal(env.get(id).attributes['aria-invalid'], 'false');
    assert.equal(env.get('validationMessage').textContent, '');
  }
});

test('EV free charging and zero distance are valid and currency is rendered as text', () => {
  const env = environment('ev.html');
  env.get('electricityPrice').value = '0';
  env.get('electricityPrice').listeners.input();
  assert.equal(env.get('tripCost').textContent, '$0.00');
  assert.equal(env.get('energyPurchased').textContent, '20.00 kWh');
  env.get('distance').value = '0';
  env.get('distance').listeners.input();
  assert.equal(env.get('energyPurchased').textContent, '0.00 kWh');
  env.get('currency').value = '<img src=x onerror=alert(1)>';
  env.get('currency').listeners.input();
  assert.match(env.get('tripCost').textContent, /^<img/);
  assert.equal(env.get('tripCost').innerHTML, '');
});

test('EV routing converts kilometres to miles and respects a return journey', async () => {
  const env = environment('ev.html', async url => url.includes('/reverse') ? response({ display_name: 'Place' }) : routeResponse(160934.4));
  env.get('distanceUnit').value = 'miles';
  env.get('distanceUnit').listeners.change();
  env.get('journeyType').value = '2';
  click(env, 1, 2);
  await click(env, 3, 4);
  assert.equal(env.get('distance').value, '100');
  assert.equal(env.get('routeDistance').textContent, '200.0 miles');
  assert.equal(env.get('tripCost').textContent, '$19.31');
});

test('EV cleared routes ignore a late distance response', async () => {
  const pending = deferred();
  const env = environment('ev.html', url => url.includes('/reverse') ? Promise.resolve(response({ display_name: 'Place' })) : pending.promise);
  click(env, 1, 2);
  const routing = click(env, 3, 4);
  await flush();
  env.get('clearRouteButton').listeners.click();
  pending.resolve(routeResponse(99000));
  await routing;
  assert.equal(env.get('distance').value, '100');
  assert.equal(env.get('tripCost').textContent, '$6.00');
});

test('both trip calculators still update manually when the map library is unavailable', () => {
  for (const file of ['petrol.html', 'ev.html']) {
    const env = environment(file, undefined, {}, { L: undefined });
    assert.equal(env.get('routeButton').disabled, true);
    assert.match(env.get('statusBox').textContent, /Enter your distance above/);
    env.get('distance').value = '200';
    env.get('distance').listeners.input();
    assert.equal(env.get('tripCost').textContent, file === 'ev.html' ? '$12.00' : '$31.45');
  }
});


function suggestionCallback(env) {
  const script = env.context.document.head.children.at(-1);
  const callback = new URL(script.src).searchParams.get('callback');
  return { script, callback, respond: data => env.context[callback](data) };
}

test('autocomplete decodes the live provider format, filters invalid entries and reuses cached results', async () => {
  const env = environment('index.html');
  const request = vm.runInContext('fetchSearchSuggestions("café & tea")', env.context);
  const { script, callback, respond } = suggestionCallback(env);
  const url = new URL(script.src);
  assert.equal(url.origin, 'https://suggestqueries.google.com');
  assert.equal(url.searchParams.get('q'), 'café & tea');
  let removed = false;
  script.remove = () => { removed = true; };
  respond(['café & tea', ['café recipes', null, {}, '', 'tea shop']]);
  assert.deepEqual(Array.from(await request), ['café recipes', 'tea shop']);
  assert.equal(removed, true);
  assert.equal(env.context[callback], undefined);
  assert.equal(env.timers.size, 0);
  const cached = await vm.runInContext('fetchSearchSuggestions("café & tea")', env.context);
  assert.deepEqual(Array.from(cached), ['café recipes', 'tea shop']);
  assert.equal(env.context.document.head.children.length, 1);
});

test('autocomplete timeout, network error and malformed data retain local history and clean up', async () => {
  for (const failure of ['timeout', 'network', 'malformed']) {
    const env = environment('index.html', undefined, { getItem: key => key === 'gregle-recent-searches' ? '["weather victoria"]' : null });
    const request = vm.runInContext('renderSuggestions("weather")', env.context);
    const { script, callback, respond } = suggestionCallback(env);
    let removed = false; script.remove = () => { removed = true; };
    if (failure === 'timeout') [...env.timers.values()][0]();
    else if (failure === 'network') script.onerror();
    else respond({ unexpected: true });
    await request;
    assert.equal(removed, true);
    assert.equal(env.context[callback], undefined);
    assert.match(env.get('autocompleteList').innerHTML, /weather victoria/);
    assert.equal(env.get('searchInput').attributes['aria-expanded'], 'true');
  }
});

test('typing shows local matches immediately and cancels the previous provider request', async () => {
  const env = environment('index.html', undefined, { getItem: key => key === 'gregle-recent-searches' ? '["new search"]' : null });
  const pending = vm.runInContext('renderSuggestions("old")', env.context);
  const { script, callback } = suggestionCallback(env);
  let removed = false; script.remove = () => { removed = true; };
  env.get('searchInput').value = 'new';
  env.get('searchInput').listeners.input();
  await pending;
  assert.equal(removed, true);
  assert.equal(env.context[callback], undefined);
  assert.match(env.get('autocompleteList').innerHTML, /new search/);
  assert(!env.get('autocompleteList').innerHTML.includes('old'));
});

test('keyboard suggestions wrap correctly, expose the active option and search Brave on Enter', () => {
  const env = environment('index.html', undefined, {}, { location: { href: '' } });
  const input = env.get('searchInput');
  env.get('searchForm').requestSubmit = () => env.get('searchForm').listeners.submit({ preventDefault() {} });
  vm.runInContext('renderSuggestionList(["first", "second", "third & last"])', env.context);
  assert.equal(input.attributes['aria-expanded'], 'true');
  const key = key => input.listeners.keydown({ key, preventDefault() {} });
  key('ArrowUp');
  assert.equal(input.attributes['aria-activedescendant'], 'suggestion-2');
  key('ArrowDown');
  assert.equal(input.attributes['aria-activedescendant'], 'suggestion-0');
  key('ArrowUp'); key('Enter');
  assert.equal(env.context.location.href, 'https://search.brave.com/search?q=third%20%26%20last');
  assert.equal(input.attributes['aria-expanded'], 'false');
  assert.equal(input.attributes['aria-activedescendant'], undefined);
});

test('click selection submits the escaped suggestion to Brave', () => {
  const env = environment('index.html', undefined, {}, { location: { href: '' } });
  const option = element('li');
  env.get('autocompleteList').querySelectorAll = () => [option];
  env.get('searchForm').requestSubmit = () => env.get('searchForm').listeners.submit({ preventDefault() {} });
  vm.runInContext('renderSuggestionList(["<img src=x>"])', env.context);
  assert(!env.get('autocompleteList').innerHTML.includes('<img'));
  option.listeners.click();
  assert.equal(env.context.location.href, 'https://search.brave.com/search?q=%3Cimg%20src%3Dx%3E');
});

test('Tab and blur dismiss suggestions, including pending responses', async () => {
  for (const event of ['Tab', 'blur']) {
    const env = environment('index.html');
    const pending = deferred(); env.context.pendingSuggestions = pending.promise;
    vm.runInContext('fetchSearchSuggestions = () => pendingSuggestions', env.context);
    const render = vm.runInContext('renderSuggestions("query")', env.context);
    if (event === 'Tab') env.get('searchInput').listeners.keydown({ key: 'Tab' });
    else env.get('searchInput').listeners.blur();
    pending.resolve(['late suggestion']); await render;
    assert.equal(env.get('searchInput').attributes['aria-expanded'], 'false');
    assert.equal(env.get('autocompleteList').innerHTML, '');
  }
});

test('IME composition does not request partial text or submit the form', () => {
  const env = environment('index.html', undefined, {}, { location: { href: '' } });
  const input = env.get('searchInput');
  input.listeners.compositionstart(); input.value = '日'; input.listeners.input();
  input.listeners.keydown({ key: 'Enter', isComposing: true });
  env.get('searchForm').listeners.submit({ preventDefault() {} });
  assert.equal(env.context.location.href, '');
  assert.equal(env.timers.size, 0);
  input.listeners.compositionend();
  assert.equal(env.timers.size, 1);
});

function worldwideWeather() {
  return { timezone:'Pacific/Auckland', current:{time:'2026-09-29T00:15', temperature_2m:13.5,
    relative_humidity_2m:80, weather_code:61,is_day:0,wind_speed_10m:18,wind_direction_10m:270},
    daily:{time:['2026-09-29','2026-09-30'],weather_code:[61,0],temperature_2m_max:[17,null],temperature_2m_min:[8,null],precipitation_probability_max:[75,null]} };
}
const torontoStation = {features:[{geometry:{coordinates:[-79.38,43.65]},properties:{identifier:'on-143',name:{en:'Toronto'}}}]};

test('opening weather requests approximate location and uses Environment Canada for Canadian visitors', async () => {
  let locate, options; const urls=[], writes=[];
  const env=environment('weather.html',async url=>{
    urls.push(url);
    if(url.includes('bigdatacloud')) return response({countryCode:'CA',city:'Toronto',countryName:'Canada'});
    if(url.includes('limit=1000')) return response(torontoStation);
    return response(vancouverWeather());
  },{setItem:(key,value)=>writes.push([key,value])},{navigator:{geolocation:{getCurrentPosition(success,error,opts){locate=success; options=opts;}}}});
  assert.equal(typeof locate,'function'); assert.equal(options.enableHighAccuracy,false);
  await locate({coords:{latitude:43.65321,longitude:-79.38345}}); await flush();
  assert.equal(env.get('cityName').textContent,'Toronto');
  assert(urls.some(url=>url.includes('latitude=43.65&longitude=-79.38')));
  assert(urls.some(url=>url.includes('/items/on-143?')));
  assert(!urls.some(url=>url.includes('api.open-meteo.com')));
  assert.match(env.get('status').textContent,/Environment Canada forecast for Toronto/);
  assert.deepEqual(writes.filter(([key])=>key!=='gregle-theme'),[['gregle-weather-city','vancouver']]);
});

test('overseas auto-location loads modelled global conditions and local calendar days', async () => {
  let locate; const urls=[];
  const env=environment('weather.html',async url=>{
    urls.push(url);
    if(url.includes('bigdatacloud')) return response({countryCode:'NZ',city:'Auckland',countryName:'New Zealand'});
    return response(url.includes('api.open-meteo.com') ? worldwideWeather() : vancouverWeather());
  },{}, {navigator:{geolocation:{getCurrentPosition(success){locate=success;}}}});
  await locate({coords:{latitude:-36.85,longitude:174.76}}); await flush();
  assert.equal(env.get('cityName').textContent,'Auckland');
  assert.equal(env.get('temperature').textContent,'14°C');
  assert.equal(env.get('currentLabel').textContent,'Modelled conditions');
  assert.equal(env.get('forecastGrid').children[0].children[0].textContent,'Tuesday');
  assert.equal(env.get('officialLink').href,'https://open-meteo.com/');
  assert.match(env.get('rangeNote').textContent,/Pacific\/Auckland/);
  assert(!urls.some(url=>url.includes('limit=1000')));
});

test('location denial, timeout, unsupported and synchronous failure preserve usable weather', async () => {
  for(const mode of ['denied','timeout','unsupported','throws']) {
    const geolocation=mode==='unsupported'?undefined:{getCurrentPosition(success,error){
      if(mode==='throws') throw Error('Blocked'); error({code:mode==='denied'?1:3});
    }};
    const env=environment('weather.html',async()=>response(vancouverWeather()),{}, {navigator:{geolocation}});
    await flush();
    assert.equal(env.get('cityName').textContent,'Vancouver');
    assert.equal(env.get('temperature').textContent,'0°C');
    assert.equal(env.get('locateWeather').disabled,false);
    assert.match(env.get('locationStatus').textContent,/declined|could not|unavailable/);
  }
});

test('manual city selection wins over late geolocation and reverse-geocoding callbacks', async () => {
  for(const stage of ['position','reverse']) {
    let locate; const pending=deferred();
    const env=environment('weather.html',url=>url.includes('bigdatacloud')?pending.promise:Promise.resolve(response(vancouverWeather())),{},
      {navigator:{geolocation:{getCurrentPosition(success){locate=success;}}}});
    let located;
    if(stage==='reverse') located=locate({coords:{latitude:43.65,longitude:-79.38}});
    await vm.runInContext('selectCity("victoria")',env.context);
    if(stage==='position') await locate({coords:{latitude:43.65,longitude:-79.38}});
    pending.resolve(response({countryCode:'CA',city:'Toronto'})); await located; await flush();
    assert.equal(env.get('cityName').textContent,'Victoria');
    assert.match(env.get('status').textContent,/Victoria weather loaded/);
  }
});

test('failed Canadian feed falls back to a clearly attributed global forecast', async () => {
  const env=environment('weather.html',async url=>url.includes('api.open-meteo.com')?response(worldwideWeather()):{ok:false});
  await flush();
  assert.equal(env.get('temperature').textContent,'14°C');
  assert.match(env.get('status').textContent,/Environment Canada is unavailable.*Showing Open-Meteo/);
  assert.match(env.get('sourceCredit').textContent,/Open-Meteo/);
});

test('city search escapes names, selects international results, and ignores cancelled searches', async () => {
  const pending=deferred();
  const env=environment('weather.html',async url=>{
    if(url.includes('name=old')) return pending.promise;
    if(url.includes('geocoding-api')) return response({results:[{name:'<London>',country_code:'GB',country:'United Kingdom',latitude:51.51,longitude:-0.13,timezone:'Europe/London'}]});
    return response(url.includes('api.open-meteo.com')?worldwideWeather():vancouverWeather());
  });
  env.get('cityQuery').value='old'; const old=env.get('citySearch').listeners.submit({preventDefault(){}});
  env.get('cityQuery').value='London'; await env.get('citySearch').listeners.submit({preventDefault(){}});
  const button=env.get('cityResults').children[0];
  assert.equal(button.textContent,'<London> · United Kingdom'); assert.equal(button.innerHTML,'');
  await button.listeners.click();
  pending.resolve(response({results:[]})); await old;
  assert.equal(env.get('cityName').textContent,'<London>');
  assert.equal(env.get('cityResults').children.length,0);
  assert.match(env.get('status').textContent,/Open-Meteo/);
});

test('weather helpers reject unsafe coordinates, incomplete directories and malformed daily forecasts', () => {
  const core=require('../assets/weather-core.js');
  assert.throws(()=>core.forecastURL({latitude:NaN,longitude:0}));
  assert.throws(()=>core.nearestStation({...torontoStation,links:[{rel:'next'}]},{latitude:43.65,longitude:-79.38}));
  assert.throws(()=>core.nearestStation(torontoStation,{latitude:0,longitude:0}));
  const data=worldwideWeather(); data.daily.temperature_2m_max=[];
  assert.throws(()=>core.globalWeather(data));
  const valid=core.globalWeather(worldwideWeather());
  assert.equal(valid.days[1].high,null); assert.equal(valid.days[1].description,'Clear.');
});

test('homepage weather uses the shared SVG artwork including night and wintry conditions', () => {
  const env = environment('index.html');
  const core = require('../assets/weather-core.js');
  for (const [code,isDay] of [[0,1],[0,0],[2,0],[65,1],[66,1],[85,1],[99,1]]) {
    env.context.sample={code,isDay};
    vm.runInContext('setWeatherChip(12,sample.code,51.5,-0.12,"London",sample.isDay,"Europe/London","GB")',env.context);
    assert(env.get('weatherChip').innerHTML.includes(core.weatherIcon(core.condition(code),isDay===0)));
    assert.match(env.get('weatherChip').innerHTML, /12°C/);
  }
});

test('homepage weather links preserve the displayed location and forecast timezone', () => {
  const env=environment('index.html');
  vm.runInContext('setWeatherChip(18,2,51.5,-0.12,"London & area",1,"Europe/London","GB")',env.context);
  const href=new URL(env.get('weatherChip').href,'https://gregle.uk');
  assert.equal(href.pathname,'/weather.html');assert.equal(href.searchParams.get('lat'),'51.5');
  assert.equal(href.searchParams.get('lon'),'-0.12');assert.equal(href.searchParams.get('name'),'London & area');
  assert.equal(href.searchParams.get('tz'),'Europe/London');assert.equal(href.searchParams.get('country'),'GB');
  const parsed=require('../assets/tide-core.js').locationFromURL(href.href);
  assert.equal(parsed.latitude,51.5);assert.equal(parsed.longitude,-0.12);assert.equal(parsed.timezone,'Europe/London');
  vm.runInContext('setWeatherFallback()',env.context);
  const fallback=new URL(env.get('weatherChip').href,'https://gregle.uk');
  assert.equal(fallback.searchParams.get('name'),'Victoria');assert.equal(fallback.searchParams.get('country'),'CA');
  assert.equal(fallback.searchParams.get('tz'),'America/Vancouver');assert.match(env.get('weatherChip').innerHTML,/--°C/);
  const markup=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<a class="weather-chip"[^>]+>/)[0];
  assert(!markup.includes('target="_blank"'));assert(markup.includes('/weather.html?lat='));
});

test('cached homepage weather keeps its own location and rejects invalid cached coordinates', () => {
  const cached={temperature:8,weatherCode:0,isDay:0,latitude:35.68,longitude:139.69,label:'Tokyo',timezone:'Asia/Tokyo',country:'JP',savedAt:Date.now()};
  const env=environment('index.html',()=>new Promise(()=>{}),{getItem:key=>key==='gregle-weather-cache'?JSON.stringify(cached):null});
  const link=new URL(env.get('weatherChip').href,'https://gregle.uk');
  assert.equal(link.searchParams.get('lat'),'35.68');assert.equal(link.searchParams.get('name'),'Tokyo');
  assert.equal(link.searchParams.get('tz'),'Asia/Tokyo');
  assert(env.get('weatherChip').innerHTML.includes(require('../assets/weather-core.js').weatherIcon('Clear',true)));
  cached.latitude=999;
  assert.equal(vm.runInContext('readCachedWeather()',env.context),null);
});
