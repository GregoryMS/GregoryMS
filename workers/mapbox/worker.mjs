const origins = new Set(['https://maps.gregle.uk', 'https://gregle.uk', 'https://www.gregle.uk']);
const valid = p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180;

async function boundedJSON(response) {
  if (!response.body) throw Error('Missing body');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw Error('Route too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = {'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/json'};
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (value, status = 200) => Response.json(value, {status, headers});
    if (!origins.has(origin)) return reply({error: 'Origin not allowed'}, 403);
    const url = new URL(request.url);
    if (!['/config', '/route'].includes(url.pathname) || url.search) return reply({error: 'Not found'}, 404);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'}});
    if (request.method !== (url.pathname === '/config' ? 'GET' : 'POST')) return reply({error: 'Method not allowed'}, 405);
    if (!env.MAPBOX_PUBLIC_TOKEN) return reply({error: '3D navigation is not configured'}, 503);
    const limited = await env.ROUTE_LIMITER.limit({key: request.headers.get('CF-Connecting-IP') || 'unknown'});
    if (!limited.success) return reply({error: 'Too many requests. Try again shortly.'}, 429);
    // GL JS requires a public token in the browser. The value lives only in a
    // Cloudflare secret, never in the static site or repository.
    if (url.pathname === '/config') return reply({publicToken: env.MAPBOX_PUBLIC_TOKEN});
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '') || Number(request.headers.get('Content-Length')) > 1024) return reply({error: 'Invalid route request'}, 400);
    let body;
    try {
      // Bound chunked requests too, before parsing or contacting Mapbox.
      const reader = request.body?.getReader(); if (!reader) throw Error();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          size += value.byteLength; if (size > 1024) { await reader.cancel(); throw Error(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return reply({error: 'Invalid route request'}, 400); }
    if (!valid(body.from) || !valid(body.to) || typeof body.traffic !== 'boolean') return reply({error: 'Choose valid route endpoints'}, 400);
    const coords = p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
    const profile = body.traffic ? 'driving-traffic' : 'driving';
    const upstream = new URL(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords(body.from)};${coords(body.to)}`);
    for (const [key, value] of Object.entries({access_token: env.MAPBOX_PUBLIC_TOKEN, geometries: 'geojson', overview: 'full', steps: 'true', banner_instructions: 'true', annotations: 'duration,maxspeed', language: 'en', alternatives: 'false'})) upstream.searchParams.set(key, value);
    try {
      const response = await fetch(upstream, {redirect: 'manual', signal: AbortSignal.timeout(12000), headers: {Accept: 'application/json'}});
      if (!response.ok) { await response.body?.cancel(); return reply({error: 'Mapbox directions are temporarily unavailable'}, 502); }
      const data = await boundedJSON(response);
      if (['NoRoute', 'NoSegment'].includes(data.code)) return reply({code: data.code, routes: []});
      if (data.code !== 'Ok' || !data.routes?.length) return reply({error: 'No usable route returned'}, 502);
      // Drop provider messages and arbitrary fields; directions must not be cached.
      return reply({code: 'Ok', routes: data.routes});
    } catch { return reply({error: 'Mapbox directions are temporarily unavailable'}, 502); }
  }
};
