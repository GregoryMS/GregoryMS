const source = 'https://www.drivebc.ca/api/dms/';
const origins = new Set(['https://gregle.uk', 'https://www.gregle.uk']);
const fields = ['name', 'description', 'roadway_name', 'roadway_direction', 'status', 'message_display_1', 'message_display_2', 'message_display_3', 'message_text', 'updated_datetime_utc', 'message_expiry_datetime_utc', 'cache_datetime_utc'];

export function snapshot(data, now = new Date()) {
  if (!Array.isArray(data) || !data.length || data.length > 2000) throw new Error('Invalid sign feed');
  const signs = [], seen = new Set();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '').trim().slice(0, 128), location = item.location;
    const [lng, lat] = Array.isArray(location?.coordinates) ? location.coordinates : [];
    if (!id || seen.has(id) || location?.type !== 'Point' || ![lng, lat].every(x => typeof x === 'number' && Number.isFinite(x)) || lat < 48 || lat > 60.1 || lng < -139.1 || lng > -114) continue;
    const sign = { id, location: { type: 'Point', coordinates: [lng, lat] }, is_on: item.is_on !== false };
    for (const field of fields) if (typeof item[field] === 'string') sign[field] = item[field].trim().slice(0, 4000);
    signs.push(sign); seen.add(id);
  }
  if (!signs.length) throw new Error('No valid signs');
  return { source, fetchedAt: now.toISOString(), signs };
}

async function readJSON(response) {
  if (!response.body) throw new Error('Empty feed');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2000000) { await reader.cancel(); throw new Error('Oversized feed'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'Retry-After' };
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
    if (!origins.has(origin)) return reply({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return reply({ error: 'GET required' }, 405, { Allow: 'GET, OPTIONS' });
    const url = new URL(request.url);
    if (url.pathname !== '/messages' || url.search) return reply({ error: 'Not found' }, 404);
    const cache = caches.default, key = new Request(`${url.origin}/cache/messages-v1`), cooldown = new Request(`${url.origin}/cooldown/messages-v1`);
    const send = response => {
      const h = new Headers(response.headers); h.set('Access-Control-Allow-Origin', origin); h.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers: h });
    };
    try {
      const cached = await cache.match(key);
      if (cached) return send(cached);
      const paused = await cache.match(cooldown);
      if (paused) return send(paused);
      const response = await fetch(source, { headers: { Accept: 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        const retry = response.headers.get('Retry-After');
        const delay = Math.min(900, Math.max(60, /^\d+$/.test(retry || '') ? Number(retry) : Math.ceil((Date.parse(retry || '') - Date.now()) / 1000) || 60));
        await response.body?.cancel();
        const error = reply({ error: 'DriveBC messages temporarily unavailable' }, response.status === 429 ? 429 : 503, { 'Retry-After': String(delay), 'Cache-Control': `public, max-age=${delay}` });
        ctx.waitUntil(cache.put(cooldown, error.clone())); return send(error);
      }
      const result = reply(snapshot(await readJSON(response)), 200, { 'Cache-Control': 'public, max-age=60' });
      ctx.waitUntil(cache.put(key, result.clone()));
      return send(result);
    } catch {
      return reply({ error: 'DriveBC messages temporarily unavailable' }, 503, { 'Retry-After': '60' });
    }
  }
};
