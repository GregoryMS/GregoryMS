(() => {
  'use strict';
  const S = window.GregleSports;
  if (!S) return;
  const $ = id => document.getElementById(id);
  const E = S.escape;
  const state = { group: 'all', team: 'all', view: 'upcoming', league: 'eng.1', search: '', date: 'all', limit: 12, loading: false, done: 0, schedules: new Map(), tables: new Map(), events: [] };
  try {
    const saved = JSON.parse(localStorage.getItem('gregle-sports-filters') || 'null');
    if (saved) {
      if (saved.group === 'all' || S.groups[saved.group]) state.group = saved.group;
      if (S.teams.some(t => t.id === saved.team && (state.group === 'all' || t.group === state.group))) state.team = saved.team;
      if (S.leagues.some(l => l.id === saved.league)) state.league = saved.league;
    }
  } catch (_) {}
  const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  const stampFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Device local time';
  $('dashboard-date').textContent = dateFormat.format(Date.now());
  $('timezone').textContent = 'Kick-offs: ' + zone.replace(/_/g, ' ');
  function saveFilters() {
    try { localStorage.setItem('gregle-sports-filters', JSON.stringify({ group: state.group, team: state.team, league: state.league })); } catch (_) {}
  }
  const eligibleTeams = () => S.teams.filter(t => state.group === 'all' || t.group === state.group);
  const selectedTeams = () => eligibleTeams().filter(t => state.team === 'all' || t.id === state.team);
  const followed = id => S.teams.some(t => t.id === id);
  function teamLabel(team) { return team.name + (team.group.startsWith('women') ? ' · Women' : ' · Men'); }
  function logo(team) {
    let url = team.logo;
    if (!url && S.teams.some(t => t.id === team.id)) {
      const known = S.teams.find(t => t.id === team.id);
      url = known.group.endsWith('nations') ? 'https://a.espncdn.com/i/teamlogos/countries/500/' + known.abbreviation.toLowerCase() + '.png' : 'https://a.espncdn.com/i/teamlogos/soccer/500/' + known.id + '.png';
    }
    return '<span class="crest" aria-hidden="true">' + E(team.abbreviation || team.name.slice(0, 3).toUpperCase()) + (S.safeURL(url, true) ? '<img class="team-logo" src="' + E(url) + '" alt="" width="24" height="24" loading="lazy">' : '') + '</span>';
  }
  // Keep the initials visible if a provider crest is unavailable.
  document.addEventListener('error', event => { if (event.target?.classList?.contains('team-logo')) event.target.hidden = true; }, true);
  function eventCategory(e) {
    const team = S.teams.find(t => t.id === e.home.id || t.id === e.away.id);
    return team ? S.groups[team.group] : 'Football';
  }
  function eventTime(e) { return dateFormat.format(e.timestamp) + ' · ' + (e.timeTBD ? 'Time TBC' : timeFormat.format(e.timestamp)); }
  function feedProblem(e) {
    const key = e.completed ? 'results' : 'fixtures';
    return S.teams.some(t => (t.id === e.home.id || t.id === e.away.id) && state.schedules.get(t.id)?.[key]?.error);
  }
  function matchMarkup(e) {
    const showScore = e.completed || e.live;
    const row = team => '<div class="match-team' + (followed(team.id) ? ' followed' : '') + '">' + logo(team) + '<span class="match-name">' + E(team.name) + '</span>' + (showScore ? '<span class="score">' + E(team.score) + '</span>' : '') + '</div>';
    let badge = e.live ? 'LIVE · ' + e.detail : e.completed ? e.detail || 'FT' : e.special ? e.status : e.timeTBD ? 'Time TBC' : 'Upcoming';
    const penalties = e.home.penalties !== null && e.away.penalties !== null ? '<p>Penalties: ' + E(e.home.penalties) + '–' + E(e.away.penalties) + '</p>' : '';
    return '<div class="match-top"><span>' + E(eventCategory(e)) + '</span><span class="badge' + (e.live ? ' live' : '') + '">' + E(badge) + '</span></div><div class="match-teams">' + row(e.home) + row(e.away) + '</div><div class="match-meta"><p>' + E(eventTime(e)) + '</p><p>' + E(e.competition) + '</p>' + (e.venue ? '<p>' + E(e.venue) + '</p>' : '') + penalties + '</div>' + (e.link ? '<a class="match-link" href="' + E(e.link) + '">Match details ↗</a>' : '') + (feedProblem(e) ? '<p class="feed-warning">Refresh unavailable · previously loaded match</p>' : '');
  }
  function renderFilters() {
    $('team-filter').innerHTML = '<option value="all">All ' + (state.group === 'all' ? 'followed teams' : E(S.groups[state.group]).toLowerCase()) + '</option>' + eligibleTeams().map(t => '<option value="' + t.id + '">' + E(teamLabel(t)) + '</option>').join('');
    $('team-filter').value = state.team;
    document.querySelectorAll('[data-group]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.group === state.group)));
  }
  function fixtureRow(e) {
    const showScore = e.completed || e.live;
    const status = e.live ? e.detail || 'In play' : e.completed ? e.detail || 'FT' : e.special ? e.status : '';
    const time = e.timeTBD ? 'TBC' : timeFormat.format(e.timestamp);
    const side = (team, label) => '<div class="fixture-team' + (followed(team.id) ? ' followed' : '') + '">' + logo(team) + '<span class="fixture-name"><span class="sr-only">' + label + ': </span>' + E(team.name) + '</span>' + (showScore ? '<strong class="fixture-score">' + E(team.score) + '</strong>' : '') + '</div>';
    const penalties = e.home.penalties !== null && e.away.penalties !== null ? '<p class="fixture-note">Penalties: ' + E(e.home.penalties) + '–' + E(e.away.penalties) + '</p>' : '';
    return '<article class="fixture-row' + (e.live ? ' is-live' : '') + '"><div class="fixture-time">' + (e.live ? '<span class="fixture-live">Live</span>' : '') + (status ? '<span class="fixture-status">' + E(status) + '</span>' : '<time datetime="' + E(e.date) + '">' + E(time) + '</time><span class="fixture-time-label">' + (e.timeTBD ? 'Time to be confirmed' : 'Kick-off') + '</span>') + '</div><div class="fixture-teams">' + side(e.home, 'Home') + side(e.away, 'Away') + penalties + '</div><div class="fixture-context"><span class="fixture-category">' + E(eventCategory(e)) + '</span><span class="fixture-competition">' + E(e.competition) + '</span>' + (e.venue ? '<span class="fixture-venue">' + E(e.venue) + '</span>' : '') + '</div>' + (e.link ? '<a class="fixture-link" href="' + E(e.link) + '" aria-label="Match details: ' + E(e.home.name) + ' versus ' + E(e.away.name) + '"><span class="detail-label">Details</span><span aria-hidden="true">↗</span></a>' : '') + (feedProblem(e) ? '<p class="fixture-warning">Refresh unavailable · previously loaded match</p>' : '') + '</article>';
  }
  function matchDays(events) {
    const days = new Map();
    for (const e of events) {
      const day = dateFormat.format(e.timestamp);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(e);
    }
    return [...days].map(([day, matches]) => '<section class="match-day"><div class="match-day-heading"><h3>' + E(day) + '</h3><span>' + matches.length + (matches.length === 1 ? ' match' : ' matches') + '</span></div><div class="match-day-list">' + matches.map(fixtureRow).join('') + '</div></section>').join('');
  }
  function rebuildEvents() {
    const feeds = [];
    for (const values of state.schedules.values()) for (const key of ['fixtures', 'results']) if (values[key]?.data) feeds.push(values[key].data);
    state.events = S.combineEvents(feeds);
  }
  function renderMatches() {
    const ids = selectedTeams().map(t => t.id);
    const upcoming = S.selectEvents(state.events, ids, 'upcoming');
    const recent = S.selectEvents(state.events, ids, 'recent');
    const live = S.selectEvents(state.events, ids, 'live');
    const next = live[0] || upcoming.find(e => !e.special) || upcoming[0];
    $('next-heading').textContent = live.length ? 'On the pitch now' : 'Next up';
    $('next-match').innerHTML = next ? matchMarkup(next) : '<p class="muted">' + (state.loading ? 'Checking your fixtures…' : 'No upcoming fixture in the available feeds.') + '</p>';
    $('latest-match').innerHTML = recent[0] ? matchMarkup(recent[0]) : '<p class="muted">' + (state.loading ? 'Checking your results…' : 'No recent result in the available feeds.') + '</p>';
    const events = S.filterMatches(state.view === 'recent' ? recent : state.view === 'live' ? live : upcoming, state);
    const visible = events.slice(0, state.limit);
    const failed = selectedTeams().filter(t => ['fixtures', 'results'].some(key => state.schedules.get(t.id)?.[key]?.error));
    const missing = selectedTeams().some(t => !state.schedules.get(t.id)?.fixtures || !state.schedules.get(t.id)?.results);
    $('live-count').textContent = live.length;
    $('match-total').textContent = state.loading && missing ? '…' : events.length;
    $('reset-filters').hidden = !state.search && state.date === 'all' && state.team === 'all' && state.group === 'all';
    $('matches-meta').textContent = 'All competitions · ' + events.length + (state.view === 'recent' ? ' results' : state.view === 'live' ? ' live matches' : ' upcoming matches') + (failed.length ? ' · Partial coverage: ' + failed.map(teamLabel).join(', ') : missing ? ' · Loading remaining teams…' : '') + (events.length > visible.length ? ' · Showing ' + visible.length : '');
    $('match-list').innerHTML = visible.length ? matchDays(visible) : '<p class="empty">' + (state.loading && missing ? 'Loading your matches…' : failed.length ? 'Match feeds are unavailable for some selected teams. Try Refresh or use the ESPN team links below.' : state.search || state.date !== 'all' ? 'No matches fit these filters. Try another date or clear your filters.' : state.view === 'live' ? 'None of your selected teams are playing live right now.' : state.view === 'recent' ? 'No results published in the current schedule feeds.' : 'No upcoming fixtures published for your selected teams.') + '</p>';
    $('match-list').setAttribute('aria-busy', String(state.loading));
    $('show-more').hidden = visible.length >= events.length;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  }
  function renderTable() {
    document.querySelectorAll('[data-league]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.league === state.league)));
    const entry = state.tables.get(state.league);
    const name = S.leagues.find(l => l.id === state.league).name;
    const source = 'https://www.espn.com/soccer/standings/_/league/' + state.league;
    $('league-tables').setAttribute('aria-busy', String(state.loading && !entry));
    if (!entry?.data?.length) {
      $('table-status').textContent = entry?.error ? name + ': table feed unavailable.' : entry ? name + ': no current table published.' : 'Loading ' + name + '…';
      $('league-tables').innerHTML = entry ? '<p class="empty"><a href="' + source + '">Open the ESPN table ↗</a></p>' : '';
      return;
    }
    $('table-status').textContent = name + ' · ' + (entry.data[0].season || 'Current provider season') + ' · Checked ' + stampFormat.format(entry.at) + (entry.error ? ' · Refresh failed; previously loaded table shown.' : '');
    $('league-tables').innerHTML = entry.data.map(group => '<div class="table-panel"><div class="table-heading"><h3>' + E(group.name) + '</h3><a href="' + source + '">ESPN table ↗</a></div><div class="table-scroll" tabindex="0" role="region" aria-label="' + E(group.name) + ' table, scroll horizontally for more columns"><table><caption class="sr-only">' + E(group.name) + '; your followed clubs are highlighted.</caption><thead><tr><th scope="col">#</th><th class="team-cell" scope="col">Team</th><th scope="col">P</th><th class="extra-stat" scope="col">W</th><th class="extra-stat" scope="col">D</th><th class="extra-stat" scope="col">L</th><th class="extra-stat" scope="col">GF</th><th class="extra-stat" scope="col">GA</th><th scope="col">GD</th><th scope="col">Pts</th></tr></thead><tbody>' + group.rows.map(r => '<tr' + (followed(r.id) ? ' class="followed"' : '') + '><td>' + E(r.rank) + '</td><th class="team-cell" scope="row"><span class="table-team">' + logo(r) + '<span>' + E(r.name) + (followed(r.id) ? '<span class="sr-only"> · Followed team</span>' : '') + '</span></span></th>' + ['played', 'wins', 'draws', 'losses', 'gf', 'ga', 'gd', 'points'].map(key => '<td' + (key === 'points' ? ' class="points"' : ['wins', 'draws', 'losses', 'gf', 'ga'].includes(key) ? ' class="extra-stat"' : '') + '>' + E(r[key]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>').join('');
  }
  function renderTeams() {
    $('team-count').textContent = eligibleTeams().length + ' followed teams';
    $('team-cards').innerHTML = eligibleTeams().map(t => {
      const feeds = state.schedules.get(t.id);
      const next = S.selectEvents(state.events, [t.id], 'live')[0] || S.selectEvents(state.events, [t.id], 'upcoming').find(e => !e.special);
      const recent = S.selectEvents(state.events, [t.id], 'recent')[0];
      const opponent = next && (next.home.id === t.id ? next.away : next.home);
      let position = '';
      const table = state.tables.get(t.league);
      for (const group of table?.data || []) {
        const row = group.rows.find(r => r.id === t.id);
        if (row) position = '<p class="position">#' + E(row.rank) + ' · ' + E(t.league === 'usa.1' ? group.name : S.leagues.find(l => l.id === t.league).name) + ' · ' + E(row.points) + ' pts' + (table.error ? ' · Older table' : '') + '</p>';
      }
      const errors = ['fixtures', 'results'].filter(key => feeds?.[key]?.error);
      const stamps = ['fixtures', 'results'].map(key => feeds?.[key]?.at).filter(Boolean);
      const lastChecked = stamps.length ? Math.min(...stamps) : null;
      const latest = recent ? '<p class="meta">Last: ' + E(recent.home.name) + ' ' + E(recent.home.score) + '–' + E(recent.away.score) + ' ' + E(recent.away.name) + '</p>' : '';
      return '<article class="team-card' + (state.team === t.id ? ' selected' : '') + '"><button type="button" data-team="' + t.id + '" aria-label="Show matches for ' + E(teamLabel(t)) + '">' + logo(t) + '<span>' + E(t.name) + '</span></button><p class="category">' + E(S.groups[t.group]) + '</p>' + position + '<p class="team-next">' + (next ? (next.live ? 'Live: ' : 'Next: ') + E(opponent.name) + ' · ' + (next.home.id === t.id ? 'Home' : 'Away') : !feeds?.fixtures ? 'Checking fixtures…' : feeds.fixtures.error ? 'Fixture feed unavailable' : 'No next fixture published') + '</p>' + (next ? '<p class="meta">' + E(eventTime(next)) + '</p>' : '') + latest + (lastChecked ? '<p class="meta">Checked ' + E(stampFormat.format(lastChecked)) + '</p>' : '') + (errors.length ? '<p class="feed-warning">' + (errors.includes('fixtures') ? 'Fixtures' : '') + (errors.length === 2 ? ' &amp; results' : errors.includes('results') ? 'Results' : '') + ': refresh unavailable' + (lastChecked ? ' · older data may be shown' : '') + '</p>' : '') + '<a class="match-link" href="https://www.espn.com/soccer/team/fixtures/_/id/' + t.id + '">ESPN fixtures ↗</a></article>';
    }).join('');
  }
  function renderStatus() {
    let failures = 0;
    for (const feeds of state.schedules.values()) for (const key of ['fixtures', 'results']) if (feeds[key]?.error) failures++;
    for (const table of state.tables.values()) if (table.error) failures++;
    $('feed-status').textContent = state.loading ? 'Refreshing… ' + state.done + '/' + (S.teams.length * 2 + S.leagues.length) + ' feeds checked' : failures ? 'Updated available feeds · ' + failures + ' unavailable. See affected teams and tables.' : 'Fixtures, results & tables checked ' + stampFormat.format(Date.now());
    $('refresh').disabled = state.loading;
  }
  function render() {
    rebuildEvents(); renderStatus(); renderMatches(); renderTable(); renderTeams();
    window.GregleSportsLive?.update(state.events, { staleIDs: S.teams.filter(t => ['fixtures', 'results'].every(key => state.schedules.get(t.id)?.[key]?.error)).map(t => t.id) });
  }
  let queued = false;
  function queueRender() { if (!queued) { queued = true; setTimeout(() => { queued = false; render(); }, 80); } }
  async function request(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('Feed returned ' + response.status);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function loadTeam(team, key) {
    const feeds = state.schedules.get(team.id) || {};
    state.schedules.set(team.id, feeds);
    try {
      const payload = await request('https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/' + team.id + '/schedule?fixture=' + (key === 'fixtures' ? 'true' : 'false'));
      if (!Array.isArray(payload.events) || String(payload.team?.id) !== team.id) throw new Error('Invalid team schedule');
      feeds[key] = { data: payload.events, at: Date.now(), error: false };
    } catch (_) { feeds[key] = { ...feeds[key], error: true }; }
  }
  async function loadTable(league) {
    try {
      const payload = await request('https://site.api.espn.com/apis/v2/sports/soccer/' + league.id + '/standings');
      if (!Array.isArray(payload.children) && !payload.standings) throw new Error('Invalid table');
      state.tables.set(league.id, { data: S.standings(payload), at: Date.now(), error: false });
    } catch (_) { state.tables.set(league.id, { ...state.tables.get(league.id), error: true }); }
  }
  async function refresh() {
    if (state.loading) return;
    window.GregleSportsLive?.refresh();
    state.loading = true; state.done = 0; render();
    const jobs = [...S.leagues.map(l => () => loadTable(l)), ...S.teams.flatMap(t => ['fixtures', 'results'].map(key => () => loadTeam(t, key)))];
    let index = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (index < jobs.length) { await jobs[index++](); state.done++; queueRender(); }
    }));
    state.loading = false; render();
  }
  $('group-filters').addEventListener('click', e => {
    const button = e.target.closest('[data-group]');
    if (!button || !(button.dataset.group === 'all' || S.groups[button.dataset.group])) return;
    state.group = button.dataset.group; state.team = 'all'; state.limit = 12;
    renderFilters(); saveFilters(); render();
  });
  $('team-filter').addEventListener('change', () => {
    const value = $('team-filter').value;
    if (value !== 'all' && !eligibleTeams().some(t => t.id === value)) return;
    state.team = value; state.limit = 12; saveFilters(); render();
  });
  $('team-cards').addEventListener('click', e => {
    const b = e.target.closest('[data-team]'); if (!b || !eligibleTeams().some(t => t.id === b.dataset.team)) return;
    state.team = b.dataset.team; state.limit = 12; $('team-filter').value = state.team; saveFilters(); render();
    $('matches-heading').scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  });
  $('match-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b || !['upcoming', 'recent', 'live'].includes(b.dataset.view)) return;
    state.view = b.dataset.view; state.limit = 12; renderMatches();
  });
  $('league-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-league]'); if (!b || !S.leagues.some(l => l.id === b.dataset.league)) return;
    state.league = b.dataset.league; saveFilters(); renderTable();
  });
  $('show-more').addEventListener('click', () => { state.limit += 18; renderMatches(); });
  $('match-search').addEventListener('input', () => { state.search = $('match-search').value; state.limit = 12; renderMatches(); });
  $('date-filter').addEventListener('change', () => { state.date = $('date-filter').value; state.limit = 12; renderMatches(); });
  $('reset-filters').addEventListener('click', () => {
    state.search = ''; state.date = 'all'; state.group = 'all'; state.team = 'all'; state.limit = 12;
    $('match-search').value = ''; $('date-filter').value = 'all'; renderFilters(); saveFilters(); render();
  });
  $('table-detail-toggle').addEventListener('click', () => {
    const button = $('table-detail-toggle');
    const expanded = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(expanded)); button.textContent = expanded ? 'Fewer stats' : 'More stats';
    document.querySelector('.standings-section').classList.toggle('expanded-stats', expanded);
  });
  $('refresh').addEventListener('click', refresh);
  let lastAuto = Date.now();
  setInterval(() => { if (!document.hidden) { lastAuto = Date.now(); refresh(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastAuto >= 60000) { lastAuto = Date.now(); refresh(); } });
  renderFilters(); render(); refresh();
})();

