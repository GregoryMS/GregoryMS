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

function environment(fetch, parsedItems = []) {
  const track = { innerHTML: '', style: {}, parentElement: { clientWidth: 800 } };
  const group = { scrollWidth: 1500, nextElementSibling: { style: {} } };
  const timers = new Map();
  let timer = 0, frame;
  const elements = new Map();
  const options = ['bbc', 'nrk', 'svt', 'radio-canada'].map(id => ({ dataset: { newsSource: id }, setAttribute() {} }));
  const context = vm.createContext({
    URL, AbortController, console, fetch, tickerTrack: track,
    matchMedia: () => ({ matches: false }),
    document: {
      getElementById(id) {
        if (id === 'tickerGroup') return group;
        if (!elements.has(id)) elements.set(id, { setAttribute() {} });
        return elements.get(id);
      },
      querySelectorAll: () => options
    },
    localStorage: { setItem() {} },
    DOMParser: class {
      parseFromString() {
        return {
          querySelector: selector => selector === 'parsererror' ? null : {},
          querySelectorAll: () => parsedItems.map(item => ({ querySelector: key => ({ textContent: item[key] }) }))
        };
      }
    },
    setTimeout(fn) { timers.set(++timer, fn); return timer; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() {},
    escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]))
  });
  // Browser globals refer to the same window in the real page.
  context.window = context;
  vm.runInContext(source, context);
  return { context, track, timers, elements, run: () => context.loadNews(), select: id => context.selectNewsSource(id), step: time => frame(time) };
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
    { ...fresh(), feedUpdatedAt: new Date(Date.now() - 49 * 3600000).toISOString() },
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
  vm.runInContext("lastNews.get('bbc').feedUpdatedAt = new Date(Date.now() - 49 * 3600000).toISOString()", env.context);
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

const nrkFeed = (fetchedAt = new Date().toISOString(), xml = '<rss><channel/></rss>') => ({
  feeds: [{ url: 'https://www.nrk.no/toppsaker.rss', fetchedAt, xml }]
});
const nrkItem = { title: 'Siste nytt & nyheter', link: 'https://www.nrk.no/nyheter/eksempel-1.12345' };

test('NRK uses the existing same-origin feed and its logo links directly to NRK Nyheter', async () => {
  let requested;
  const env = environment(async url => { requested = url; return response(nrkFeed()); }, [nrkItem]);
  await env.select('nrk');
  assert.equal(requested, 'data/news-feeds.json');
  assert.match(env.track.innerHTML, /Siste nytt &amp; nyheter/);
  assert.equal(env.elements.get('newsSourceLink').href, 'https://www.nrk.no/nyheter/');
  assert.match(env.elements.get('newsSourceLink').innerHTML, /nrk-news.svg/);
});

test('NRK rejects expired snapshots, foreign links and unsafe XML', async () => {
  for (const data of [null, { feeds: [] }, nrkFeed(new Date(Date.now() - 49 * 3600000).toISOString()),
    nrkFeed(new Date().toISOString(), '<!DOCTYPE rss><rss/>'),
    nrkFeed(new Date().toISOString(), 'x'.repeat(500001))]) {
    const env = environment(async () => response(data), [nrkItem]);
    await env.select('nrk');
    assert.match(env.track.innerHTML, /Live headlines unavailable/);
    assert.match(env.track.innerHTML, /Open NRK Nyheter/);
    assert(!env.track.innerHTML.includes('Open BBC'));
  }
  for (const link of ['https://nrk.no.evil.test/', 'https://user:pass@www.nrk.no/', 'javascript:alert(1)', 'https://www.bbc.co.uk/news/']) {
    const env = environment(async () => response(nrkFeed()), [{ ...nrkItem, link }]);
    await env.select('nrk');
    assert.match(env.track.innerHTML, /Live headlines unavailable/);
  }
});

test('a delayed BBC response cannot replace NRK after switching sources', async () => {
  let finishBBC;
  const env = environment(url => url.includes('bbc-news')
    ? new Promise(resolve => { finishBBC = resolve; })
    : Promise.resolve(response(nrkFeed())), [nrkItem]);
  const pending = env.run();
  await env.select('nrk');
  finishBBC(response(fresh('Delayed BBC headline')));
  await pending;
  assert.match(env.track.innerHTML, /Siste nytt/);
  assert(!env.track.innerHTML.includes('Delayed BBC'));
  assert.equal(env.timers.size, 0);
});

test('each source retains only its own usable cache when switched during an outage', async () => {
  let fail = false;
  const env = environment(async url => {
    if (fail) throw new Error('Offline');
    return response(url.includes('bbc-news') ? fresh() : nrkFeed());
  }, [nrkItem]);
  await env.run();
  await env.select('nrk');
  fail = true;
  await env.select('bbc');
  assert.match(env.track.innerHTML, /BBC headline/);
  assert(!env.track.innerHTML.includes('Siste nytt'));
  await env.select('nrk');
  assert.match(env.track.innerHTML, /Siste nytt/);
});

test('unavailable storage and invalid source choices do not break source switching', async () => {
  const env = environment(async () => response(nrkFeed()), [nrkItem]);
  vm.runInContext("localStorage.setItem = () => { throw new Error('Storage disabled'); }", env.context);
  await env.select('nrk');
  await env.select('toString');
  assert.match(env.track.innerHTML, /Siste nytt/);
});

test('Radio-Canada uses its official feed, preserves French titles and opens the Info site', async () => {
  let requested;
  const feed = { feeds: [{ url: 'https://ici.radio-canada.ca/info/rss/info/en-continu',
    fetchedAt: new Date().toISOString(), xml: '<rss><channel/></rss>' }] };
  const item = { title: 'Élections : l’actualité & les résultats', link: 'https://ici.radio-canada.ca/nouvelle/1234567/elections' };
  const env = environment(async url => { requested = url; return response(feed); }, [item]);
  await env.select('radio-canada');
  assert.equal(requested, 'data/news-feeds.json');
  assert.match(env.track.innerHTML, /Élections : l’actualité &amp; les résultats/);
  assert.equal(env.elements.get('newsSourceLink').href, 'https://ici.radio-canada.ca/info');
  assert.match(env.elements.get('newsSourceLink').innerHTML, /radio-canada-info.svg/);
  for (const link of ['https://radio-canada.ca.evil.test/', 'https://user:password@ici.radio-canada.ca/', 'https://www.nrk.no/news']) {
    const unsafe = environment(async () => response(feed), [{ ...item, link }]);
    await unsafe.select('radio-canada');
    assert.match(unsafe.track.innerHTML, /Open Radio-Canada Info/);
    assert.match(unsafe.track.innerHTML, /Live headlines unavailable/);
  }
});

const svtFeed = (fetchedAt = new Date().toISOString()) => ({
  feeds: [{ url: 'https://www.svt.se/nyheter/rss.xml', fetchedAt, xml: '<rss><channel/></rss>' }]
});
const svtItem = { title: 'Senaste nytt: å ä ö & Sverige', link: 'https://www.svt.se/nyheter/inrikes/nyhet' };

test('SVT uses its existing same-origin snapshot, Swedish headlines and linked official wordmark', async () => {
  let requested;
  const env = environment(async url => { requested = url; return response(svtFeed()); }, [svtItem]);
  await env.select('svt');
  assert.equal(requested, 'data/news-feeds.json');
  assert.match(env.track.innerHTML, /Senaste nytt: å ä ö &amp; Sverige/);
  assert.equal(env.elements.get('newsSourceLink').href, 'https://www.svt.se/nyheter/');
  assert.match(env.elements.get('newsSourceLink').innerHTML, /svt-news.svg/);
});

test('SVT rejects stale snapshots and foreign or credentialed links with its own fallback', async () => {
  const stale = environment(async () => response(svtFeed(new Date(Date.now() - 49 * 3600000).toISOString())), [svtItem]);
  await stale.select('svt');
  assert.match(stale.track.innerHTML, /Open SVT Nyheter/);
  assert.match(stale.track.innerHTML, /Live headlines unavailable/);
  for (const link of ['https://svt.se.evil.test/', 'https://user:pass@www.svt.se/nyheter/', 'https://www.nrk.no/nyheter/', 'javascript:alert(1)']) {
    const env = environment(async () => response(svtFeed()), [{ ...svtItem, link }]);
    await env.select('svt');
    assert.match(env.track.innerHTML, /Open SVT Nyheter/);
    assert.match(env.track.innerHTML, /Live headlines unavailable/);
  }
});

test('all RSS ticker providers tolerate delayed refreshes but reject expired snapshots', async () => {
  for (const [id, url, item] of [
    ['nrk', 'https://www.nrk.no/toppsaker.rss', nrkItem],
    ['svt', 'https://www.svt.se/nyheter/rss.xml', svtItem],
    ['radio-canada', 'https://ici.radio-canada.ca/info/rss/info/en-continu',
      { title: 'Actualité en français', link: 'https://ici.radio-canada.ca/nouvelle/1234567/actualite' }]
  ]) {
    for (const hours of [7, 47, 49]) {
      const feed = { feeds: [{ url, fetchedAt: new Date(Date.now() - hours * 3600000).toISOString(),
        xml: '<rss><channel/></rss>' }] };
      const env = environment(async () => response(feed), [item]);
      await env.select(id);
      assert.equal(env.track.innerHTML.includes('Live headlines unavailable'), hours > 48, `${id}: ${hours} hours`);
      if (hours < 48) assert(env.track.innerHTML.includes(item.title.replace('&', '&amp;')));
    }
  }
});
