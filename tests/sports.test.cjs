const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../assets/sports-core.js');
const NOW = Date.parse('2026-10-12T13:15:00Z');
function event(id = 'match', state = 'pre', ids = ['359', '382']) {
  return { id, date: '2026-10-13T19:00:00Z', league: { name: 'Premier League' }, links: [{ href: 'https://www.espn.com/soccer/match/_/gameId/1', rel: ['summary'] }], competitions: [{ dateValid: true, status: { displayClock: '42′', type: { state, name: state === 'post' ? 'STATUS_FULL_TIME' : 'STATUS_SCHEDULED', completed: state === 'post', description: state === 'post' ? 'Full Time' : 'Scheduled', shortDetail: state === 'post' ? 'FT' : '' } }, competitors: ids.map((id, i) => ({ homeAway: i ? 'away' : 'home', team: { id, displayName: i ? 'Manchester City' : 'Arsenal', abbreviation: i ? 'MCI' : 'ARS' }, score: { value: i ? 2 : 0, displayValue: String(i ? 2 : 0) } })) }] };
}
function table() {
  const row = (id, rank, points) => ({ team: { id, displayName: id === '359' ? 'Arsenal' : 'Manchester City' }, stats: [{ name: 'rank', value: rank, displayValue: String(rank) }, { name: 'points', value: points, displayValue: String(points) }, { name: 'gamesPlayed', value: 0, displayValue: '0' }, { name: 'ties', value: 0, displayValue: '0' }] });
  return { name: 'League', children: [{ name: 'Conference', children: [{ name: 'Western Conference', standings: { seasonDisplayName: '2026 MLS', entries: [row('359', 2, 0), row('382', 1, 3)] } }] }] };
}
test('requested clubs and national sides have distinct gender-specific IDs', () => {
  assert.equal(S.teams.length, 22);
  assert.equal(new Set(S.teams.map(t => t.id)).size, 22);
  assert.deepEqual(S.teams.filter(t => ['306', '361'].includes(t.id)).map(t => [t.name, t.group]), [['Hull City', 'men-clubs'], ['Newcastle United', 'men-clubs']]);
  assert.deepEqual(S.teams.filter(t => t.group === 'women-clubs').map(t => t.name), ['Chelsea', 'Manchester City', 'Arsenal', 'Bayern Munich', 'Brighton']);
  for (const group of ['men-nations', 'women-nations']) assert.deepEqual(S.teams.filter(t => t.group === group).map(t => t.name), ['Canada', 'Norway', 'Scotland', 'Sweden', 'England']);
});
test('duplicate club fixtures use the completed result rather than a lagging scheduled copy', () => {
  const scheduled = event(), result = event('match', 'post');
  const events = S.combineEvents([[result], [scheduled], [result]]);
  assert.equal(events.length, 1); assert.equal(events[0].completed, true);
  assert.equal(events[0].home.score, '0'); assert.equal(events[0].away.score, '2');
  assert.equal(S.selectEvents(events, ['359'], 'upcoming', NOW).length, 0);
  assert.equal(S.selectEvents(events, ['382'], 'recent', NOW).length, 1);
});
test('filtering separates women and men and sorts fixtures ascending and results descending', () => {
  const early = event('early'), later = event('later'); later.date = '2026-10-20T19:00:00Z';
  const women = event('women', 'pre', ['19973', '19257']);
  const events = S.combineEvents([[later, women, early]]);
  assert.deepEqual(S.selectEvents(events, ['359'], 'upcoming', NOW).map(e => e.id), ['early', 'later']);
  assert.deepEqual(S.selectEvents(events, ['19973'], 'upcoming', NOW).map(e => e.id), ['women']);
  const results = S.combineEvents([[{ ...later, competitions: event('later', 'post').competitions }, { ...early, competitions: event('early', 'post').competitions }]]);
  assert.deepEqual(S.selectEvents(results, ['359'], 'recent', NOW).map(e => e.id), ['later', 'early']);
});
test('live matches, postponements, unknown scores and unconfirmed kick-off times remain distinct', () => {
  const live = event('live', 'in');
  const postponed = event('postponed', 'in'); postponed.competitions[0].status.type.name = 'STATUS_POSTPONED';
  postponed.competitions[0].dateValid = false;
  delete postponed.competitions[0].competitors[0].score;
  const events = S.combineEvents([[live, postponed]]);
  assert.deepEqual(S.selectEvents(events, ['359'], 'live', NOW).map(e => e.id), ['live']);
  const p = events.find(e => e.id === 'postponed');
  assert.equal(p.live, false); assert.equal(p.special, true); assert.equal(p.timeTBD, true); assert.equal(p.home.score, '—');
});
test('invalid events are dropped and provider strings and links are safe to render', () => {
  const raw = event(); raw.links[0].href = 'javascript:alert(1)'; raw.competitions[0].competitors[0].team.logos = [{ href: 'https://evil.test/a.png' }];
  const e = S.event(raw); assert.equal(e.link, ''); assert.equal(e.home.logo, '');
  assert.equal(S.event({ ...raw, date: 'bad date' }), null);
  assert.equal(S.event({ id: 'bad', competitions: [] }), null);
  assert.equal(S.escape('<img onerror="boom">&'), '&lt;img onerror=&quot;boom&quot;&gt;&amp;');
  assert.equal(S.safeURL('https://espn.com.evil.test/x'), '');
});
test('nested conference tables preserve provider ranks, zero points and missing stats', () => {
  const groups = S.standings(table()); assert.equal(groups[0].name, 'Western Conference');
  assert.deepEqual(groups[0].rows.map(r => r.id), ['382', '359']);
  assert.equal(groups[0].rows[1].points, '0'); assert.equal(groups[0].rows[1].played, '0'); assert.equal(groups[0].rows[1].gf, '—');
  assert.equal(groups[0].season, '2026 MLS');
});
function harness(options = {}) {
  const nodes = new Map(), listeners = {}, intervals = [], requests = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', attributes: {}, hidden: false, disabled: false, listeners: {}, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(k, v) { this.listeners[k] = v; }, scrollIntoView() {} }); return nodes.get(id); };
  const document = { hidden: false, getElementById: get, querySelectorAll: () => [], addEventListener(k, v) { listeners[k] = v; } };
  let fail = options.fail || (() => false), active = 0, maxActive = 0;
  const context = { document, console, Intl, URL, AbortController, setTimeout, clearTimeout, setInterval: fn => intervals.push(fn), Date: class extends Date { static now() { return NOW; } },
    localStorage: { getItem() { if (options.storageThrows) throw Error('Unavailable'); return options.saved || null; }, setItem() { if (options.storageThrows) throw Error('Unavailable'); } },
    fetch: async url => {
      requests.push(url); active++; maxActive = Math.max(maxActive, active);
      try {
        await new Promise(resolve => setImmediate(resolve));
        if (fail(url)) throw Error('Offline');
        const id = url.match(/teams\/(\d+)\//)?.[1];
        const data = id ? { team: { id }, events: id === '359' ? [event('arsenal-' + (url.endsWith('false') ? 'result' : 'next'), url.endsWith('false') ? 'post' : 'pre')] : [] } : table();
        return { ok: true, json: async () => data };
      } finally { active--; }
    }
  };
  context.window = context;
  vm.createContext(context);
  for (const script of ['sports-core.js', 'sports.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/', script), 'utf8'), context);
  return { get, document, requests, listeners, intervals, maxActive: () => maxActive, setFail: fn => { fail = fn; } };
}
async function settled(h) {
  for (let i = 0; i < 100 && h.get('refresh').disabled; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.get('refresh').disabled, false, 'refresh completes');
  await new Promise(resolve => setTimeout(resolve, 100));
}
test('controller loads all feeds with bounded concurrency and renders distinct fixtures and table', async () => {
  const h = harness(); await settled(h);
  assert.equal(h.requests.length, 48); assert(h.maxActive() <= 6);
  for (const id of ['306', '361', '20103', '19976']) assert.equal(h.requests.filter(url => url.includes('/teams/' + id + '/')).length, 2);
  for (const name of ['Hull City', 'Newcastle United']) assert(h.get('team-filter').innerHTML.includes(name));
  assert.match(h.get('next-match').innerHTML, /Arsenal/);
  assert.match(h.get('latest-match').innerHTML, /class="score">0/);
  assert(!h.get('next-match').innerHTML.includes('class="score"'));
  assert.match(h.get('league-tables').innerHTML, /Western Conference/);
  assert.match(h.get('league-tables').innerHTML, /class="followed"/);
  h.get('team-filter').value = '19973'; h.get('team-filter').listeners.change();
  assert(!h.get('match-list').innerHTML.includes('Manchester City'));
  assert.match(h.get('match-list').innerHTML, /No upcoming fixtures/);
});
test('refresh failure retains older data with warnings and retries successfully', async () => {
  const h = harness(); await settled(h);
  h.setFail(url => url.includes('/359/') || url.includes('/eng.1/standings'));
  await h.get('refresh').listeners.click(); await settled(h);
  assert.match(h.get('match-list').innerHTML, /previously loaded match/);
  assert.match(h.get('table-status').textContent, /previously loaded table/);
  assert.match(h.get('team-cards').innerHTML, /older data may be shown/);
  assert.match(h.get('feed-status').textContent, /3 unavailable/);
  h.setFail(() => false); await h.get('refresh').listeners.click(); await settled(h);
  assert(!h.get('match-list').innerHTML.includes('previously loaded match'));
  assert(!h.get('table-status').textContent.includes('failed'));
});
test('failed empty feeds and blocked browser storage are handled explicitly', async () => {
  const h = harness({ fail: () => true, storageThrows: true }); await settled(h);
  assert.match(h.get('feed-status').textContent, /48 unavailable/);
  assert.match(h.get('match-list').innerHTML, /Match feeds are unavailable/);
  assert.match(h.get('team-cards').innerHTML, /Fixture feed unavailable/);
  assert.match(h.get('league-tables').innerHTML, /Open the ESPN table/);
  h.document.hidden = true; h.intervals[0](); assert.equal(h.requests.length, 48);
});
test('sports page is linked from Tools and uses the shared theme and local scripts', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'links.html'), 'utf8'), /class="tool-card" href="https:\/\/sports\.gregle\.uk\/"/);
  const html = fs.readFileSync(path.join(root, 'sports.html'), 'utf8');
  assert.match(html, /id="themeToggle"/);
  for (const [, file] of html.matchAll(/(?:src|href)="(assets\/[^"?]+)(?:\?[^\"]*)?"/g)) assert(fs.existsSync(path.join(root, file)), file);
});
