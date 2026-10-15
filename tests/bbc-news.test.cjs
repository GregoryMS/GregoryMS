const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    let tickerPaused'), html.indexOf('    loadWeather();', html.indexOf('    let tickerPaused')));
const fresh = (title = 'BBC headline') => ({
  feedUpdatedAt: new Date().toISOString(), items: [{ title, link: 'https://www.bbc.co.uk/news/articles/example' }]
});
const response = data => ({ ok: true, json: async () => data });

function environment(fetch) {
  const track = { innerHTML: '', style: {} };
  const group = { scrollWidth: 1500, nextElementSibling: { style: {} } };
  const timers = new Map();
  let timer = 0, frame;
  const context = vm.createContext({
    URL, AbortController, console, fetch, tickerTrack: track,
    document: { getElementById: () => group },
    setTimeout(fn) { timers.set(++timer, fn); return timer; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() {},
    escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]))
  });
  vm.runInContext(source, context);
  return { context, track, timers, run: () => context.loadBBCNews(), step: time => frame(time) };
}

test('homepage inline scripts parse', () => {
  for (const [, code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(code);
});

test('loads same-site headlines and escapes titles', async () => {
  let requested;
  const env = environment(async (url, options) => { requested = { url, options }; return response(fresh('<img src=x> & news')); });
  await env.run();
  assert.equal(requested.url, 'data/bbc-news.json');
  assert.equal(requested.options.cache, 'no-cache');
  assert.match(env.track.innerHTML, /&lt;img src=x&gt; &amp; news/);
  assert(!env.track.innerHTML.includes('<img'));
  assert(!env.track.innerHTML.includes('Live headlines unavailable'));
  assert.equal(env.timers.size, 0);
});

test('rejects stale, future, malformed and non-BBC data', async () => {
  for (const data of [null, {}, { ...fresh(), items: {} },
    { ...fresh(), feedUpdatedAt: new Date(Date.now() - 7 * 3600000).toISOString() },
    { ...fresh(), feedUpdatedAt: new Date(Date.now() + 3600000).toISOString() },
    { ...fresh(), items: [{ title: 'Unsafe', link: 'https://bbc.com.evil.test/' }] },
    { ...fresh(), items: [{ title: 'Unsafe', link: 'javascript:alert(1)' }] }]) {
    const env = environment(async () => response(data));
    await env.run();
    assert.match(env.track.innerHTML, /Live headlines unavailable/);
  }
});

test('retains usable headlines after an outage and recovers on the next load', async () => {
  let fail = false, title = 'First headline';
  const env = environment(async () => { if (fail) throw new Error('Offline'); return response(fresh(title)); });
  await env.run();
  const before = env.track.innerHTML;
  fail = true;
  await env.run();
  assert.equal(env.track.innerHTML, before);
  fail = false; title = 'Updated headline';
  await env.run();
  assert.match(env.track.innerHTML, /Updated headline/);
});

test('expired retained headlines fall back to the BBC link', async () => {
  let fail = false;
  const env = environment(async () => { if (fail) throw new Error('Offline'); return response(fresh()); });
  await env.run();
  vm.runInContext('lastBBCNews.feedUpdatedAt = new Date(Date.now() - 7 * 3600000).toISOString()', env.context);
  fail = true;
  await env.run();
  assert.match(env.track.innerHTML, /Live headlines unavailable/);
});

test('timeouts unblock loading and allow a later successful retry', async () => {
  let calls = 0;
  const env = environment((url, { signal }) => {
    calls++;
    if (calls > 1) return Promise.resolve(response(fresh()));
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted'))));
  });
  const pending = env.run();
  await env.run();
  assert.equal(calls, 1);
  for (const callback of env.timers.values()) callback();
  await pending;
  assert.match(env.track.innerHTML, /Live headlines unavailable/);
  await env.run();
  assert.match(env.track.innerHTML, /BBC headline/);
});

test('ticker stays in range after a long background pause and resets on resize', async () => {
  const env = environment(async () => response(fresh()));
  await env.run();
  env.step(1000);
  env.step(1000 + 60 * 60 * 1000);
  const offset = vm.runInContext('tickerOffset', env.context);
  assert(offset >= -12 && offset < 0);
  vm.runInContext('startTicker()', env.context);
  assert.equal(env.track.style.transform, 'translateX(0)');
});
