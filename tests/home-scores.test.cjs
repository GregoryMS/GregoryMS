const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../assets/sports-core.js');
const NOW = Date.parse('2026-10-28T19:15:00Z');
function event(id = '101', ids = ['359', '382'], state = 'in', name = 'STATUS_IN_PROGRESS') {
  return { id, date: '2026-10-28T19:00:00Z', league: { slug: 'eng.1' }, competitions: [{
    status: { displayClock: '15′', type: { name, state, completed: state === 'post' } },
    competitors: ids.map((id, index) => ({ homeAway: index ? 'away' : 'home', team: { id, displayName: 'Team ' + id, abbreviation: 'ABC' }, score: index ? '1' : '0' }))
  }] };
}
function app(options = {}) {
  const requests = [], listeners = {}, intervals = [], media = { matches: options.viewport !== false, addEventListener(_, fn) { this.change = fn; } };
  let now = NOW, events = options.events || [], fail = false, summary = options.summary;
  const scores = { hidden: true, children: [], clientWidth: 900, parentElement: {}, _html: '',
    set innerHTML(value) { this._html = value; this.children = [...value.matchAll(/<a class="score-chip"/g)].map(() => ({ hidden: false, getBoundingClientRect: () => ({ width: 190 }) })); },
    get innerHTML() { return this._html; }
  };
  const document = { hidden: Boolean(options.hidden), getElementById: () => scores, addEventListener(k, fn) { listeners[k] = fn; } };
  const context = { document, URL, AbortController, setTimeout, clearTimeout, getComputedStyle: () => ({ columnGap: '10px' }),
    Date: class extends Date { static now() { return now; } },
    setInterval: fn => intervals.push(fn), matchMedia: () => media, addEventListener(k, fn) { listeners[k] = fn; },
    fetch: async (url, init) => {
      requests.push({ url, signal: init.signal });
      if (fail) throw Error('Offline');
      if (url.includes('/summary?')) {
        const id = new URL(url).searchParams.get('event');
        if (options.deferSummary) return options.deferSummary;
        const raw = summary || events.find(e => e.id === id);
        return { ok: true, json: async () => ({ header: { ...raw, leagues: [raw.league] } }) };
      }
      const id = url.match(/teams\/(\d+)\//)[1];
      return { ok: true, json: async () => ({ team: { id }, events: events.filter(e => options.includeUnrelated || e.competitions[0].competitors.some(c => c.team.id === id)) }) };
    }
  };
  if (options.noMedia) context.matchMedia = undefined;
  if (options.oldMedia) { delete media.addEventListener; media.addListener = fn => { media.change = fn; }; }
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/sports-core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/home-scores.js'), 'utf8'), context);
  return { scores, requests, listeners, media, document, intervals, tick: () => intervals[0](), setTime: time => { now = time; }, fail: () => { fail = true; }, setSummary: value => { summary = value; }, setEvents: value => { events = value; } };
}
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
test('homepage uses all followed teams, deduplicates games and excludes untracked or non-live matches', async () => {
  const h = app({ includeUnrelated: true, events: [event(), event('102', ['19973', '19257']), event('103', ['9991', '9992']), event('104', ['331', '359'], 'post'), event('105', ['331', '359'], 'pre'), event('106', ['331', '359'], 'in', 'STATUS_SUSPENDED')] });
  await flush();
  assert.equal(h.scores.hidden, false);
  assert.equal(h.scores.children.length, 2);
  assert.match(h.scores.innerHTML, /soccer\/500\/359\.png/);
  assert.match(h.scores.innerHTML, /soccer\/500\/382\.png/);
  assert.match(h.scores.innerHTML, /soccer\/500\/19973\.png/);
  assert.match(h.scores.innerHTML, /<strong>0–1<\/strong>/);
  assert.match(h.scores.innerHTML, /W · LIVE/);
  assert(!h.scores.innerHTML.includes('>ARS<')); assert(!h.scores.innerHTML.includes('>MCI<'));
  assert.match(h.scores.innerHTML, /href="https:\/\/sports.gregle.uk\/"/);
  const schedules = h.requests.filter(r => r.url.includes('/schedule?'));
  assert.equal(schedules.length, S.teams.length * 2);
  assert(S.teams.every(t => schedules.some(r => r.url.includes('/teams/' + t.id + '/'))));
});
test('no live games leaves no empty pill or reserved scores area', async () => {
  const h = app({ events: [event('101', ['359', '382'], 'pre')] }); await flush();
  assert.equal(h.scores.hidden, true); assert.equal(h.scores.children.length, 0);
});
test('zero-width and hidden pages do not request scores; restoring viewport space starts retrieval', async () => {
  const h = app({ viewport: false, events: [event()] }); await flush();
  h.tick(); assert.equal(h.requests.length, 0); assert.equal(h.scores.hidden, true);
  h.media.matches = true; h.media.change(); await flush(); assert.equal(h.scores.hidden, false);
  h.media.matches = false; h.media.change(); assert.equal(h.scores.hidden, true);
  const before = h.requests.length; h.tick(); assert.equal(h.requests.length, before);
  const hidden = app({ hidden: true, events: [event()] }); await flush(); assert.equal(hidden.requests.length, 0);
});
test('all games fit on a wide header, otherwise only the first is shown, and resizing restores all', async () => {
  const h = app({ events: [event(), event('102', ['331', '361']), event('103', ['19973', '19257'])] }); await flush();
  assert(h.scores.children.every(chip => !chip.hidden));
  h.scores.clientWidth = 400; h.listeners.resize();
  assert.deepEqual(h.scores.children.map(chip => chip.hidden), [false, true, true]);
  h.scores.clientWidth = 180; h.listeners.resize(); assert(h.scores.children.every(chip => chip.hidden));
  h.scores.clientWidth = 900; h.listeners.resize(); assert(h.scores.children.every(chip => !chip.hidden));
});
test('fresh summaries update scores every 30 seconds and full time stays hidden despite lagging schedules', async () => {
  const h = app({ events: [event()] }); await flush();
  const newer = event(); newer.competitions[0].competitors[0].score = '2'; h.setSummary(newer);
  h.setTime(NOW + 30000); h.tick(); await flush(); assert.match(h.scores.innerHTML, /<strong>2–1<\/strong>/);
  assert.equal(h.requests.filter(r => r.url.includes('/schedule?')).length, S.teams.length * 2);
  h.setSummary(event('101', ['359', '382'], 'post')); h.setTime(NOW + 60000); h.tick(); await flush();
  assert.equal(h.scores.hidden, true);
  h.setTime(NOW + 180000); h.tick(); await flush(); assert.equal(h.scores.hidden, true);
});
test('failed refreshes cannot keep stale scores visible indefinitely', async () => {
  const h = app({ events: [event()] }); await flush(); assert.equal(h.scores.hidden, false);
  h.fail(); h.setTime(NOW + 91000); h.tick(); await flush(); assert.equal(h.scores.hidden, true);
});
test('a late response cannot restore scores after losing viewport space', async () => {
  let resolve; const deferred = new Promise(done => { resolve = done; });
  const h = app({ events: [event()], deferSummary: deferred }); await flush();
  h.media.matches = false; h.media.change();
  const raw = event(); resolve({ ok: true, json: async () => ({ header: { ...raw, leagues: [raw.league] } }) }); await flush();
  assert.equal(h.scores.hidden, true); assert(h.requests.filter(r => r.url.includes('/summary?')).every(r => r.signal.aborted));
});
test('provider strings are escaped before insertion in score links', async () => {
  const raw = event(); raw.competitions[0].competitors[0].team.displayName = '<img src=x onerror=alert(1)>';
  raw.competitions[0].competitors[1].score = '<script>bad()</script>';
  const h = app({ events: [raw] }); await flush();
  assert(!h.scores.innerHTML.includes('<img src=x')); assert(!h.scores.innerHTML.includes('<script>'));
  assert.match(h.scores.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h.scores.innerHTML, /&lt;script&gt;/);
});
test('unavailable media queries leave scores hidden and older media listeners still work', async () => {
  const unavailable = app({ noMedia: true, events: [event()] }); await flush();
  assert.equal(unavailable.requests.length, 0); assert.equal(unavailable.scores.hidden, true);
  const older = app({ oldMedia: true, viewport: false, events: [event()] }); await flush();
  older.media.matches = true; older.media.change(); await flush(); assert.equal(older.scores.hidden, false);
});
test('emblems use national flags and safe opponent crests, with a graphic fallback on image failure', async () => {
  const match = event('201', ['206', '9991']);
  match.competitions[0].competitors[1].team.logo = 'https://a.espncdn.com/i/teamlogos/soccer/500/opponent.png';
  const h = app({ events: [match] }); await flush();
  assert.match(h.scores.innerHTML, /countries\/500\/can\.png/);
  assert.match(h.scores.innerHTML, /soccer\/500\/opponent\.png/);
  assert.match(h.scores.innerHTML, /<svg class="score-chip-emblem"[^>]+ hidden>/);
  const fallback = { hidden: true };
  const image = { tagName: 'IMG', hidden: false, nextElementSibling: fallback, classList: { contains: name => name === 'score-chip-emblem' } };
  h.listeners.error({ target: image }); assert.equal(image.hidden, true); assert.equal(fallback.hidden, false);
  const unrelated = { tagName: 'IMG', hidden: false, classList: { contains: () => false } };
  h.listeners.error({ target: unrelated }); assert.equal(unrelated.hidden, false);
  match.competitions[0].competitors[1].team.logo = 'https://evil.test/logo.png';
  const unsafe = app({ events: [match] }); await flush();
  assert(!unsafe.scores.innerHTML.includes('evil.test')); assert.match(unsafe.scores.innerHTML, /soccer\/500\/9991\.png/);
});
