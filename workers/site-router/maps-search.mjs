const origins = new Set(['https://maps.gregle.uk', 'https://gregle.uk', 'https://gregoryms.github.io']);

async function readJSON(response) {
  if (!response.ok) { await response.body?.cancel(); throw Error('Search provider unavailable'); }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 262144) { await reader.cancel(); throw Error('Search response too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Fixed provider URLs prevent an open proxy. Credentials stay on the Worker.
export async function mapsSearch(request, env = {}) {
  const url = new URL(request.url), origin = request.headers.get('Origin');
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin'};
  if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (body, status = 200) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {status, headers});
  if (origin && !origins.has(origin) || !origin && request.headers.get('Sec-Fetch-Site') === 'cross-site') return reply({error: 'Forbidden'}, 403);
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {status: 405, headers: {...headers, Allow: 'GET, HEAD'}});
  const params = url.searchParams, term = (params.get('q') || '').trim();
  const allowed = new Set(['q', 'limit', 'lang', 'lat', 'lon', 'zoom', 'location_bias_scale', 'bbox']);
  if (term.length < 2 || term.length > 180 || [...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)) return reply({error: 'Invalid search'}, 400);
  const upstream = new URL('https://api.overpass.ch/v1/geocode/api');
  upstream.searchParams.set('q', term);
  upstream.searchParams.set('lang', 'en');
  for (const [key, min, max, integer] of [['limit', 1, 20, true], ['lat', -90, 90], ['lon', -180, 180], ['zoom', 0, 19, true], ['location_bias_scale', 0, 1]]) {
    if (!params.has(key)) continue;
    const value = Number(params.get(key));
    if (!params.get(key).trim() || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) return reply({error: 'Invalid search area'}, 400);
    upstream.searchParams.set(key, String(key === 'zoom' ? Math.min(18, value) : value));
  }
  if (!params.has('limit')) upstream.searchParams.set('limit', '6');
  if (params.has('bbox')) {
    const parts = params.get('bbox').split(','), box = parts.map(Number);
    if (parts.length !== 4 || parts.some(p => !p.trim()) || box.some((v, i) => !Number.isFinite(v) || Math.abs(v) > (i % 2 ? 90 : 180)) || box[0] >= box[2] || box[1] >= box[3]) return reply({error: 'Invalid search area'}, 400);
    upstream.searchParams.set('bbox', box.join(','));
  }
  if (request.method === 'HEAD') return reply(null);
  if (env.MAPS_SEARCH_LIMIT && !(await env.MAPS_SEARCH_LIMIT.limit({key: request.headers.get('CF-Connecting-IP') || 'unknown'})).success) return reply({error: 'Please wait before searching again'}, 429);
  const key = typeof env.OVERPASS_GEOCODING_API_KEY === 'string' ? env.OVERPASS_GEOCODING_API_KEY.trim() : '';
  if (!/^ovp_[A-Za-z0-9_-]{20,128}$/.test(key)) return reply({error: 'Place search temporarily unavailable'}, 503);
  try {
    const response = await fetch(upstream, {headers: {Accept: 'application/json', 'X-API-Key': key}, redirect: 'manual', signal: AbortSignal.timeout(8000)});
    if (response.status === 429) { await response.body?.cancel(); return reply({error: 'Please wait before searching again'}, 429); }
    const data = await readJSON(response);
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw Error('Invalid search response');
    // Never return a credential even if a provider accidentally echoes a header.
    const features = JSON.parse(JSON.stringify(data.features.slice(0, 20)).replaceAll(key, ''));
    return reply({type: 'FeatureCollection', features});
  } catch {
    return reply({error: 'Place search temporarily unavailable'}, 502);
  }
}
