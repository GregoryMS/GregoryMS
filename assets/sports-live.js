(() => {
  'use strict';
  const S = window.GregleSports, L = window.GregleSportsLiveCore;
  const section = document.getElementById('live-section'), cards = document.getElementById('live-matches');
  if (!S || !L || !section || !cards) return;
  const E = S.escape, details = new Map(), pending = new Set();
  let matches = [], staleIDs = new Set(), tv = null, tvAt = 0, tvError = false, tvPending = false;
  const stamp = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  async function request(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      if (!r.ok) throw new Error('Feed unavailable');
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  function activeMatches() {
    return matches.filter(m => {
      const d = details.get(m.id);
      // A fresh summary can report full time before the team schedule catches up.
      return !(d?.data && (d.data.event.completed || (!d.error && Date.now() - d.at <= 90000 && (d.data.event.special || d.data.event.state === 'post'))));
    });
  }
  function render() {
    const active = activeMatches();
    section.hidden = !active.length;
    if (!active.length) { cards.innerHTML = ''; return; }
    document.getElementById('live-section-count').textContent = active.length + (active.length === 1 ? ' match' : ' matches') + ' · All followed teams';
    cards.innerHTML = active.map(match => {
      const detail = details.get(match.id);
      const fresh = detail?.data && !detail.error && Date.now() - detail.at <= 90000;
      const m = fresh && detail.data.event.live ? detail.data.event : match;
      const unconfirmed = !fresh && (staleIDs.has(m.home.id) && staleIDs.has(m.away.id) || [m.home.id, m.away.id].filter(id => S.teams.some(t => t.id === id)).every(id => staleIDs.has(id)));
      const stats = fresh ? detail.data.stats : [];
      const statsText = detail?.error ? 'Stats refresh unavailable.' : !detail?.data ? 'Loading match stats…' : !fresh ? 'Stats need a fresh update.' : !detail.data.hasStats ? 'Detailed stats have not been published for this game.' : '';
      const statsMarkup = stats.length ? '<div class="live-stat-table" role="table" aria-label="Live match statistics"><div class="live-stat-row stat-labels" role="row"><span role="columnheader">' + E(m.home.abbreviation || m.home.name) + '</span><span role="columnheader">Match stats</span><span role="columnheader">' + E(m.away.abbreviation || m.away.name) + '</span></div>' + stats.map(s => '<div class="live-stat-row" role="row"><span role="cell">' + E(s.home) + '</span><span role="cell">' + E(s.label) + '</span><span role="cell">' + E(s.away) + '</span></div>').join('') + '</div>' : '';
      const rows = L.broadcastListings(tv, m, S);
      const tvMarkup = rows.map(c => '<div class="tv-country"><a href="' + c.source + '" aria-label="Open ' + E(c.name) + ' football TV guide">' + E(c.name) + ' ↗</a><div>' + (c.channels.length ? '<span>' + c.channels.map(E).join(' · ') + '</span>' : '<span class="muted">' + (!tv && tvPending ? 'Checking listings…' : !c.fresh ? 'Listings unavailable' : 'No confirmed listing') + '</span>') + (c.fresh ? '<small>Checked ' + E(stamp.format(c.checkedAt)) + (c.error ? ' · Refresh unavailable' : '') + '</small>' : '') + '</div></div>').join('');
      return '<article class="live-game"><div class="live-game-heading"><span class="badge live">' + (unconfirmed ? 'LIVE STATUS UNCONFIRMED' : 'LIVE · ' + E(m.detail)) + '</span><span class="meta">' + E(m.competition) + '</span></div><div class="live-scoreboard"><div class="live-side">' + E(m.home.name) + '</div><div class="live-score" aria-label="Score: ' + E(m.home.score) + ' to ' + E(m.away.score) + '">' + E(m.home.score) + '<span>–</span>' + E(m.away.score) + '</div><div class="live-side">' + E(m.away.name) + '</div></div><div class="live-game-body"><div>' + statsMarkup + (statsText ? '<p class="meta">' + E(statsText) + '</p>' : '') + (fresh ? '<p class="meta">Score &amp; stats checked ' + E(stamp.format(detail.at)) + '</p>' : '<p class="meta">Score from the team schedule' + (unconfirmed ? ' · awaiting live confirmation' : '') + '</p>') + (m.link ? '<a class="match-link" href="' + E(m.link) + '">Full match details ↗</a>' : '') + '</div><aside class="live-tv" aria-label="Where to watch"><h3>Where to watch</h3><p class="meta">TV &amp; streaming · match-specific listings</p>' + tvMarkup + '<p class="tv-note">Listings: FotMob. A missing listing does not mean the game is unavailable.' + (tvError ? ' The latest listing refresh failed.' : '') + '</p></aside></div></article>';
    }).join('');
  }
  async function loadDetail(match, force = false) {
    if (pending.has(match.id) || (!force && Date.now() - (details.get(match.id)?.attemptAt || 0) < 30000)) return;
    pending.add(match.id);
    const prior = details.get(match.id);
    details.set(match.id, { ...prior, attemptAt: Date.now() });
    try {
      const slug = /^[a-z0-9.]+$/.test(match.leagueSlug || '') ? match.leagueSlug : 'all';
      if (!/^\d+$/.test(match.id)) throw new Error('Invalid event ID');
      const payload = await request('https://site.api.espn.com/apis/site/v2/sports/soccer/' + slug + '/summary?event=' + match.id);
      details.set(match.id, { data: L.summary(payload, match, S), at: Date.now(), attemptAt: Date.now(), error: false });
    } catch (_) { details.set(match.id, { ...prior, attemptAt: Date.now(), error: true }); }
    finally { pending.delete(match.id); render(); }
  }
  async function loadTV(force = false) {
    if (tvPending || (!force && Date.now() - tvAt < 5 * 60000)) return;
    tvPending = true; tvAt = Date.now(); render();
    try {
      const payload = await request('data/sports-tv.json');
      if (payload?.version !== 1 || !payload.countries || typeof payload.countries !== 'object') throw new Error('Invalid TV guide');
      tv = payload; tvError = false;
    } catch (_) { tvError = true; }
    finally { tvPending = false; render(); }
  }
  function refresh(force = false) {
    if (document.hidden) return;
    const active = activeMatches();
    if (!active.length) return;
    active.forEach(m => loadDetail(m, force)); loadTV(force);
  }
  window.GregleSportsLive = {
    refresh() { refresh(true); },
    update(events, options = {}) {
      matches = S.selectEvents(events, S.teams.map(t => t.id), 'live');
      staleIDs = new Set(options.staleIDs || []);
      render(); refresh();
    }
  };
  document.getElementById('live-refresh').addEventListener('click', () => refresh(true));
  setInterval(() => { render(); refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); refresh(); } });
})();
