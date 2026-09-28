(function (root) {
  'use strict';
  const HOUR = 3600000;
  function officialURL(value, host, base = `https://${host}/`) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, base);
      if (url.hostname !== host || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      url.protocol = 'https:';
      return url.href;
    } catch (_) { return null; }
  }
  function earthquakes(data) {
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || !Number.isFinite(data.metadata?.generated)) throw new Error('Invalid earthquake feed');
    return data.features.flatMap(feature => {
      const p = feature?.properties, c = feature?.geometry?.coordinates;
      if (feature?.geometry?.type !== 'Point' || !p || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90 || !Number.isFinite(p.time) || !Number.isFinite(p.mag)) return [];
      if (p.type && p.type !== 'earthquake') return [];
      return [{ id:String(feature.id), magnitude:p.mag, place:String(p.place || 'Location not reported'), time:p.time,
        longitude:c[0], latitude:c[1], depth:Number.isFinite(c[2]) ? c[2] : null,
        url:officialURL(p.url, 'earthquake.usgs.gov') || 'https://earthquake.usgs.gov/earthquakes/map/' }];
    }).sort((a,b) => b.time - a.time);
  }
  function filterEarthquakes(events, magnitude, period, now = Date.now()) {
    return events.filter(e => e.magnitude >= magnitude && e.time >= now - HOUR * (period === 'week' ? 168 : 24) && e.time <= now + 60000);
  }
  function tsunamiKind(value) {
    const category = String(value || '').trim();
    if (/^(Information|Cancellation|No Threat)$/i.test(category)) return null;
    if (/^(Warning|Advisory|Watch)$/i.test(category)) return category[0].toUpperCase() + category.slice(1).toLowerCase();
    if (/^(Potential Threat|Threat|>3\.0 meters|1-3 meters|0\.3-1 meters|0-0\.3 meters)$/i.test(category)) return 'Threat';
    throw new Error('Unrecognised tsunami status');
  }
  const tsunamiProducts = ['PAAQWEAK51','PAAQWEAK53','PAAQWEXX32','PHEBWEPA40','PHEBWEPA42','PHEBWEHW40','PHEBWEHW42','PHEBWEZS40','PHEBWEZS42','PHEBWEGM40','PHEBWEGM42','PHEBWECA40','PHEBWECA41','PHEBWECA42','PHEBWECA43'];
  function tsunamiBulletin(item, product) {
    // The same current regional products used by tsunami.gov. Alerts persist
    // until replaced/cancelled; old bulletin issue dates are not fetch dates.
    if (!item || item.TWCID + item.WMOID !== product || !Number.isFinite(Date.parse(item.bulletinIssueTime)) || !Array.isArray(item.alerts?.areaList)) throw new Error('Invalid tsunami bulletin');
    const areas = item.alerts.areaList.flat();
    const segments = item.segments || [];
    if (!Array.isArray(segments) || areas.some(area => !area || typeof area !== 'object')) throw new Error('Invalid tsunami areas');
    // The persistent area list includes regions left in effect by earlier messages.
    const entries = [...areas, ...segments];
    const active = entries.map(entry => ({ entry, kind:tsunamiKind(entry.category) })).filter(x => x.kind);
    const rank = { Watch:1, Advisory:2, Threat:3, Warning:4 };
    active.sort((a,b) => rank[b.kind] - rank[a.kind]);
    const url = officialURL(`${item.eventDir}${item.WMOID}.txt`, 'www.tsunami.gov');
    if (!url || !String(item.eventDir).startsWith('/events/')) throw new Error('Invalid bulletin link');
    const coordinate = (value, limit) => value !== null && value !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit ? Number(value) : null;
    return { id:product, kind:active[0]?.kind || null, issued:Date.parse(item.bulletinIssueTime),
      place:String(item.quakeLocation || 'See official bulletin'), latitude:coordinate(item.eventLat,90), longitude:coordinate(item.eventLon,180),
      areas:[...new Set(active.map(({entry}) => entry.headline || [entry.bkp_start_location,entry.bkp_end_location].filter(Boolean).join(' to ') || entry.zone || 'See official bulletin for affected areas'))].map(String),
      instructions:[...new Set(active.map(({entry}) => entry.recommendedActions).filter(Boolean))].map(String),
      links:[{ label:item.WMOID, url }] };
  }
  function fresh(checked, now = Date.now()) { return Number.isFinite(checked) && now >= checked - 60000 && now - checked <= 180000; }
  const api = { earthquakes, filterEarthquakes, tsunamiBulletin, tsunamiProducts, tsunamiKind, officialURL, fresh };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GregleEarthquakes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
