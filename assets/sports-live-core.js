(function (root) {
  'use strict';
  const countries = [{ code: 'GB', name: 'UK' }, { code: 'CA', name: 'Canada' }, { code: 'NO', name: 'Norway' }, { code: 'SE', name: 'Sweden' }, { code: 'DE', name: 'Germany' }];
  const metrics = [
    ['possessionPct', 'Possession', true], ['totalShots', 'Shots'], ['shotsOnTarget', 'On target'],
    ['wonCorners', 'Corners'], ['foulsCommitted', 'Fouls'], ['yellowCards', 'Yellow cards'],
    ['redCards', 'Red cards'], ['offsides', 'Offsides']
  ];
  function summary(payload, match, sports) {
    const header = payload?.header;
    if (String(header?.id) !== match.id) throw new Error('Wrong match summary');
    const e = sports.event({ ...header, league: header.leagues?.[0] });
    if (!e || e.home.id !== match.home.id || e.away.id !== match.away.id) throw new Error('Wrong match teams');
    const boxes = payload.boxscore?.teams || [];
    function stat(id, name, percent) {
      const value = boxes.find(t => String(t.team?.id) === id)?.statistics?.find(s => s.name === name)?.displayValue;
      if (value === null || value === undefined || value === '') return '—';
      return String(value) + (percent && !String(value).includes('%') ? '%' : '');
    }
    const stats = metrics.map(([name, label, percent]) => ({ label, home: stat(e.home.id, name, percent), away: stat(e.away.id, name, percent) }));
    return { event: { ...match, ...e, competition: match.competition, leagueSlug: match.leagueSlug }, stats, hasStats: stats.some(s => s.home !== '—' || s.away !== '—') };
  }
  function identity(name) {
    const women = /\(w\)|\bwomen(?:'s)?\b|\bladies\b/i.test(name || '');
    let key = String(name || '').replace(/\(w\)|\bwomen(?:'s)?\b|\bladies\b/gi, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const aliases = { hull: 'hullcity', newcastle: 'newcastleunited', brightonhovealbion: 'brighton', brightonandhovealbion: 'brighton', bayernmunich: 'bayernmunchen', fcbayernmunchen: 'bayernmunchen', mancity: 'manchestercity', vancouverwhitecapsfc: 'vancouverwhitecaps', whitecaps: 'vancouverwhitecaps', czechrepublic: 'czechia', stlouiscitysc: 'stlouiscity', '1fcmagdeburg': 'magdeburg', nottmforest: 'nottinghamforest', manunited: 'manchesterunited' };
    key = aliases[key] || key;
    return { key, women };
  }
  function broadcastListings(snapshot, match, sports, now = Date.now()) {
    const team = sports.teams.find(t => t.id === match.home.id || t.id === match.away.id);
    const women = team?.group.startsWith('women') || false;
    return countries.map(country => {
      const data = snapshot?.countries?.[country.code];
      const checked = Date.parse(data?.checkedAt);
      const fresh = Number.isFinite(checked) && checked <= now + 5 * 60000 && now - checked <= 6 * 3600000;
      const channels = new Set();
      if (fresh && !match.timeTBD && Array.isArray(data?.listings)) for (const row of data.listings) {
        if (!row || !Array.isArray(row.channels)) continue;
        const home = identity(row.home), away = identity(row.away);
        // Programme start may include pre-match coverage; names, sides and gender must also match.
        if (home.women !== women || away.women !== women || home.key !== identity(match.home.name).key || away.key !== identity(match.away.name).key || Math.abs(Date.parse(row.start) - match.timestamp) > 90 * 60000 || !Number.isFinite(Date.parse(row.start))) continue;
        for (const channel of row.channels || []) if (typeof channel === 'string' && channel.trim()) channels.add(channel.trim());
      }
      return { ...country, channels: [...channels].sort(), fresh, checkedAt: fresh ? checked : null, error: Boolean(data?.error), source: 'https://www.fotmob.com/tv-guide/' + country.code.toLowerCase() };
    });
  }
  const api = { countries, metrics, summary, identity, broadcastListings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GregleSportsLiveCore = api;
})(globalThis);

