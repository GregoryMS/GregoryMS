((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleAircraftCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const maxAge = 120000;
  const altitudeStops = [[0, [255, 207, 0]], [10000, [0, 230, 118]], [20000, [0, 217, 255]], [30000, [23, 107, 255]], [40000, [201, 0, 255]]];
  const neutralColour = '#788391';
  const rgb = channels => `rgb(${channels.join(', ')})`;
  const altitudeGradient = `linear-gradient(90deg, ${altitudeStops.map(([feet, colour]) => `${rgb(colour)} ${feet / 400}%`).join(', ')})`;
  function altitudeColour(altitude, ground = false) {
    if (ground || !Number.isFinite(altitude)) return neutralColour;
    const feet = Math.max(0, Math.min(40000, altitude));
    const index = Math.min(3, Math.floor(feet / 10000));
    const [low, from] = altitudeStops[index], [high, to] = altitudeStops[index + 1];
    return rgb(from.map((channel, i) => Math.round(channel + (to[i] - channel) * (feet - low) / (high - low))));
  }
  const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
  const number = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  const text = x => typeof x === 'string' ? x.trim().slice(0, 120) : '';
  // Common ICAO designators supplement feeds that report a model but no emitter category.
  const helicopters = new Set(('R22 R44 R66 B06 B06T B47 B105 B205 B206 B212 B214 B222 B230 B407 B412 B427 B429 B430 B505 B525 ' +
    'EC20 EC25 EC30 EC35 EC45 EC55 EC75 AS32 AS50 AS55 AS65 A109 A119 A139 A149 A169 A189 AW09 ' +
    'H120 H125 H130 H135 H145 H155 H160 H175 H215 H225 H269 H369 H500 H530 H60 H64 ' +
    'S55 S58 S61 S64 S70 S76 S92 S300 S333 UH1 UH60 AH64 CH47 CH53 MD52 MD60 EN28 G2CA').toUpperCase().split(' '));
  const smallPlanes = new Set(('C120 C140 C150 C152 C162 C170 C172 C175 C177 C180 C182 C185 C188 C190 C195 C205 C206 C207 C208 C210 ' +
    'C303 C310 C320 C335 C336 C337 C340 C401 C402 C404 C411 C414 C421 C425 C441 T182 T206 T210 ' +
    'P28A P28B P28R P28T P32R P32T PA18 PA20 PA22 PA23 PA24 PA27 PA30 PA31 PA32 PA34 PA38 PA39 PA44 PA46 P46T M600 M700 ' +
    'BE19 BE23 BE24 BE33 BE35 BE36 BE50 BE55 BE58 BE60 BE76 BE9L BE9T BE10 BE20 BE30 ' +
    'SR20 SR22 S22T DA20 DA40 DA42 DA50 DA62 DV20 DHC1 DHC2 DH2T DHC3 DHC6 PC6T PC12 ' +
    'AC11 AC50 AC56 AC68 AC69 AA1 AA5 AEST AE50 BN2P BN2T TB9 TB10 TB20 TB21 TB30 TRIN ' +
    'DR10 DR22 DR25 DR30 DR40 D140 D150 D250 CAP1 CAP2 CAP3 CUB2 CC11 CC18 CC19 CC21 EXCC ' +
    'RV3 RV4 RV6 RV7 RV8 RV9 RV10 RV12 RV14 LNC2 LNC4 COL3 COL4 VL3 WT9 P208 P200 P201 P06T P212 P92 BR23 PS28').split(' '));
  function aircraftKind(type, description = '', category = '') {
    const code = text(type).toUpperCase(), model = text(description).toUpperCase(), emitter = text(category).toUpperCase();
    if (emitter === 'A7' || helicopters.has(code) || /^H[1-4][PTJ]$/.test(model) || /\b(?:HELICOPTERS?|ROTORCRAFT|ROBINSON R[- ]?(?:22|44|66))\b/.test(model)) return 'helicopter';
    if (smallPlanes.has(code) || /^[LAS]1P$/.test(model) || /\bCESSNA (?:1[2578][02578]|20[5678]|210)\b/.test(model)) return 'small-plane';
    return 'airliner';
  }
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
      records.set(id, { id, point: [a.lat, a.lon], callsign: text(a.flight), registration: text(a.r), type: text(a.t), description: text(a.desc), kind: aircraftKind(a.t, a.desc, a.category),
        ground: a.alt_baro === 'ground', altitude: number(a.alt_baro, -2000, 100000) ? a.alt_baro : null,
        speed: number(a.gs, 0, 2000) ? a.gs : null, heading: number(a.track, 0, 360) ? a.track % 360 : null,
        verticalRate: number(a.baro_rate, -20000, 20000) ? a.baro_rate : null, squawk: /^[0-7]{4}$/.test(a.squawk) ? a.squawk : '',
        source: ({ opensky: 'OpenSky Network', adsbfi: 'adsb.fi', adsblol: 'ADSB.lol' })[a.provider] || 'Aircraft receiver network', updated });
    }
    return { aircraft: [...records.values()].slice(0, 1500), limited: data.limited === true || records.size > 1500 || data.ac.length > 10000 };
  }
  const trackAge = 2 * 60 * 60000, trackLimit = 2000;
  function mergeTrack(previous, incoming, now = Date.now()) {
    const points = new Map();
    for (const point of [...previous, ...incoming]) {
      if (!point || !number(point.updated, now - trackAge, now) || !Array.isArray(point.point) || !number(point.point[0], -85.05113, 85.05113) || !number(point.point[1], -180, 180)) continue;
      points.set(point.updated, {updated: point.updated, point: [point.point[0], point.point[1]], altitude: number(point.altitude, -2000, 100000) ? point.altitude : null, ground: point.ground === true});
    }
    return [...points.values()].sort((a, b) => a.updated - b.updated).slice(-trackLimit);
  }
  function readTrack(data, id, now = Date.now()) {
    if (!/^[a-f0-9]{6}$/.test(id) || typeof data?.icao24 !== 'string' || data.icao24.toLowerCase() !== id || data.synthetic !== false || data.reliable_track !== true || data.track_unavailable === true || data.source === 'synthetic') return [];
    const raw = Array.isArray(data.waypoints) ? data.waypoints : Array.isArray(data.points) ? data.points : [];
    return mergeTrack([], raw.slice(0, 5000).filter(p => p?.synthetic === false && p.telemetry === true && p.reliable_track === true && !['origin', 'destination'].includes(p.phase)).map(p => ({
      updated: typeof p.time === 'number' ? p.time * 1000 : NaN,
      point: [p.lat, p.lng], altitude: number(p.alt, -609.6, 30480) ? p.alt / 0.3048 : null, ground: p.on_ground === true
    })), now);
  }
  function trackSegments(points, worldLng) {
    const result = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], elapsed = (b.updated - a.updated) / 1000, miles = distance(a.point, b.point);
      // Do not draw across missing coverage, implausible jumps, or a stationary report.
      if (elapsed <= 0 || elapsed > 180 || miles === 0 || miles > 2 + elapsed / 3600 * 1200) continue;
      const endLng = b.point[1] + 360 * Math.round((worldLng - b.point[1]) / 360);
      const startLng = a.point[1] + 360 * Math.round((endLng - a.point[1]) / 360);
      result.push({points: [[a.point[0], startLng], [b.point[0], endLng]], colour: altitudeColour(b.altitude, b.ground)});
    }
    return result;
  }
  return { maxAge, trackAge, trackLimit, mergeTrack, readTrack, trackSegments, altitudeColour, altitudeGradient, neutralColour, aircraftKind, distance, area, covers, visible, read };
});
