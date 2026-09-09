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
  return {
    tagName: tag.toUpperCase(), value: '', textContent: '', innerHTML: '', children: [],
    style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
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
  const map = { handlers: {}, setView() { return this; }, removeLayer() {}, fitBounds() {},
    on(name, callback) { this.handlers[name] = callback; } };
  const markers = [];
  const layer = () => ({ addTo() { return this; }, bindPopup(content) { this.popup = content; return this; }, getBounds: () => [] });
  const document = { getElementById: get, createElement: element,
    querySelector: get, querySelectorAll: () => [], body: element(), documentElement: element(), head: element(),
    addEventListener(name, callback) { ready[name] = callback; } };
  const context = vm.createContext({ document, console, URL, AbortController,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {}, ...storage },
    navigator: { geolocation: { getCurrentPosition() {} } },
    matchMedia: () => ({ matches: false }), addEventListener() {}, fetch,
    L: { map: () => map, tileLayer: layer, geoJSON: layer, marker() { const m = layer(); markers.push(m); return m; } }
  });
  context.window = context;
  Object.entries({ fuelPrice: '1.85', currency: '$', consumptionMode: 'lPer100', consumptionValue: '8.5', distance: '100' })
    .forEach(([id, value]) => { get(id).value = value; });
  vm.runInContext(scripts(file), context, { filename: file });
  return { context, get, ready, map, markers };
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
