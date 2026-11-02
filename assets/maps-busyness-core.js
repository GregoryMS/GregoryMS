((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleBusynessCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const pacific = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'});
  const day = time => pacific.format(time);
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 250) : '';
  function identity(place) {
    if (!place?.osm || !clean(place.name) || !Number.isFinite(place.lat) || !Number.isFinite(place.lng) || Math.abs(place.lat) > 90 || Math.abs(place.lng) > 180) return null;
    return place.osm;
  }
  function query(place) {
    const tags = place.tags || {};
    const address = [[clean(tags['addr:housenumber']), clean(tags['addr:street'])].filter(Boolean).join(' '), clean(tags['addr:city']), clean(tags['addr:postcode'])].filter(Boolean).join(', ');
    return [clean(place.name), address].filter(Boolean).join(', ');
  }
  function googleURL(place) {
    const url = new URL('https://www.google.com/maps/search/');
    url.searchParams.set('api', '1');
    url.searchParams.set('query', query(place) + ` near ${place.lat.toFixed(5)},${place.lng.toFixed(5)}`);
    return url.href;
  }
  function nextReset(now = Date.now()) {
    // Find the next Pacific midnight, including 23/25-hour daylight-saving days.
    let low = now, high = now + 27 * 3600000;
    const current = day(now);
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (day(mid) === current) low = mid;
      else high = mid;
    }
    return high;
  }
  function pauseUntil(value, now = Date.now()) {
    try {
      const until = JSON.parse(value)?.until;
      return Number.isFinite(until) && until > now && until <= now + 27 * 3600000 ? until : 0;
    } catch { return 0; }
  }
  return {identity, query, googleURL, nextReset, pauseUntil};
});
