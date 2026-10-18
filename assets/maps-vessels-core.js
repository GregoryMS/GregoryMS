((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleVesselsCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const maxAge = 600000;
  const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
  const number = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  const text = x => typeof x === 'string' ? x.trim().slice(0, 120) : '';
  function visible(point, bounds) {
    const width = bounds[2] - bounds[0], offset = ((point[1] - bounds[0]) % 360 + 360) % 360;
    return point[0] >= bounds[1] && point[0] <= bounds[3] && (width >= 360 || offset <= width);
  }
  function area(bounds, zoom) {
    const [west, south, east, north] = bounds, width = east - west;
    if (zoom < 7 || !bounds.every(Number.isFinite) || width <= 0 || width > 12 || south >= north || north - south > 8) return null;
    // Buffer the view so small pans reuse the same vessel snapshot.
    const lat = (south + north) / 2, lng = wrap((west + east) / 2);
    const halfLat = Math.min(5, Math.max(.1, (north - south) * .75)), halfLng = Math.min(9, Math.max(.1, width * .75));
    return [lng - halfLng, Math.max(-85.05113, lat - halfLat), lng + halfLng, Math.min(85.05113, lat + halfLat)].map(x => Number(x.toFixed(4)));
  }
  function covers(area, bounds) {
    return !!area && bounds[2] - bounds[0] <= area[2] - area[0] && [[bounds[1], bounds[0]], [bounds[1], bounds[2]], [bounds[3], bounds[0]], [bounds[3], bounds[2]]].every(p => visible(p, area));
  }
  function read(data, now = Date.now()) {
    if (!data || !Array.isArray(data.ships) || data.ships.length > 5000 || !number(data.now, now - maxAge, now + 30000)) throw new Error('Vessel feed unavailable or out of date');
    const ships = new Map();
    for (const s of data.ships) {
      const id = String(s?.mmsi || ''), updated = typeof s?.observed === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(s.observed) ? Date.parse(s.observed) : NaN;
      if (!/^[1-9]\d{8}$/.test(id) || !number(s.lat, -85.05113, 85.05113) || !number(s.lng, -180, 180) || !number(updated, now - maxAge + 1, now + 30000)) continue;
      if (ships.has(id) && ships.get(id).updated >= updated) continue;
      const heading = number(s.heading, 0, 359) ? s.heading : number(s.course, 0, 359.9) ? s.course : null;
      ships.set(id, { id, point: [s.lat, s.lng], name: text(s.name), type: text(s.type), country: text(s.country), destination: text(s.destination),
        heading, course: number(s.course, 0, 359.9) ? s.course : null, speed: number(s.speed, 0, 102.2) ? s.speed : null,
        source: ({ aisstream: 'AISStream.io', barentswatch: 'Kystverket / BarentsWatch', fintraffic: 'Fintraffic Digitraffic', singapore_mpa: 'Singapore MPA' })[s.source] || 'AIS receiver network', updated: Math.min(now, updated) });
    }
    return { vessels: [...ships.values()], cursor: data.cursor || '', snapshotId: data.snapshotId || '', pages: Number.isInteger(data.pages) && data.pages >= 1 && data.pages <= 12 ? data.pages : null, limited: data.limited === true, degraded: data.degraded === true };
  }
  return { maxAge, visible, area, covers, read };
});
