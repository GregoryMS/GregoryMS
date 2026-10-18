const origins = new Set(['https://gregle.uk', 'https://www.gregle.uk']);
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
    let stage = 'cache';
    try {
      const paused = await cache.match(cooldown);
      if (paused) return send(paused);
      const cached = await cache.match(key);
      if (cached) return send(cached);
      const ac = []; let limited = false;
      for (const box of boxes) {
        stage = 'source';
        const endpoint = new URL('https://pocketworld.org/api/flights');
        endpoint.search = new URLSearchParams({ wire: '1', bbox: box.map(x => x.toFixed(4)).join(',') }).toString();
        const upstream = await fetch(endpoint.href, { headers: { Accept: 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
        if (!upstream.ok) {
          const value = upstream.headers.get('Retry-After');
          const wait = Math.min(900, Math.max(30, value && /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value || '') - Date.now()) / 1000) || 30));
          await upstream.body?.cancel();
          const response = reply({ error: 'Aircraft source temporarily unavailable' }, upstream.status === 429 ? 429 : 503, { 'Retry-After': String(wait), 'Cache-Control': `public, max-age=${wait}` });
          ctx.waitUntil(cache.put(cooldown, response.clone()));
          return send(response);
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
      return reply({ error: 'Aircraft source temporarily unavailable', reason: stage }, 503, { 'Retry-After': '30' });
    }
  }
};
export default worker;
