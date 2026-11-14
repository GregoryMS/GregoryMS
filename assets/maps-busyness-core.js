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
  function appleURL(place) {
    const url = new URL('https://maps.apple.com/place');
    url.searchParams.set('coordinate', `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`);
    url.searchParams.set('name', query(place));
    return url.href;
  }
  function singleMatch(selected, places) {
    if (!identity(selected) || !Array.isArray(places) || places.length !== 1) return null;
    const place = places[0];
    if (!place?.id || !place.location) return null;
    try {
      const lat = typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat;
      const lng = typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      const radians = Math.PI / 180;
      const a = Math.sin((lat - selected.lat) * radians / 2) ** 2 + Math.cos(lat * radians) * Math.cos(selected.lat * radians) * Math.sin((lng - selected.lng) * radians / 2) ** 2;
      const distance = 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, a)));
      // Google searched the business name/address. Only skip confirmation for
      // a unique result close to the OSM pin; nearby branches can share a name.
      return distance <= 150 ? place : null;
    } catch { return null; }
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
  return {identity, query, googleURL, appleURL, singleMatch, nextReset, pauseUntil};
});
