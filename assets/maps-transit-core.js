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
    url.search = new URLSearchParams({min: `${s},${w}`, max: `${n},${e}`, grouped: 'false'});
    return url.href;
  }
  function readStops(data, area) {
    if (!Array.isArray(data) || data.length > 10000) throw Error('Invalid transit stops');
    const seen = new Set(), [w,s,e,n] = area.box;
    const stops = data.filter(item => {
      const id = clean(item?.stopId), allowed = area.scope === 'bc' ? id.startsWith('ca-bc-') : id.startsWith('gb-');
      if (!allowed || !clean(item?.name) || !valid(item.lat,item.lon) || item.lat < s || item.lat > n || item.lon < w || item.lon > e || seen.has(id)) return false;
      seen.add(id); return true;
    }).map(item => ({id:clean(item.stopId), parent:clean(item.parentId), name:clean(item.name), lat:item.lat, lng:item.lon, code:clean(item.stopCode), platform:clean(item.track || item.scheduledTrack), modes:Array.isArray(item.modes) ? item.modes.filter(mode => typeof mode === 'string').slice(0,12) : [], scope:area.scope, zone:clean(item.tz) || (area.scope === 'london' ? 'Europe/London' : 'America/Vancouver'), importance:Number.isFinite(item.importance)?item.importance:0}));
    const result = [];
    for (const stop of stops) {
      // Keep distinct bus boarding codes/bays even when the provider groups
      // them by name. Rail/ferry platforms still share a parent-station board.
      if (major(stop) && stop.parent) { stop.id=stop.parent; stop.code=''; stop.platform=''; }
      const previous=result.findIndex(other=>other.id===stop.id || codedBus(stop)&&codedBus(other)&&other.code===stop.code&&matchesStop({stopId:stop.id,stopCode:stop.code,lat:stop.lat,lon:stop.lng},other));
      if (previous<0) result.push(stop);
      else if (stop.importance>result[previous].importance) result[previous]=stop;
    }
    return result;
  }
  function departuresURL(stop, time, cursor = '') {
    const url = new URL('v6/stoptimes',endpoint);
    url.search = new URLSearchParams({stopId:stop.id, time, n:'24', arriveBy:'false'});
    // Shared bus stops can have separate local and commuter feed IDs and names.
    // Ask for their physical location as well; readDepartures still requires
    // the same boarding-stop code and a nearby coordinate before accepting one.
    if (codedBus(stop)) { url.searchParams.set('radius','35'); url.searchParams.set('exactRadius','true'); }
    if (cursor) url.searchParams.set('pageCursor',cursor);
    return url.href;
  }
  const codedBus = stop => !!clean(stop.code) && Array.isArray(stop.modes) && stop.modes.includes('BUS') && stop.modes.every(mode => ['BUS','COACH'].includes(mode));
  function matchesStop(place, stop) {
    if (!place) return false;
    if (place.stopId === stop.id || place.parentId === stop.id) return true;
    if (!codedBus(stop) || clean(place.stopCode) !== clean(stop.code) || !valid(stop.lat,stop.lng) || !valid(place.lat,place.lon)) return false;
    const id = clean(place.stopId);
    if (!(stop.scope === 'bc' ? id.startsWith('ca-bc-') : stop.scope === 'london' && id.startsWith('gb-'))) return false;
    const metres = Math.hypot(wrap(place.lon-stop.lng)*111320*Math.cos(stop.lat*Math.PI/180),(place.lat-stop.lat)*111320);
    return metres <= 35;
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
      // Keep this stop, its platforms and verified cross-feed bus-stop aliases.
      // A nearby stop or matching name alone does not identify the boarding point.
      if (!matchesStop(place,stop)) continue;
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
        tripId:typeof item.tripId === 'string' && item.tripId.length<=2000 ? item.tripId.trim() : '', routeId:clean(item.routeId),
        route:clean(item.displayName || item.routeShortName || item.routeLongName || item.mode) || 'Transit',
        headsign:clean(item.headsign || item.tripTo?.name) || 'Destination not supplied',
        platform:clean(place.track || place.scheduledTrack), stopName:clean(place.name),
        operator:clean(item.agencyName), url:safeURL(item.routeUrl || item.agencyUrl)});
    }
    return {rows:rows.sort((a,b) => a.time-b.time).slice(0,50), alerts:[...alerts].slice(0,4), next:clean(data.nextPageCursor), zone:zone||stop.zone};
  }
  const major = stop => stop.modes.some(mode => mode !== 'BUS' && mode !== 'COACH');
  function tripURL(row) {
    if (!row.tripId || row.tripId.length>2000) throw Error('Trip identifier unavailable');
    const url=new URL('v6/trip',endpoint);
    url.search=new URLSearchParams({tripId:row.tripId,detailedLegs:'true',joinInterlinedLegs:'false'});
    return url.href;
  }
  function decodeGeometry(geometry) {
    if (!geometry || typeof geometry.points!=='string' || geometry.points.length>200000 || ![5,6].includes(geometry.precision)) throw Error('Route geometry unavailable');
    const text=geometry.points,points=[];let index=0,lat=0,lon=0;
    function number() {
      let value=0,shift=0,byte;
      do { if(index>=text.length||shift>45)throw Error('Invalid route geometry');byte=text.charCodeAt(index++)-63;if(byte<0||byte>63)throw Error('Invalid route geometry');value+=(byte&31)*2**shift;shift+=5; }while(byte>=32);
      return value%2 ? -(Math.floor(value/2)+1) : value/2;
    }
    while(index<text.length){lat+=number();lon+=number();const point=[lat/10**geometry.precision,lon/10**geometry.precision];if(!valid(...point)||points.length>=20000)throw Error('Invalid route coordinates');points.push(point);}
    if(points.length<2)throw Error('Route geometry unavailable');
    return points;
  }
  function readTrip(data,row,stop) {
    if(!Array.isArray(data?.legs)||data.legs.length>50)throw Error('Invalid trip response');
    // One vehicle can continue under another route number. Match the exact
    // selected trip rather than drawing all joined services or both directions.
    const leg=data.legs.find(item=>item?.tripId===row.tripId);
    if(!leg||!Array.isArray(leg.intermediateStops)||leg.intermediateStops.length>1000)throw Error('Selected trip unavailable');
    const places=[leg.from,...leg.intermediateStops,leg.to];
    if(!places.some(place=>matchesStop(place,stop)))throw Error('Selected stop missing from trip');
    const seen=new Set(),stops=places.filter(place=>place&&valid(place.lat,place.lon)&&clean(place.name)&&!seen.has(place.stopId)&&seen.add(place.stopId)).map(place=>({id:clean(place.stopId),name:clean(place.name),lat:place.lat,lng:place.lon,selected:matchesStop(place,stop)}));
    const points=decodeGeometry(leg.legGeometry);
    return {points,stops,route:clean(leg.displayName||leg.routeShortName)||row.route,headsign:clean(leg.headsign)||row.headsign,from:clean(leg.from?.name),to:clean(leg.to?.name)};
  }
  function clock(value, zone) {
    try { return new Date(value).toLocaleString(undefined,{timeZone:zone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}); }
    catch { return new Date(value).toLocaleString(undefined,{timeZone:'UTC',hourCycle:'h23'}) + ' UTC'; }
  }
  return {region, area, stopsURL, readStops, departuresURL, readDepartures, safeURL, major, clock, tripURL, readTrip, decodeGeometry};
});
