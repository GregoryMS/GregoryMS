const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../assets/sports-core.js');
const L = require('../assets/sports-live-core.js');
const NOW = Date.parse('2026-10-12T19:15:00Z');
function raw(state = 'in', ids = ['359', '382']) {
  return { id: '123456', date: '2026-10-12T19:00:00Z', league: { name: 'Premier League', slug: 'eng.1' }, competitions: [{ status: { displayClock: '15′', type: { state, completed: state === 'post', name: state === 'post' ? 'STATUS_FULL_TIME' : 'STATUS_IN_PROGRESS', description: state === 'post' ? 'Full Time' : 'In Progress' } }, competitors: ids.map((id, i) => ({ homeAway: i ? 'away' : 'home', team: { id, displayName: i ? 'Manchester City' : 'Arsenal', abbreviation: i ? 'MCI' : 'ARS' }, score: i ? '1' : '0' })) }] };
}
function summary(state = 'in', ids = ['359', '382']) {
  const event = raw(state, ids);
  return { header: { ...event, leagues: [event.league] }, boxscore: { teams: [{ team: { id: ids[1] }, statistics: [{ name: 'possessionPct', displayValue: '62.3' }, { name: 'shotsOnTarget', displayValue: '2' }] }, { team: { id: ids[0] }, statistics: [{ name: 'possessionPct', displayValue: '37.7' }, { name: 'shotsOnTarget', displayValue: '0' }] }] } };
}
function tv(now = NOW) {
  return { version: 1, countries: Object.fromEntries(L.countries.map(c => [c.code, { checkedAt: new Date(now).toISOString(), listings: [{ home: 'Arsenal', away: 'Man City', start: '2026-10-12T19:00:00Z', channels: [c.name + ' Channel', c.name + ' Channel'] }] }])) };
}
test('live summary uses team IDs for home/away stats, preserves zero, and rejects the wrong match', () => {
  const match = S.event(raw()); const detail = L.summary(summary(), match, S);
  assert.equal(detail.event.home.score, '0');
  assert.equal(detail.stats.find(s => s.label === 'Possession').home, '37.7%');
  assert.equal(detail.stats.find(s => s.label === 'Possession').away, '62.3%');
  assert.equal(detail.stats.find(s => s.label === 'On target').home, '0');
  assert.equal(detail.stats.find(s => s.label === 'Corners').home, '—');
  assert.throws(() => L.summary({ ...summary(), header: { ...summary().header, id: 'other' } }, match, S));
  assert.throws(() => L.summary(summary('in', ['19973', '19257']), match, S));
});
test('TV listings stay country-specific and match names, sides, time and gender', () => {
  const match = S.event(raw()); const snapshot = tv();
  let rows = L.broadcastListings(snapshot, match, S, NOW);
  assert.deepEqual(rows.map(c => c.channels), [['UK Channel'], ['Canada Channel'], ['Norway Channel'], ['Sweden Channel'], ['Germany Channel']]);
  snapshot.countries.GB.listings.push({ home: 'Arsenal (W)', away: 'Manchester City (W)', start: match.date, channels: ['Women channel'] });
  rows = L.broadcastListings(snapshot, match, S, NOW); assert.deepEqual(rows[0].channels, ['UK Channel']);
  const women = S.event(raw('in', ['19973', '19257']));
  assert.deepEqual(L.broadcastListings(snapshot, women, S, NOW)[0].channels, ['Women channel']);
  snapshot.countries.GB.listings[0].start = '2026-10-13T19:00:00Z';
  assert.deepEqual(L.broadcastListings(snapshot, match, S, NOW)[0].channels, []);
  snapshot.countries.CA.listings[0].home = 'Manchester City'; snapshot.countries.CA.listings[0].away = 'Arsenal';
  assert.deepEqual(L.broadcastListings(snapshot, match, S, NOW)[1].channels, []);
});
test('expired or malformed TV data and unconfirmed kick-off times do not produce channel claims', () => {
  const match = S.event(raw());
  assert(L.broadcastListings(tv(NOW - 7 * 3600000), match, S, NOW).every(c => !c.fresh && !c.channels.length));
  assert(L.broadcastListings(tv(), { ...match, timeTBD: true }, S, NOW).every(c => !c.channels.length));
  const snapshot = tv(); snapshot.countries.GB.listings = [null, { channels: 'wrong' }];
  assert.equal(L.broadcastListings(snapshot, match, S, NOW)[0].channels.length, 0);
  assert.equal(L.identity('Bayern München (W)').key, L.identity('Bayern Munich').key);
  assert.equal(L.identity('1. FC Magdeburg').key, L.identity('Magdeburg').key);
});
function app(options = {}) {
  const nodes = new Map(), requests = [], intervals = [], listeners = {};
  let time = NOW, response = options.summary || summary(), failure = false;
  const get = id => { if (!nodes.has(id)) nodes.set(id, { hidden: true, innerHTML: '', textContent: '', listeners: {}, addEventListener(k, cb) { this.listeners[k] = cb; } }); return nodes.get(id); };
  const document = { hidden: false, getElementById: get, addEventListener(k, cb) { listeners[k] = cb; } };
  const context = { document, Intl, URL, AbortController, setTimeout, clearTimeout, setInterval: cb => intervals.push(cb), Date: class extends Date { static now() { return time; } },
    fetch: async url => { requests.push(url); if (options.defer && !url.startsWith('data/')) return options.defer; if (failure) throw Error('Offline'); return { ok: true, json: async () => url.startsWith('data/') ? options.tv || tv() : response }; } };
  context.window = context; vm.createContext(context);
  for (const script of ['sports-core.js', 'sports-live-core.js', 'sports-live.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/', script), 'utf8'), context);
  return { get, document, context, requests, intervals, listeners, setTime: value => { time = value; }, fail: () => { failure = true; }, setResponse: value => { response = value; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('live panel remains hidden until a followed team is live, then shows score, stats and five TV countries', async () => {
  const h = app(); h.context.GregleSportsLive.update([S.event(raw('pre'))]);
  assert.equal(h.get('live-section').hidden, true); assert.equal(h.requests.length, 0);
  h.context.GregleSportsLive.update([S.event(raw())]); await flush();
  assert.equal(h.get('live-section').hidden, false);
  assert.equal(h.requests.length, 2);
  const markup = h.get('live-matches').innerHTML;
  assert.match(markup, /Score: 0 to 1/); assert.match(markup, /Possession/); assert.match(markup, /37\.7%/);
  assert.match(markup, /src="https:\/\/a\.espncdn\.com\/i\/teamlogos\/soccer\/500\/359\.png"/);
  assert.match(markup, /src="https:\/\/a\.espncdn\.com\/i\/teamlogos\/soccer\/500\/382\.png"/);
  assert.match(markup, /live-side--home">.*?live-team-name">Arsenal<\/span><span class="live-team-score">0<\/span><\/div>/);
  assert.match(markup, /live-side--away">.*?live-team-name">Manchester City<\/span><span class="live-team-score">1<\/span><\/div>/);
  for (const country of L.countries) assert(markup.includes(country.name + ' Channel'));
  h.document.hidden = true; h.intervals[0](); assert.equal(h.requests.length, 2);
});
test('live logos keep initials hidden until an image fails, including national flags', async () => {
  const payload = summary('in', ['206', '448']);
  const sides = payload.header.competitions[0].competitors;
  sides[0].team.displayName = 'Canada'; sides[0].team.abbreviation = 'CAN';
  sides[1].team.displayName = 'England'; sides[1].team.abbreviation = 'ENG';
  const h = app({ summary: payload });
  h.context.GregleSportsLive.update([S.event(payload.header)]); await flush();
  const markup = h.get('live-matches').innerHTML;
  assert.match(markup, /countries\/500\/can\.png/);
  assert.match(markup, /countries\/500\/eng\.png/);
  assert.match(markup, /class="live-crest-fallback" hidden>CAN<\/span>/);
  assert.match(markup, /class="live-crest-fallback" hidden>ENG<\/span>/);
  const fallback = { hidden: true };
  const image = { hidden: false, nextElementSibling: fallback, classList: { contains: name => name === 'live-team-logo' } };
  h.listeners.error({ target: image });
  assert.equal(image.hidden, true); assert.equal(fallback.hidden, false);
  const unrelated = { hidden: false, classList: { contains: () => false } };
  h.listeners.error({ target: unrelated }); assert.equal(unrelated.hidden, false);
});
test('a full-time summary hides the live section even while team schedules still report live', async () => {
  const h = app({ summary: summary('post') }); const e = S.event(raw());
  h.context.GregleSportsLive.update([e]); await flush();
  assert.equal(h.get('live-section').hidden, true);
  h.setTime(NOW + 180000); h.context.GregleSportsLive.update([e]);
  assert.equal(h.get('live-section').hidden, true);
});
test('a late summary cannot re-open a game that the schedules removed', async () => {
  let resolve; const defer = new Promise(done => { resolve = done; });
  const h = app({ defer }); h.context.GregleSportsLive.update([S.event(raw())]);
  h.context.GregleSportsLive.update([]);
  resolve({ ok: true, json: async () => summary() }); await flush();
  assert.equal(h.get('live-section').hidden, true);
});
test('stats and TV failures are explicit and stale stats are not presented as current', async () => {
  const h = app(); h.context.GregleSportsLive.update([S.event(raw())]); await flush();
  h.setTime(NOW + 120000); h.fail(); h.context.GregleSportsLive.update([S.event(raw())]); await flush();
  assert.match(h.get('live-matches').innerHTML, /Stats refresh unavailable/);
  assert(!h.get('live-matches').innerHTML.includes('37.7%'));
  h.get('live-refresh').listeners.click(); await flush();
  assert.match(h.get('live-matches').innerHTML, /latest listing refresh failed/);
  h.setTime(NOW + 7 * 3600000); h.context.GregleSportsLive.update([S.event(raw())], { staleIDs: ['359', '382'] }); await flush();
  assert.match(h.get('live-matches').innerHTML, /LIVE STATUS UNCONFIRMED/);
  assert.match(h.get('live-matches').innerHTML, /Listings unavailable/);
  assert(!h.get('live-matches').innerHTML.includes('UK Channel'));
});
test('provider names and stats are escaped before live rendering', async () => {
  const payload = summary(); payload.header.competitions[0].competitors[0].team.displayName = '<img src=x onerror=boom>';
  payload.boxscore.teams[0].statistics[0].displayValue = '<svg onload=boom>';
  const h = app({ summary: payload }); h.context.GregleSportsLive.update([S.event(raw())]); await flush();
  const markup = h.get('live-matches').innerHTML;
  assert(!markup.includes('<img src=x')); assert(!markup.includes('<svg')); assert(markup.includes('&lt;img'));
});

