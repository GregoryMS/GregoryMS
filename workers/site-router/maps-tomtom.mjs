const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {status, headers: {...headers, ...extra}});
const validPoint = p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

async function readBounded(stream, limit) {
  if (!stream) throw Error('Missing body');
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw Error('Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function mapsTomTom(request, env, fetcher = (url, options) => globalThis.fetch(url, options)) {
  const url = new URL(request.url);
  if (url.origin !== 'https://maps.gregle.uk') return reply({error: 'Not found'}, 404);
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return reply({error: 'Not allowed'}, 403);
  const key = typeof env.TOMTOM_API_KEY === 'string' ? env.TOMTOM_API_KEY.trim() : '';
  const configured = /^[A-Za-z0-9_-]{16,256}$/.test(key);
  if (url.pathname === '/api/maps/tomtom-config') {
    if (!['GET', 'HEAD'].includes(request.method)) return reply({error: 'Method not allowed'}, 405, {Allow: 'GET, HEAD'});
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({enabled: configured}), {headers});
  }
  if (url.search) return reply({error: 'Unsupported parameters'}, 400);
  const tile = url.pathname.match(/^\/api\/maps\/tomtom\/tiles\/(\d{1,2})\/(\d{1,10})\/(\d{1,10})$/);
  const routing = url.pathname === '/api/maps/tomtom/route';
  if (!tile && !routing) return reply({error: 'Not found'}, 404);
  if (request.method !== (routing ? 'POST' : 'GET')) return reply({error: 'Method not allowed'}, 405, {Allow: routing ? 'POST' : 'GET'});
  if (!configured) return reply({error: 'TomTom is not configured'}, 503);
  let upstream, options;
  if (tile) {
    const [z, x, y] = tile.slice(1).map(Number);
    if (z > 22 || x >= 2 ** z || y >= 2 ** z) return reply({error: 'Invalid tile'}, 400);
    upstream = `https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/${z}/${x}/${y}?apiVersion=2&style=light&tileSize=256`;
    options = {headers: {'TomTom-Api-Key': key, Accept: 'image/png'}};
  } else {
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply({error: 'JSON required'}, 415);
    let data;
    try { data = JSON.parse(new TextDecoder().decode(await readBounded(request.body, 2048))); }
    catch { return reply({error: 'Invalid route request'}, 400); }
    if (!validPoint(data?.from) || !validPoint(data?.to) || Object.keys(data).some(name => !['from', 'to'].includes(name))) return reply({error: 'Invalid endpoints'}, 400);
    upstream = 'https://api.tomtom.com/maps/orbis/routing/routes/calculate?apiVersion=3';
    options = {method: 'POST', headers: {'Content-Type': 'application/json', 'TomTom-Api-Key': key, Attributes: 'routes', 'Accept-Language': 'en-GB'}, body: JSON.stringify({
      routePlanningLocations: {origin: {type: 'Point', coordinates: [data.from.lng, data.from.lat]}, destination: {type: 'Point', coordinates: [data.to.lng, data.to.lat]}},
      traffic: 'live', departureDateTime: 'now', travelMode: 'car', routeType: 'fast', guidance: 'instructions', instructionPhonetics: 'ipa',
    })};
  }
  // Independent endpoint limits protect the shared key without storing location history.
  const limiter = routing ? env.TOMTOM_ROUTE_LIMIT : env.TOMTOM_TILE_LIMIT;
  if (!limiter) return reply({error: 'TomTom is temporarily unavailable'}, 503);
  let stage = 'limit';
  try {
    const result = await limiter.limit({key: `${routing ? 'route' : 'tile'}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`});
    if (!result.success) return reply({error: 'Please try TomTom again shortly'}, 429, {'Retry-After': '60'});
    stage = 'fetch';
    const response = await fetcher(upstream, {...options, redirect: 'manual', signal: AbortSignal.timeout(14000)});
    if (!response.ok) {
      await response.body?.cancel();
      return reply({error: 'TomTom is unavailable'}, [401, 403, 429].includes(response.status) ? response.status : 502);
    }
    const expected = routing ? 'application/json' : 'image/png';
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith(expected)) { await response.body?.cancel(); return reply({error: 'TomTom is unavailable'}, 502); }
    stage = 'response';
    const bytes = await readBounded(response.body, routing ? 4000000 : 500000);
    // Provider diagnostics are never returned, including accidental credential echoes.
    if (routing) {
      const text = new TextDecoder().decode(bytes);
      if (text.includes(key) || !Array.isArray(JSON.parse(text)?.routes)) return reply({error: 'TomTom is unavailable'}, 502);
    }
    return new Response(bytes, {headers: {...headers, 'Content-Type': expected, 'Cache-Control': routing ? 'no-store' : 'private, max-age=60'}});
  } catch { return reply({error: 'TomTom is temporarily unavailable', code: {limit: 'RATE_LIMIT_UNAVAILABLE', fetch: 'UPSTREAM_UNAVAILABLE', response: 'UPSTREAM_RESPONSE_INVALID'}[stage]}, 502); }
}
