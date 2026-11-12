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
  const upstream = new URL('https://photon.komoot.io/api/');
  upstream.searchParams.set('q', term);
  upstream.searchParams.set('lang', 'en');
  for (const [key, min, max, integer] of [['limit', 1, 20, true], ['lat', -90, 90], ['lon', -180, 180], ['zoom', 0, 19, true], ['location_bias_scale', 0, 1]]) {
    if (!params.has(key)) continue;
    const value = Number(params.get(key));
    if (!params.get(key).trim() || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) return reply({error: 'Invalid search area'}, 400);
    upstream.searchParams.set(key, String(value));
  }
  if (!params.has('limit')) upstream.searchParams.set('limit', '6');
  if (params.has('bbox')) {
    const parts = params.get('bbox').split(','), box = parts.map(Number);
    if (parts.length !== 4 || parts.some(p => !p.trim()) || box.some((v, i) => !Number.isFinite(v) || Math.abs(v) > (i % 2 ? 90 : 180)) || box[0] >= box[2] || box[1] >= box[3]) return reply({error: 'Invalid search area'}, 400);
    upstream.searchParams.set('bbox', box.join(','));
  }
  if (request.method === 'HEAD') return reply(null);
  if (env.MAPS_SEARCH_LIMIT && !(await env.MAPS_SEARCH_LIMIT.limit({key: request.headers.get('CF-Connecting-IP') || 'unknown'})).success) return reply({error: 'Please wait before searching again'}, 429);
  const key = typeof env.TOMTOM_API_KEY === 'string' ? env.TOMTOM_API_KEY.trim() : '';
  if (/^[A-Za-z0-9_-]{16,256}$/.test(key)) {
    try {
      const tomtom = new URL(`https://api.tomtom.com/maps/orbis/places/search/${encodeURIComponent(term)}.json`);
      for (const [name, value] of Object.entries({key, apiVersion: '1', typeahead: 'true', limit: upstream.searchParams.get('limit'), language: 'en-GB'})) tomtom.searchParams.set(name, value);
      if (upstream.searchParams.has('lat') && upstream.searchParams.has('lon')) tomtom.searchParams.set('geobias', `point:${upstream.searchParams.get('lat')},${upstream.searchParams.get('lon')}`);
      if (upstream.searchParams.has('bbox')) {
        const [west, south, east, north] = upstream.searchParams.get('bbox').split(',');
        tomtom.searchParams.set('topLeft', `${north},${west}`);
        tomtom.searchParams.set('btmRight', `${south},${east}`);
      }
      const data = await readJSON(await fetch(tomtom, {headers: {Accept: 'application/json'}, redirect: 'manual', signal: AbortSignal.timeout(3500)}));
      if (!Array.isArray(data?.results)) throw Error('Invalid search response');
      const text = value => typeof value === 'string' ? value.replaceAll(key, '').slice(0, 180) : '';
      const features = data.results.slice(0, 20).filter(r => Number.isFinite(r.position?.lat) && Math.abs(r.position.lat) <= 90 && Number.isFinite(r.position?.lon) && Math.abs(r.position.lon) <= 180).map(r => {
        const a = r.address || {};
        return {type: 'Feature', geometry: {type: 'Point', coordinates: [r.position.lon, r.position.lat]}, properties: {
          name: text(r.poi?.name || a.freeformAddress || a.municipality || term),
          street: text(a.streetName), housenumber: text(a.streetNumber), postcode: text(a.postalCode),
          city: text(a.municipality), state: text(a.countrySubdivisionName || a.countrySubdivision), country: text(a.country),
        }};
      });
      return reply({type: 'FeatureCollection', features});
    } catch { /* Photon remains available if the configured key cannot search. */ }
  }
  try {
    const response = await fetch(upstream, {headers: {Accept: 'application/json'}, redirect: 'manual', signal: AbortSignal.timeout(4500)});
    if (response.status === 429) { await response.body?.cancel(); return reply({error: 'Please wait before searching again'}, 429); }
    const data = await readJSON(response);
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw Error('Invalid search response');
    return reply({type: 'FeatureCollection', features: data.features.slice(0, 20)});
  } catch {
    return reply({error: 'Place search temporarily unavailable'}, 502);
  }
}
