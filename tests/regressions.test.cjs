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
    querySelectorAll: () => [], focus() {}, select() {}, remove() {}, contains: () => false
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
  vm.runInContext('fetchDuckDuckGoSuggestions = () => pendingSuggestions', env.context);
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
  vm.runInContext('fetchDuckDuckGoSuggestions = () => pendingSuggestions', env.context);
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

test('homepage links menu and tool cards resolve to the intended local pages', () => {
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const links = fs.readFileSync(path.join(root, 'links.html'), 'utf8');
  assert.match(home, /href="\/links.html">Links<\/a>/);
  for (const target of ['petrol.html', 'xkcd.html']) {
    assert(links.includes('href="' + target + '"'));
    assert(fs.existsSync(path.join(root, target)));
  }
  for (const page of ['links.html', 'xkcd.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert(html.includes('href="assets/tools.css"'));
    assert(html.includes('src="assets/theme.js"'));
  }
});
