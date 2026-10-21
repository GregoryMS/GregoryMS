const origins = new Set(['https://gregle.uk', 'https://www.gregle.uk', 'https://maps.gregle.uk']);
/** @param {Response} response */
async function readJSON(response) {
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Oversized response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
/** @type {ExportedHandler} */
const worker = {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'Retry-After' };
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    /** @param {unknown} body @param {number} status @param {Record<string, string>} extra */
    const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
    if (!origins.has(origin)) return reply({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return reply({ error: 'GET required' }, 405, { Allow: 'GET, OPTIONS' });
    const url = new URL(request.url);
    const track = /^\/aircraft\/track\/([a-f0-9]{6})$/.exec(url.pathname);
    if (track && !url.search) {
      const cache = caches.default, key = new Request(`${url.origin}/cache/flight-track/${track[1]}`), cooldown = new Request(`${url.origin}/cooldown/flight-tracks`);
      /** @param {Response} response */
      const send = response => { const h = new Headers(response.headers); h.set('Access-Control-Allow-Origin', origin); h.set('Vary', 'Origin'); h.set('Cache-Control', 'no-store'); return new Response(response.body, {status: response.status, headers: h}); };
      try {
        const cached = await cache.match(key); if (cached) return send(cached);
        const paused = await cache.match(cooldown); if (paused) return send(paused);
        const upstream = await fetch(`https://pocketworld.org/api/flights/track/${track[1]}`, {headers: {Accept: 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)'}, redirect: 'manual', signal: AbortSignal.timeout(10000)});
        if (!upstream.ok) {
          const raw = upstream.headers.get('Retry-After'), parsed = raw && /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw || '') - Date.now()) / 1000);
          const wait = Math.min(900, Math.max(30, Number.isFinite(parsed) ? parsed : 30));
          await upstream.body?.cancel();
          const response = reply({error: 'Aircraft history temporarily unavailable'}, upstream.status === 429 ? 429 : 503, {'Retry-After': String(wait), 'Cache-Control': `public, max-age=${wait}`});
          await cache.put(cooldown, response.clone()); return send(response);
        }
        const data = await readJSON(upstream);
        const reliable = typeof data?.icao24 === 'string' && data.icao24.toLowerCase() === track[1] && data.synthetic === false && data.reliable_track === true && data.track_unavailable !== true && data.source !== 'synthetic';
        /** @type {Array<{time?: unknown, lat?: unknown, lng?: unknown, alt?: unknown, on_ground?: unknown, synthetic?: unknown, telemetry?: unknown, reliable_track?: unknown, phase?: unknown}>} */
        const raw = reliable ? Array.isArray(data.waypoints) ? data.waypoints : Array.isArray(data.points) ? data.points : [] : [];
        const waypoints = raw.slice(0, 5000).filter(p => p && p.synthetic === false && p.telemetry === true && p.reliable_track === true && p.phase !== 'origin' && p.phase !== 'destination' && typeof p.time === 'number' && Number.isFinite(p.time) && typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 85.05113 && typeof p.lng === 'number' && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180).map(p => ({time: p.time, lat: p.lat, lng: p.lng, alt: typeof p.alt === 'number' && Number.isFinite(p.alt) ? p.alt : null, on_ground: p.on_ground === true, synthetic: false, telemetry: true, reliable_track: true}));
        const response = reply({icao24: track[1], synthetic: false, reliable_track: reliable, track_unavailable: !reliable, waypoints}, 200, {'Cache-Control': 'public, max-age=30'});
        ctx.waitUntil(cache.put(key, response.clone())); return send(response);
      } catch {
        const response = reply({error: 'Aircraft history temporarily unavailable'}, 503, {'Retry-After': '30', 'Cache-Control': 'public, max-age=30'});
        try { await cache.put(cooldown, response.clone()); } catch {}
        return send(response);
      }
    }
    if (url.pathname !== '/aircraft') return reply({ error: 'Not found' }, 404);
    /** @param {string} key */
    const numeric = key => { const value = url.searchParams.get(key); return value && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : NaN; };
    const lat = numeric('lat'), lng = numeric('lon'), radius = numeric('radius');
    if (!Number.isFinite(lat) || Math.abs(lat) > 85.05113 || !Number.isFinite(lng) || Math.abs(lng) > 180 || !Number.isInteger(radius) || radius < 10 || radius > 250 || [...url.searchParams.keys()].some(k => !['lat', 'lon', 'radius'].includes(k))) return reply({ error: 'Invalid map area' }, 400);
    const point = `${lat.toFixed(2)}/${lng.toFixed(2)}/${Math.ceil(radius / 10) * 10}`;
    const latitude = Number(lat.toFixed(2)), longitude = Number(lng.toFixed(2)), angular = Math.ceil(radius / 10) * 10 / 3440.065;
    const halfLat = angular * 180 / Math.PI, south = Math.max(-90, latitude - halfLat), north = Math.min(90, latitude + halfLat);
    const halfLng = south === -90 || north === 90 ? 180 : Math.asin(Math.min(1, Math.sin(angular) / Math.cos(latitude * Math.PI / 180))) * 180 / Math.PI;
    const west = longitude - halfLng, east = longitude + halfLng;
    const boxes = west < -180 ? [[west + 360, south, 180, north], [-180, south, east, north]] : east > 180 ? [[west, south, 180, north], [-180, south, east - 360, north]] : [[west, south, east, north]];
    const cache = caches.default, key = new Request(`${url.origin}/cache/pocketworld/${point}`), cooldown = new Request(`${url.origin}/cooldown/pocketworld`);
    /** @param {Response} response */
    const send = response => { const h = new Headers(response.headers); h.set('Access-Control-Allow-Origin', origin); h.set('Vary', 'Origin'); h.set('Cache-Control', 'no-store'); return new Response(response.body, { status: response.status, headers: h }); };
    // Keep a separate source cache/cooldown so a PocketWorld outage cannot
    // suppress fresh receiver observations, or retry that outage on every pan.
    const fallbackKey = new Request(`${url.origin}/cache/adsblol/${point}`);
    const fallbackCooldown = new Request(`${url.origin}/cooldown/adsblol`);
    /** @param {Response} failure */
    async function fallback(failure) {
      try {
        const cached = await cache.match(fallbackKey).catch(() => undefined);
        if (cached) return send(cached);
        if (await cache.match(fallbackCooldown).catch(() => undefined)) return send(failure);
        const upstream = await fetch(`https://api.adsb.lol/v2/point/${latitude}/${longitude}/${Math.ceil(radius / 10) * 10}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)' },
          redirect: 'manual', signal: AbortSignal.timeout(4500)
        });
        if (!upstream.ok) {
          console.warn(JSON.stringify({event: 'aircraft_fallback_unavailable', status: upstream.status}));
          const value = upstream.headers.get('Retry-After');
          const parsed = value && /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value || '') - Date.now()) / 1000);
          const wait = Math.min(900, Math.max(30, Number.isFinite(parsed) ? parsed : 30));
          await upstream.body?.cancel();
          await cache.put(fallbackCooldown, new Response('', { headers: { 'Cache-Control': `public, max-age=${wait}` } }));
          return send(failure);
        }
        const data = await readJSON(upstream);
        const stamp = data?.now > 1e12 ? data.now : data?.now * 1000;
        if (!Array.isArray(data?.ac) || typeof data.now !== 'number' || !Number.isFinite(stamp) || stamp < Date.now() - 120000 || stamp > Date.now() + 30000) throw new Error('Invalid fallback data');
        // Preserve source time and position ages; never turn old data into live data.
        const ac = data.ac.slice(0, 5000).filter(a => a && typeof a.hex === 'string' && /^~?[a-f0-9]{6}$/i.test(a.hex) &&
          typeof a.lat === 'number' && Number.isFinite(a.lat) && Math.abs(a.lat) <= 85.05113 &&
          typeof a.lon === 'number' && Number.isFinite(a.lon) && Math.abs(a.lon) <= 180 &&
          typeof a.seen_pos === 'number' && Number.isFinite(a.seen_pos) && a.seen_pos >= 0 &&
          Date.now() - (stamp - a.seen_pos * 1000) < 120000 && !/^C[0-9]$/.test(a.category)
        ).map(a => ({ hex: a.hex, flight: a.flight, r: a.r, t: a.t, desc: a.desc, lat: a.lat, lon: a.lon,
          alt_baro: a.alt_baro, gs: a.gs, track: a.track, baro_rate: a.baro_rate, squawk: a.squawk,
          seen_pos: a.seen_pos, type: a.type, category: a.category, provider: 'adsblol' }));
        const response = reply({ now: stamp, ac, limited: data.ac.length > 5000 }, 200, { 'Cache-Control': 'public, max-age=15' });
        ctx.waitUntil(cache.put(fallbackKey, response.clone()).catch(() => {}));
        return send(response);
      } catch (error) {
        console.warn(JSON.stringify({event: 'aircraft_fallback_unavailable', message: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[upstream]') : 'Unknown error'}));
        try { await cache.put(fallbackCooldown, new Response('', { headers: { 'Cache-Control': 'public, max-age=30' } })); } catch {}
        return send(failure);
      }
    }
    let stage = 'cache';
    try {
      const cached = await cache.match(key) || await cache.match(fallbackKey);
      if (cached) return send(cached);
      const paused = await cache.match(cooldown);
      if (paused) return fallback(paused);
      const ac = []; let limited = false;
      for (const box of boxes) {
        stage = 'source';
        const endpoint = new URL('https://pocketworld.org/api/flights');
        endpoint.search = new URLSearchParams({ wire: '1', bbox: box.map(x => x.toFixed(4)).join(',') }).toString();
        const upstream = await fetch(endpoint.href, { headers: { Accept: 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)' }, redirect: 'manual', signal: AbortSignal.timeout(3500) });
        if (!upstream.ok) {
          const value = upstream.headers.get('Retry-After');
          const wait = Math.min(900, Math.max(30, value && /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value || '') - Date.now()) / 1000) || 30));
          await upstream.body?.cancel();
          const response = reply({ error: 'Aircraft source temporarily unavailable' }, upstream.status === 429 ? 429 : 503, { 'Retry-After': String(wait), 'Cache-Control': `public, max-age=${wait}` });
          await cache.put(cooldown, response.clone());
          return fallback(response);
        }
        stage = 'decode';
        const data = await readJSON(upstream);
        if (!Array.isArray(data.flight_fields) || !Array.isArray(data.flight_rows) || !['icao24', 'lat', 'lng', 'last_contact'].every(k => data.flight_fields.includes(k))) throw new Error('Invalid source data');
        if (data.flight_rows.length > 5000 || data.bbox_total > data.flight_rows.length) limited = true;
        for (const row of data.flight_rows.slice(0, 5000)) {
          if (!Array.isArray(row)) continue;
          /** @param {string} name */
          const get = name => row[data.flight_fields.indexOf(name)];
          const stamp = get('last_contact');
          if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp > Date.now() / 1000 + 30 || get('cache_stale') === true || !['opensky', 'adsbfi', 'adsblol'].includes(get('source')) || ['vehicle', 'ground_vehicle', 'surface_vehicle', 'obstacle'].includes(get('transport_kind'))) continue;
          const altitude = get('alt'), speed = get('velocity'), vertical = get('vertical_rate');
          ac.push({ hex: get('icao24'), flight: get('callsign'), r: get('registration'), t: get('typecode'), desc: get('model'), lat: get('lat'), lon: get('lng'),
            alt_baro: get('on_ground') === true ? 'ground' : typeof altitude === 'number' ? altitude / .3048 : null,
            gs: typeof speed === 'number' ? speed / .5144444444 : null, track: get('heading'), baro_rate: typeof vertical === 'number' ? vertical * 60 / .3048 : null,
            squawk: get('squawk'), seen_pos: Math.max(0, Date.now() / 1000 - stamp), type: get('source_type'), provider: get('source') });
        }
      }
      const response = reply({ now: Date.now(), ac, limited }, 200, { 'Cache-Control': 'public, max-age=15' });
      ctx.waitUntil(cache.put(key, response.clone()));
      return send(response);
    } catch (error) {
      console.warn(JSON.stringify({ event: 'aircraft_source_unavailable', stage, message: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[upstream]') : 'Unknown error' }));
      const response = reply({ error: 'Aircraft source temporarily unavailable', reason: stage }, 503, { 'Retry-After': '30', 'Cache-Control': 'public, max-age=30' });
      try { await cache.put(cooldown, response.clone()); } catch {}
      return fallback(response);
    }
  }
};
export default worker;
