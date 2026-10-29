(function (root) {
  'use strict';
  const leagues = [
    { id: 'eng.1', name: 'Premier League' },
    { id: 'ger.1', name: 'Bundesliga' },
    { id: 'usa.1', name: 'MLS' },
    { id: 'eng.w.1', name: 'Women’s Super League' },
    { id: 'uefa.champions', name: 'UEFA Champions League' }
  ];
  const teams = [
    ['331', 'Brighton', 'men-clubs', 'eng.1', 'BHA'],
    ['132', 'Bayern Munich', 'men-clubs', 'ger.1', 'FCB'],
    ['9727', 'Vancouver Whitecaps', 'men-clubs', 'usa.1', 'VAN'],
    ['359', 'Arsenal', 'men-clubs', 'eng.1', 'ARS'],
    ['382', 'Manchester City', 'men-clubs', 'eng.1', 'MCI'],
    ['306', 'Hull City', 'men-clubs', 'eng.1', 'HUL'],
    ['361', 'Newcastle United', 'men-clubs', 'eng.1', 'NEW'],
    ['19970', 'Chelsea', 'women-clubs', 'eng.w.1', 'CHE'],
    ['19257', 'Manchester City', 'women-clubs', 'eng.w.1', 'MCI'],
    ['19973', 'Arsenal', 'women-clubs', 'eng.w.1', 'ARS'],
    ['20103', 'Bayern Munich', 'women-clubs', null, 'FCB'],
    ['19976', 'Brighton', 'women-clubs', 'eng.w.1', 'BHA'],
    ['206', 'Canada', 'men-nations', null, 'CAN'],
    ['464', 'Norway', 'men-nations', null, 'NOR'],
    ['580', 'Scotland', 'men-nations', null, 'SCO'],
    ['466', 'Sweden', 'men-nations', null, 'SWE'],
    ['448', 'England', 'men-nations', null, 'ENG'],
    ['2753', 'Canada', 'women-nations', null, 'CAN'],
    ['2762', 'Norway', 'women-nations', null, 'NOR'],
    ['12633', 'Scotland', 'women-nations', null, 'SCO'],
    ['2764', 'Sweden', 'women-nations', null, 'SWE'],
    ['5159', 'England', 'women-nations', null, 'ENG']
  ].map(([id, name, group, league, abbreviation]) => ({ id, name, group, league, abbreviation }));
  const groups = { 'men-clubs': 'Men’s clubs', 'women-clubs': 'Women’s clubs', 'men-nations': 'Men’s national teams', 'women-nations': 'Women’s national teams' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function safeURL(value, image = false) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && (image ? u.hostname === 'a.espncdn.com' : /(^|\.)espn\.(com|co\.uk)$/.test(u.hostname)) ? u.href : '';
    } catch (_) { return ''; }
  }
  function score(value) {
    const raw = value && typeof value === 'object' ? value.displayValue ?? value.value : value;
    return raw === null || raw === undefined || raw === '' ? '—' : String(raw);
  }
  function event(raw) {
    const c = raw?.competitions?.[0];
    if (!raw?.id || !c || !Array.isArray(c.competitors)) return null;
    const home = c.competitors.find(x => x.homeAway === 'home');
    const away = c.competitors.find(x => x.homeAway === 'away');
    if (!home?.team?.id || !away?.team?.id) return null;
    const status = c.status || raw.status || {};
    const type = status.type || {};
    const participant = x => ({ id: String(x.team.id), name: x.team.displayName || x.team.shortDisplayName || 'Unknown team', abbreviation: x.team.abbreviation || '', logo: safeURL(x.team.logos?.[0]?.href || x.team.logo, true), score: score(x.score), penalties: x.shootoutScore === undefined ? null : score(x.shootoutScore) });
    const date = c.date || raw.date;
    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp)) return null;
    const special = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|ABANDONED/.test(type.name || '');
    return { id: String(raw.id), date, timestamp, home: participant(home), away: participant(away),
      completed: type.completed === true, live: type.state === 'in' && !special,
      special, state: type.state || 'pre', status: type.description || 'Scheduled',
      detail: type.state === 'in' ? status.displayClock || type.shortDetail || 'Live' : type.shortDetail || type.description || '',
      timeTBD: c.dateValid === false || c.timeValid === false,
      competition: raw.league?.name || raw.season?.displayName || 'Football', leagueSlug: raw.league?.slug || '',
      venue: c.venue?.fullName || '', link: safeURL(raw.links?.find(x => x.rel?.includes('summary'))?.href || raw.links?.[0]?.href) };
  }
  function combineEvents(feeds) {
    const byID = new Map();
    for (const feed of feeds) for (const raw of feed || []) {
      const e = event(raw);
      if (!e) continue;
      const old = byID.get(e.id);
      // A fixture copy can lag behind the result feed; prefer the progressed status.
      const weight = x => x.completed ? 3 : x.live ? 2 : x.special ? 1 : 0;
      if (!old || weight(e) >= weight(old)) byID.set(e.id, e);
    }
    return [...byID.values()];
  }
  function selectEvents(events, ids, view, now = Date.now()) {
    const selected = new Set(ids.map(String));
    return events.filter(e => (selected.has(e.home.id) || selected.has(e.away.id)) &&
      (view === 'live' ? e.live : view === 'recent' ? e.completed : !e.completed && !e.live && e.state !== 'post' && (e.timestamp >= now - 6 * 3600000 || (e.special && e.timestamp >= now - 7 * 86400000))))
      .sort((a, b) => view === 'recent' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
  }
  function standings(payload) {
    const result = [];
    function walk(node) {
      if (Array.isArray(node?.standings?.entries) && node.standings.entries.length) {
        const rows = node.standings.entries.map((entry, index) => {
          const stat = name => { const s = entry.stats?.find(x => x.name === name); return s ? s.displayValue ?? s.value ?? '—' : '—'; };
          const rank = Number(entry.stats?.find(x => x.name === 'rank')?.value);
          return { id: String(entry.team?.id || ''), name: entry.team?.displayName || 'Unknown team', logo: safeURL(entry.team?.logos?.[0]?.href, true),
            rank: Number.isFinite(rank) && rank > 0 ? rank : index + 1,
            played: stat('gamesPlayed'), wins: stat('wins'), draws: stat('ties'), losses: stat('losses'), gf: stat('pointsFor'), ga: stat('pointsAgainst'), gd: stat('pointDifferential'), points: stat('points'), note: entry.note?.description || '' };
        }).sort((a, b) => a.rank - b.rank);
        result.push({ name: node.name || node.standings.seasonDisplayName || 'Standings', season: node.standings.seasonDisplayName || String(node.standings.season || ''), rows });
      }
      for (const child of node?.children || []) walk(child);
    }
    walk(payload);
    return result;
  }
  function filterMatches(events, options = {}, now = Date.now()) {
    const query = String(options.search || '').trim().toLocaleLowerCase();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + (options.date === 'week' ? 7 : 1));
    return events.filter(e => (!query || [e.home.name, e.away.name, e.competition, e.venue].join(' ').toLocaleLowerCase().includes(query)) &&
      (!['today', 'week'].includes(options.date) || e.timestamp >= start.getTime() && e.timestamp < end.getTime()));
  }
  const api = { teams, leagues, groups, escape, safeURL, event, combineEvents, selectEvents, standings, filterMatches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GregleSports = api;
})(globalThis);
