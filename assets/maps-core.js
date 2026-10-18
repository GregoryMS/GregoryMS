((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleMaps = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const defaultView = { lat: 48.4284, lng: -123.3656, zoom: 13 };
  const validPoint = (lat, lng) => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const wrapLongitude = lng => ((lng + 180) % 360 + 360) % 360 - 180;
  const text = value => typeof value === 'string' ? value.trim().slice(0, 180) : '';
  function osmReference(type, id) {
    type = ({ N: 'node', W: 'way', R: 'relation' })[type] || type;
    return ['node', 'way', 'relation'].includes(type) && /^[1-9]\d{0,15}$/.test(String(id)) && Number.isSafeInteger(Number(id)) ? `${type}/${id}` : null;
  }
  function readHash(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const parts = (params.get('map') || '').split('/');
    let view = { ...defaultView };
    if (parts.length === 3 && parts.every(part => part.trim() !== '')) {
      const [zoom, lat, lng] = parts.map(Number);
      if (Number.isInteger(zoom) && zoom >= 2 && zoom <= 19 && validPoint(lat, lng) && Math.abs(lat) <= 85.05113) view = { lat, lng, zoom };
    }
    const coords = (params.get('pin') || '').split(',');
    const [lat, lng] = coords.map(Number);
    const pin = coords.length === 2 && coords.every(part => part.trim() !== '') && validPoint(lat, lng) ? { lat, lng, name: text(params.get('name')) || 'Dropped pin', detail: '' } : null;
    const [type, id] = (params.get('osm') || '').split('/');
    if (pin && osmReference(type, id)) pin.osm = osmReference(type, id);
    return { view, pin };
  }
  function viewHash(view) {
    return `map=${Math.max(2, Math.min(19, Math.round(view.zoom)))}/${Math.max(-85.051129, Math.min(85.051129, view.lat)).toFixed(5)}/${wrapLongitude(view.lng).toFixed(5)}`;
  }
  function normalizeLayers(value) {
    return { base: value?.base === 'topographic' ? 'topographic' : 'street', maritime: value?.maritime === true, aviation: value?.aviation === true, drivebc: value?.drivebc === true, future: value?.future === true, webcams: value?.webcams === true, speed: value?.speed === true, messages: value?.messages === true, ferries: value?.ferries === true, traffic: value?.traffic === true, google: value?.google === true };
  }
  function readLayers(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    if (!params.has('base') && !params.has('overlays')) return null;
    const overlays = (params.get('overlays') || '').split(',');
    return normalizeLayers({ base: params.get('base'), maritime: overlays.includes('maritime'), aviation: overlays.includes('aviation'), drivebc: overlays.includes('drivebc'), future: overlays.includes('future'), webcams: overlays.includes('webcams'), speed: overlays.includes('speed'), messages: overlays.includes('messages'), ferries: overlays.includes('ferries'), traffic: overlays.includes('traffic'), google: overlays.includes('google') });
  }
  function makeHash(view, pin, layers) {
    let hash = '#' + viewHash(view);
    if (pin && validPoint(pin.lat, pin.lng)) hash += `&pin=${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}&name=${encodeURIComponent(text(pin.name) || 'Dropped pin')}`;
    if (pin?.osm && osmReference(...pin.osm.split('/')) === pin.osm) hash += `&osm=${pin.osm}`;
    if (layers) {
      const state = normalizeLayers(layers);
      hash += `&base=${state.base}&overlays=${['maritime', 'aviation', 'drivebc', 'future', 'webcams', 'speed', 'messages', 'ferries', 'traffic', 'google'].filter(key => state[key]).join(',')}`;
    }
    return hash;
  }
  function osmURL(view, pin) {
    const url = new URL('https://www.openstreetmap.org/');
    if (pin && validPoint(pin.lat, pin.lng)) {
      url.searchParams.set('mlat', pin.lat.toFixed(5));
      url.searchParams.set('mlon', pin.lng.toFixed(5));
    }
    url.hash = viewHash(view);
    return url.href;
  }
  function searchArea(current, bounds = []) {
    const lng = wrapLongitude(current.lng);
    if (!validPoint(current.lat, lng)) throw new Error('Invalid search centre');
    const lat = current.lat;
    const width = Number.isFinite(bounds[2] - bounds[0]) ? Math.max(0, bounds[2] - bounds[0]) : 0;
    const height = Number.isFinite(bounds[3] - bounds[1]) ? Math.max(0, bounds[3] - bounds[1]) : 0;
    // Include nearby suburbs and keep a useful search area when zoomed in to one street.
    const minHalfLat = 15 / 111.32;
    const halfLng = Math.min(180, Math.max(15 / (111.32 * Math.max(.01, Math.cos(lat * Math.PI / 180))), width * .75));
    const round = value => Number(value.toFixed(4));
    return { lat: round(lat), lng: round(lng), zoom: Math.max(2, Math.min(19, Math.round(current.zoom) || 13)),
      west: round(lng - halfLng), south: round(Math.max(-90, Math.min(lat - minHalfLat, height > 0 ? bounds[1] - height * .25 : lat))),
      east: round(lng + halfLng), north: round(Math.min(90, Math.max(lat + minHalfLat, height > 0 ? bounds[3] + height * .25 : lat))) };
  }
  function searchURL(endpoint, term, area = null) {
    const url = new URL(endpoint);
    for (const key of ['lat', 'lon', 'zoom', 'bbox', 'location_bias_scale']) url.searchParams.delete(key);
    url.searchParams.set('q', term); url.searchParams.set('limit', area ? '20' : '6'); url.searchParams.set('lang', 'en');
    if (area) {
      url.searchParams.set('lat', String(area.lat)); url.searchParams.set('lon', String(area.lng));
      url.searchParams.set('zoom', String(area.zoom)); url.searchParams.set('location_bias_scale', '0.2');
      // Photon needs an ordinary min/max box. Dateline searches use focus plus the client-side area filter.
      if (area.west >= -180 && area.east <= 180) url.searchParams.set('bbox', [area.west, area.south, area.east, area.north].join(','));
    }
    return url.href;
  }
  function readResults(data, area = null) {
    if (!data || !Array.isArray(data.features)) throw new Error('Invalid search response');
    const seen = new Set(), results = [];
    for (const feature of data.features.slice(0, 30)) {
      const coords = feature?.geometry?.coordinates, p = feature?.properties;
      if (feature?.geometry?.type !== 'Point' || !Array.isArray(coords) || !p || !validPoint(coords[1], coords[0])) continue;
      if (area) {
        const lng = area.lng + wrapLongitude(coords[0] - area.lng);
        if (lng < area.west || lng > area.east || coords[1] < area.south || coords[1] > area.north) continue;
      }
      const street = [text(p.housenumber), text(p.street)].filter(Boolean).join(' ');
      const name = text(p.name) || street || text(p.city) || text(p.state) || text(p.country) || 'Map location';
      const detail = [...new Set([street, text(p.postcode), text(p.city), text(p.state), text(p.country)].filter(value => value && value !== name))].join(', ');
      const key = `${name}/${coords[0]}/${coords[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const type = text(p.osm_value);
      const zoom = ({ country: 5, state: 7, city: 12, town: 13, village: 14, hamlet: 15 })[type] || 16;
      const osm = osmReference(p.osm_type, p.osm_id);
      results.push({ name, detail, lat: coords[1], lng: coords[0], zoom, ...(osm ? { osm } : {}) });
      if (results.length === 6) break;
    }
    return results;
  }
  function roadStart(schedule) {
    if (!Array.isArray(schedule?.intervals) || !schedule.intervals.length || schedule.intervals.length > 500) return null;
    const starts = [];
    for (const interval of schedule.intervals) {
      if (typeof interval !== 'string') return null;
      const value = interval.split('/')[0];
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
      if (!match) return null;
      const [, year, month, day, hour, minute, second] = match, date = new Date(Date.UTC(+year, +month - 1, +day));
      if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +(second || 0) > 59) return null;
      // This DriveBC feed publishes offsetless interval timestamps in UTC.
      const start = Date.parse(value + (match[7] ? '' : 'Z'));
      if (!Number.isFinite(start)) return null;
      starts.push(start);
    }
    return new Date(Math.min(...starts)).toISOString();
  }
  function readRoadEvents(data) {
    if (!Array.isArray(data?.events)) throw new Error('Invalid DriveBC response');
    const seen = new Set(), results = [];
    for (const item of data.events.slice(0, 2000)) {
      if (!item || item.status !== 'ACTIVE' || typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) continue;
      const geometry = item.geography;
      let coordinates = geometry?.coordinates;
      if (!Array.isArray(coordinates)) continue;
      if (geometry.type === 'Point') {
        if (Array.isArray(coordinates[0])) coordinates = coordinates[0];
        if (!validPoint(coordinates[1], coordinates[0])) continue;
        coordinates = [[coordinates[1], coordinates[0]]];
      } else if (geometry.type === 'LineString') {
        coordinates = coordinates.filter(p => Array.isArray(p) && validPoint(p[1], p[0])).map(p => [p[1], p[0]]);
        if (coordinates.length < 2) continue;
        if (coordinates.length > 800) {
          const full = coordinates;
          coordinates = Array.from({ length: 800 }, (_, i) => full[Math.round(i * (full.length - 1) / 799)]);
        }
      } else continue;
      seen.add(item.id);
      const type = ['CONSTRUCTION', 'SPECIAL_EVENT', 'INCIDENT', 'WEATHER_CONDITION', 'ROAD_CONDITION'].includes(item.event_type) ? item.event_type : 'ROAD_CONDITION';
      const severity = ['MAJOR', 'MODERATE', 'MINOR'].includes(item.severity) ? item.severity : 'UNKNOWN';
      const closed = Array.isArray(item.roads) && item.roads.some(road => road?.state === 'CLOSED');
      const description = typeof item.description === 'string' ? item.description.trim().slice(0, 4000) : '';
      const updated = typeof item.updated === 'string' && Number.isFinite(Date.parse(item.updated)) ? item.updated : null;
      results.push({ id: item.id.slice(0, 160), name: text(item.headline) || type.replaceAll('_', ' '), description, type, severity, closed, coordinates, point: coordinates[Math.floor(coordinates.length / 2)], updated, starts: roadStart(item.schedule) });
    }
    return results;
  }
  return { defaultView, validPoint, wrapLongitude, osmReference, readHash, makeHash, osmURL, searchArea, searchURL, readResults, normalizeLayers, readLayers, readRoadEvents, roadStart };
});
