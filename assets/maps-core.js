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
    return { view, pin };
  }
  function viewHash(view) {
    return `map=${Math.max(2, Math.min(19, Math.round(view.zoom)))}/${Math.max(-85.051129, Math.min(85.051129, view.lat)).toFixed(5)}/${wrapLongitude(view.lng).toFixed(5)}`;
  }
  function normalizeLayers(value) {
    return { base: value?.base === 'topographic' ? 'topographic' : 'street', maritime: value?.maritime === true, drivebc: value?.drivebc === true, traffic: value?.traffic === true };
  }
  function readLayers(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    if (!params.has('base') && !params.has('overlays')) return null;
    const overlays = (params.get('overlays') || '').split(',');
    return normalizeLayers({ base: params.get('base'), maritime: overlays.includes('maritime'), drivebc: overlays.includes('drivebc'), traffic: overlays.includes('traffic') });
  }
  function makeHash(view, pin, layers) {
    let hash = '#' + viewHash(view);
    if (pin && validPoint(pin.lat, pin.lng)) hash += `&pin=${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}&name=${encodeURIComponent(text(pin.name) || 'Dropped pin')}`;
    if (layers) {
      const state = normalizeLayers(layers);
      hash += `&base=${state.base}&overlays=${['maritime', 'drivebc', 'traffic'].filter(key => state[key]).join(',')}`;
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
  function readResults(data) {
    if (!data || !Array.isArray(data.features)) throw new Error('Invalid search response');
    const seen = new Set(), results = [];
    for (const feature of data.features.slice(0, 30)) {
      const coords = feature?.geometry?.coordinates, p = feature?.properties;
      if (feature?.geometry?.type !== 'Point' || !Array.isArray(coords) || !p || !validPoint(coords[1], coords[0])) continue;
      const street = [text(p.housenumber), text(p.street)].filter(Boolean).join(' ');
      const name = text(p.name) || street || text(p.city) || text(p.state) || text(p.country) || 'Map location';
      const detail = [...new Set([street, text(p.postcode), text(p.city), text(p.state), text(p.country)].filter(value => value && value !== name))].join(', ');
      const key = `${name}/${coords[0]}/${coords[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const type = text(p.osm_value);
      const zoom = ({ country: 5, state: 7, city: 12, town: 13, village: 14, hamlet: 15 })[type] || 16;
      results.push({ name, detail, lat: coords[1], lng: coords[0], zoom });
      if (results.length === 6) break;
    }
    return results;
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
      results.push({ id: item.id.slice(0, 160), name: text(item.headline) || type.replaceAll('_', ' '), description, type, severity, closed, coordinates, point: coordinates[Math.floor(coordinates.length / 2)], updated });
    }
    return results;
  }
  return { defaultView, validPoint, wrapLongitude, readHash, makeHash, osmURL, readResults, normalizeLayers, readLayers, readRoadEvents };
});
