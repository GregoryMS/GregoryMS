((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleTransitCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const endpoint = 'https://api.transitous.org/api/';
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
  const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
  const valid = (lat, lon) => typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const regions = {bc: [-139.1, 48.25, -114, 60], london: [-0.52, 51.28, 0.34, 51.7]};
  function region(lat, lon) {
    if (!valid(lat, lon)) return null;
    return Object.keys(regions).find(key => { const [w,s,e,n] = regions[key]; return lon >= w && lon <= e && lat >= s && lat <= n; }) || null;
  }
  function area(bounds, zoom) {
    if (zoom < 13 || !bounds.every(Number.isFinite)) return null;
    const [west,south,east,north] = bounds, middle = wrap((west + east) / 2), scope = region((south + north) / 2, middle);
    if (!scope || east <= west || north <= south || east - west > .5 || north - south > .3) return null;
    const [w,s,e,n] = regions[scope], step = .005;
    const snap = (value, up) => Number(((up ? Math.ceil(value / step) : Math.floor(value / step)) * step).toFixed(5));
    const box = [Math.max(w, snap(middle - (east-west)/2 - step, false)), Math.max(s, snap(south-step, false)), Math.min(e, snap(middle + (east-west)/2 + step, true)), Math.min(n, snap(north+step, true))];
    return {scope, box};
  }
  function stopsURL(area) {
    const [w,s,e,n] = area.box, url = new URL('v6/map/stops', endpoint);
    url.search = new URLSearchParams({min: `${s},${w}`, max: `${n},${e}`, grouped: 'true'});
    return url.href;
  }
  function readStops(data, area) {
    if (!Array.isArray(data) || data.length > 10000) throw Error('Invalid transit stops');
    const seen = new Set(), [w,s,e,n] = area.box;
    return data.filter(item => {
      const id = clean(item?.stopId), allowed = area.scope === 'bc' ? id.startsWith('ca-bc-') : id.startsWith('gb-');
      if (!allowed || !clean(item?.name) || !valid(item.lat,item.lon) || item.lat < s || item.lat > n || item.lon < w || item.lon > e || seen.has(id)) return false;
      seen.add(id); return true;
    }).map(item => ({id:clean(item.stopId), name:clean(item.name), lat:item.lat, lng:item.lon, code:clean(item.stopCode), modes:Array.isArray(item.modes) ? item.modes.filter(mode => typeof mode === 'string').slice(0,12) : [], scope:area.scope, zone:clean(item.tz) || (area.scope === 'london' ? 'Europe/London' : 'America/Vancouver')}));
  }
  function departuresURL(stop, time, cursor = '') {
    const url = new URL('v6/stoptimes',endpoint);
    url.search = new URLSearchParams({stopId:stop.id, time, n:'24', arriveBy:'false'});
    if (cursor) url.searchParams.set('pageCursor',cursor);
    return url.href;
  }
  function safeURL(raw) {
    try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function readDepartures(data, stop) {
    if (!Array.isArray(data?.stopTimes) || data.stopTimes.length > 1000) throw Error('Invalid departure board');
    const rows = [], seen = new Set(), alerts = new Set();
    let zone = clean(data.place?.tz);
    for (const item of data.stopTimes) {
      const place = item?.place;
      // Some station groups also include connected neighbouring stations. Keep
      // this stop and its platforms, rather than silently showing another stop.
      if (!place || place.stopId !== stop.id && place.parentId !== stop.id) continue;
      zone ||= clean(place.tz);
      const scheduled = Date.parse(place.scheduledDeparture), estimated = Date.parse(place.departure);
      if (!Number.isFinite(scheduled) || place.pickupType === 'NOT_ALLOWED') continue;
      const live = item.realTime === true && place.departureTimestampReason !== 'NO_RT_DATA' && Number.isFinite(estimated), time = live ? estimated : scheduled;
      const key = `${item.tripId}|${place.stopId}|${scheduled}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const alert of (Array.isArray(place.alerts) ? place.alerts : []).slice(0,10)) {
        const text = clean(alert?.descriptionText || alert?.headerText); if (text) alerts.add(text);
      }
      rows.push({time, scheduled, live, cancelled:item.cancelled === true || item.tripCancelled === true || place.cancelled === true,
        route:clean(item.displayName || item.routeShortName || item.routeLongName || item.mode) || 'Transit',
        headsign:clean(item.headsign || item.tripTo?.name) || 'Destination not supplied',
        platform:clean(place.track || place.scheduledTrack), stopName:clean(place.name),
        operator:clean(item.agencyName), url:safeURL(item.routeUrl || item.agencyUrl)});
    }
    return {rows:rows.sort((a,b) => a.time-b.time).slice(0,50), alerts:[...alerts].slice(0,4), next:clean(data.nextPageCursor), zone:zone||stop.zone};
  }
  const major = stop => stop.modes.some(mode => mode !== 'BUS' && mode !== 'COACH');
  function clock(value, zone) {
    try { return new Date(value).toLocaleString(undefined,{timeZone:zone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}); }
    catch { return new Date(value).toLocaleString(undefined,{timeZone:'UTC',hourCycle:'h23'}) + ' UTC'; }
  }
  return {region, area, stopsURL, readStops, departuresURL, readDepartures, safeURL, major, clock};
});
