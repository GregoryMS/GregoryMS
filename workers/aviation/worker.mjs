const origins = new Set(['https://gregle.uk', 'https://www.gregle.uk', 'https://maps.gregle.uk']);
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const maxBytes = 2 * 1024 * 1024;

/** @param {Response} response */
async function readPNG(response) {
  if (!response.body) throw new Error('Empty tile');
  if (Number(response.headers.get('Content-Length')) > maxBytes) { await response.body.cancel(); throw new Error('Invalid tile size'); }
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error('Tile too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!pngSignature.every((value, i) => bytes[i] === value)) throw new Error('Invalid PNG');
  return bytes;
}

/** @type {ExportedHandler<Cloudflare.Env>} */
const worker = {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = new Headers({'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'Retry-After'});
    if (origins.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
    /** @param {string} message @param {number} status @param {number} [retry] */
    const error = (message, status, retry) => {
      const h = new Headers(headers); h.set('Content-Type', 'application/json');
      if (retry) h.set('Retry-After', String(retry));
      return new Response(JSON.stringify({error: message}), {status, headers: h});
    };
    if (!origins.has(origin)) return error('Origin not allowed', 403);
    const url = new URL(request.url), match = /^\/tiles\/(0|[1-9]\d?)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.png$/.exec(url.pathname);
    if (!match || url.search) return error('Not found', 404);
    const [z, x, y] = match.slice(1).map(Number);
    if (z < 2 || z > 14 || x >= 2 ** z || y >= 2 ** z) return error('Invalid tile coordinates', 400);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set('Access-Control-Max-Age', '86400');
      return new Response(null, {status: 204, headers});
    }
    if (request.method !== 'GET') { headers.set('Allow', 'GET, OPTIONS'); return error('GET required', 405); }
    if (!env.OPENAIP_API_KEY) return error('Aviation charts are not configured', 503, 60);
    const cache = caches.default, cacheKey = new Request(`${url.origin}/cache/openaip-v1/${z}/${x}/${y}.png`);
    const cooldown = new Request(`${url.origin}/cooldown/openaip-v1`);
    /** @param {Response} response */
    const send = response => {
      const h = new Headers(response.headers);
      for (const [name, value] of headers) h.set(name, value);
      if (response.ok) h.set('Cache-Control', 'public, max-age=3600');
      return new Response(response.body, {status: response.status, headers: h});
    };
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return send(cached);
      const paused = await cache.match(cooldown);
      if (paused) return send(paused);
      // Only cache misses use quota. A shared limit bounds this relay's upstream
      // demand per Cloudflare location without collecting visitor identifiers.
      const allowed = await env.TILE_LIMITER.limit({key: 'openaip-tile-misses'});
      if (!allowed.success) return error('Aviation charts are busy; retry shortly', 429, 60);
      const upstream = await fetch(`https://api.tiles.openaip.net/api/data/openaip/${z}/${x}/${y}.png`, {
        headers: {'x-openaip-api-key': env.OPENAIP_API_KEY, 'Accept': 'image/png'},
        redirect: 'manual', signal: AbortSignal.timeout(10000)
      });
      if (!upstream.ok) {
        const value = upstream.headers.get('Retry-After');
        const parsed = value && /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value || '') - Date.now()) / 1000);
        const wait = Math.min(86400, Math.max(60, Number.isFinite(parsed) ? parsed : 60));
        await upstream.body?.cancel();
        const response = new Response(JSON.stringify({error: 'Aviation chart source temporarily unavailable'}), {
          status: upstream.status === 429 ? 429 : 503,
          headers: {'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${wait}`, 'Retry-After': String(wait)}
        });
        await cache.put(cooldown, response.clone());
        return send(response);
      }
      let response;
      if (upstream.status === 204) response = new Response(null, {status: 204, headers: {'Cache-Control': 'public, max-age=3600'}});
      else {
        if (upstream.headers.get('Content-Type')?.split(';')[0] !== 'image/png') { await upstream.body?.cancel(); throw new Error('Unexpected tile type'); }
        const bytes = await readPNG(upstream);
        response = new Response(bytes, {headers: {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600'}});
      }
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return send(response);
    } catch {
      // Never log upstream responses or exception text, which may contain credentials.
      console.warn(JSON.stringify({event: 'aviation_tile_unavailable'}));
      const response = error('Aviation charts temporarily unavailable', 503, 60);
      const cached = new Response(response.clone().body, {status: 503, headers: {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Retry-After': '60'}});
      try { await cache.put(cooldown, cached); } catch { /* Return the sanitized failure if cache is unavailable. */ }
      return response;
    }
  }
};
export default worker;
