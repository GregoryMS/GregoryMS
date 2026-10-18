const origins = new Set(['https://gregle.uk', 'https://www.gregle.uk']);
async function readJSON(response) {
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 3 * 1024 * 1024) { await reader.cancel(); throw new Error('Oversized response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'Retry-After' };
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
    if (!origins.has(origin)) return reply({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return reply({ error: 'GET required' }, 405, { Allow: 'GET, OPTIONS' });
    const url = new URL(request.url), params = url.searchParams;
    if (url.pathname !== '/vessels') return reply({ error: 'Not found' }, 404);
    const raw = params.get('bbox') || '', box = raw.split(',').map(Number), [west, south, east, north] = box;
    const cursor = params.get('cursor') || '', snapshot = params.get('snapshot') || '';
    if (!/^-?\d+(\.\d+)?,(-?\d+(\.\d+)?,){2}-?\d+(\.\d+)?$/.test(raw) || box.length !== 4 || !box.every(Number.isFinite) || south < -85.05113 || north > 85.05113 || south >= north || north - south > 10 || west < -189 || east > 189 || east <= west || east - west > 18 ||
      (cursor && (!/^[1-9]\d{3,4}$/.test(cursor) || +cursor % 5000 || +cursor > 55000 || !/^[a-f0-9]{24}$/.test(snapshot))) || (!cursor && snapshot) || [...params.keys()].some(k => !['bbox', 'cursor', 'snapshot'].includes(k))) return reply({ error: 'Invalid map area or page' }, 400);
    const cache = caches.default, key = new Request(`${url.origin}/source/ships/${snapshot || 'latest'}/${cursor || '0'}`), cooldown = new Request(`${url.origin}/source/cooldown`);
    try {
      const paused = await cache.match(cooldown);
      if (paused) return reply({ error: 'Vessel source temporarily unavailable' }, 503, { 'Retry-After': paused.headers.get('Retry-After') || '60' });
      let cached = await cache.match(key), data;
      if (!cached) {
        const upstreamURL = new URL('https://pocketworld.org/api/ships');
        upstreamURL.search = new URLSearchParams({ wire: '1', limit: '5000', ...(cursor ? { cursor, snapshot_id: snapshot } : {}) }).toString();
        const upstream = await fetch(upstreamURL.href, { headers: { Accept: 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
        if (!upstream.ok) {
          const value = upstream.headers.get('Retry-After');
          const wait = Math.min(900, Math.max(60, value && /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value || '') - Date.now()) / 1000) || 60));
          await upstream.body?.cancel();
          // A snapshot that expired between pages is retried on the next visible refresh.
          if (upstream.status === 429 || value && ![400, 404, 409, 410].includes(upstream.status)) ctx.waitUntil(cache.put(cooldown, new Response('paused', { headers: { 'Cache-Control': `public, max-age=${wait}`, 'Retry-After': String(wait) } })).catch(() => {}));
          return reply({ error: 'Vessel source temporarily unavailable' }, upstream.status === 429 ? 429 : 503, { 'Retry-After': String(wait) });
        }
        data = await readJSON(upstream);
        if (data.payload !== 'ship_map_wire_v1' || !Array.isArray(data.fields) || !Array.isArray(data.ship_rows) || data.ship_rows.length > 5000 || !['mmsi', 'lat', 'lng', 'observed_at'].every(f => data.fields.includes(f)) || !/^[a-f0-9]{24}$/.test(data.snapshot_id || '') || snapshot && snapshot !== data.snapshot_id) throw new Error('Invalid vessel data');
        cached = new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
        ctx.waitUntil(cache.put(key, cached.clone()).catch(() => {}));
      }
      if (!data) data = await readJSON(cached);
      const fields = data.fields, index = Object.fromEntries(fields.map((f, i) => [f, i])), ships = [];
      for (const row of data.ship_rows) {
        if (!Array.isArray(row)) continue;
        const lat = row[index.lat], lng = row[index.lng];
        if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lng) > 180 || lat < south || lat > north || wrap(lng - west) < 0 || ((lng - west) % 360 + 360) % 360 > east - west) continue;
        ships.push({ mmsi: row[index.mmsi], lat, lng, name: row[index.name], type: row[index.type_name], country: row[index.country], destination: row[index.destination],
          heading: row[index.heading], course: row[index.cog], speed: row[index.sog], source: row[index.source], observed: row[index.position_observed_at] ?? row[index.observed_at] });
      }
      const next = typeof data.cursor === 'string' && /^[1-9]\d{3,5}$/.test(data.cursor) && +data.cursor > +(cursor || 0) && +data.cursor % 5000 === 0 ? data.cursor : '';
      const limited = data.truncated === true && !next || +next > 55000;
      const pages = Number.isSafeInteger(data.total_available) && data.total_available >= 0 ? Math.min(12, Math.max(1, Math.ceil(data.total_available / 5000))) : null;
      return reply({ now: Date.now(), ships, pages, snapshotId: data.snapshot_id, cursor: +next <= 55000 ? next : '', limited, degraded: data.connected !== true || data.freshness?.stale === true });
    } catch (error) {
      console.warn(JSON.stringify({ event: 'vessel_source_unavailable', cause: error instanceof Error ? error.name : 'UnknownError', page: cursor || '0' }));
      return reply({ error: 'Vessel source temporarily unavailable' }, 503, { 'Retry-After': '60' });
    }
  }
};
