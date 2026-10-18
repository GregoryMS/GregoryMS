((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleAircraftCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const maxAge = 120000;
  const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
  const number = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  const text = x => typeof x === 'string' ? x.trim().slice(0, 120) : '';
  function distance(a, b) {
    const rad = Math.PI / 180, dlat = (b[0] - a[0]) * rad, dlng = wrap(b[1] - a[1]) * rad;
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dlng / 2) ** 2;
    return 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }
  function area(bounds, zoom) {
    const [west, south, east, north] = bounds, width = east - west;
    if (zoom < 7 || !bounds.every(Number.isFinite) || width <= 0 || width > 180 || south >= north || south < -85.05113 || north > 85.05113) return null;
    const lat = Number(((south + north) / 2).toFixed(2)), lng = Number(wrap((west + east) / 2).toFixed(2));
    const radius = Math.max(10, Math.ceil((Math.max(...[[south, west], [south, east], [north, west], [north, east]].map(p => distance([lat, lng], p))) + 1) / 10) * 10);
    return radius <= 250 ? { lat, lng, radius, key: `${lat}/${lng}/${radius}` } : null;
  }
  function covers(a, bounds) {
    return !!a && [[bounds[1], bounds[0]], [bounds[1], bounds[2]], [bounds[3], bounds[0]], [bounds[3], bounds[2]]].every(p => distance([a.lat, a.lng], p) <= a.radius);
  }
  function visible(point, bounds) {
    const width = bounds[2] - bounds[0], offset = ((point[1] - bounds[0]) % 360 + 360) % 360;
    return point[0] >= bounds[1] && point[0] <= bounds[3] && (width >= 360 || offset <= width);
  }
  function read(data, now = Date.now()) {
    const stamp = data?.now > 1e12 ? data.now : data?.now * 1000;
    if (typeof data?.now !== 'number' || !Array.isArray(data?.ac) || !number(stamp, now - maxAge, now + 30000)) throw new Error('Aircraft feed is unavailable or out of date');
    const records = new Map();
    for (const a of data.ac.slice(0, 10000)) {
      if (!a || typeof a.hex !== 'string' || !/^~?[a-f0-9]{6}$/i.test(a.hex) || !number(a.lat, -85.05113, 85.05113) || !number(a.lon, -180, 180) || /^C[0-9]$/.test(a.category)) continue;
      const age = number(a.seen_pos, 0, 120) ? a.seen_pos : a.seen_pos == null && number(a.seen, 0, 120) ? a.seen : null;
      if (age === null) continue;
      const updated = Math.min(now, stamp - age * 1000), id = a.hex.toLowerCase();
      if (now - updated >= maxAge || records.has(id) && records.get(id).updated >= updated) continue;
      records.set(id, { id, point: [a.lat, a.lon], callsign: text(a.flight), registration: text(a.r), type: text(a.t), description: text(a.desc),
        ground: a.alt_baro === 'ground', altitude: number(a.alt_baro, -2000, 100000) ? a.alt_baro : null,
        speed: number(a.gs, 0, 2000) ? a.gs : null, heading: number(a.track, 0, 360) ? a.track % 360 : null,
        verticalRate: number(a.baro_rate, -20000, 20000) ? a.baro_rate : null, squawk: /^[0-7]{4}$/.test(a.squawk) ? a.squawk : '',
        source: ({ opensky: 'OpenSky Network', adsbfi: 'adsb.fi', adsblol: 'ADSB.lol' })[a.provider] || 'Aircraft receiver network', updated });
    }
    return { aircraft: [...records.values()].slice(0, 1500), limited: data.limited === true || records.size > 1500 || data.ac.length > 10000 };
  }
  return { maxAge, distance, area, covers, visible, read };
});
