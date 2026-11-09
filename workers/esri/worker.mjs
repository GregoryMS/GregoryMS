const origins = new Set(['https://maps.gregle.uk', 'https://gregle.uk', 'https://www.gregle.uk']);
const maxBytes = 2 * 1024 * 1024;

async function readImage(response) {
  if (!response.body) throw Error('Missing tile');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw Error('Tile too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (!jpeg && !png) throw Error('Invalid image');
  return {bytes, type: jpeg ? 'image/jpeg' : 'image/png'};
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = {'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff'};
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const error = (message, status) => new Response(message, {status, headers});
    if (!origins.has(origin)) return error('Origin not allowed', 403);
    const url = new URL(request.url);
    const match = /^\/tiles\/(0|[1-9]\d?)\/(0|[1-9]\d{0,9})\/(0|[1-9]\d{0,9})\.jpg$/.exec(url.pathname);
    if (!match || url.search) return error('Not found', 404);
    const [z, x, y] = match.slice(1).map(Number);
    if (z > 23 || x >= 2 ** z || y >= 2 ** z) return error('Invalid tile', 400);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400'}});
    if (request.method !== 'GET') return new Response('GET required', {status: 405, headers: {...headers, Allow: 'GET, OPTIONS'}});
    if (!env.ESRI_API_KEY) return error('Satellite imagery is not configured', 503);
    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/cache/esri-v2/${z}/${x}/${y}.jpg`);
    const send = response => {
      const h = new Headers(response.headers);
      h.set('Access-Control-Allow-Origin', origin); h.set('Vary', 'Origin');
      h.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, {status: response.status, headers: h});
    };
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return send(cached);
      // Limit cache misses per location; cached images do not use Esri quota.
      const allowed = await env.TILE_LIMITER.limit({key: 'esri-tile-misses'});
      if (!allowed.success) return new Response('Satellite imagery is busy; retry shortly', {status: 429, headers: {...headers, 'Retry-After': '60'}});
      const upstream = new URL(`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
      upstream.searchParams.set('blankTile', 'false');
      upstream.searchParams.set('token', env.ESRI_API_KEY);
      const response = await fetch(upstream, {headers: {Accept: 'image/jpeg, image/png'}, redirect: 'manual', signal: AbortSignal.timeout(10000)});
      if (!response.ok || !/^image\/(jpeg|png)(;|$)/i.test(response.headers.get('Content-Type') || '')) {
        await response.body?.cancel();
        return error('Satellite imagery is temporarily unavailable', 502);
      }
      const image = await readImage(response);
      const tile = new Response(image.bytes, {headers: {'Content-Type': image.type, 'Cache-Control': 'public, max-age=3600'}});
      ctx.waitUntil(cache.put(cacheKey, tile.clone()).catch(() => {}));
      return send(tile);
    } catch {
      // Never return provider error bodies or exception URLs containing the key.
      return error('Satellite imagery is temporarily unavailable', 502);
    }
  }
};
