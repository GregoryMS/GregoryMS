const origins = new Set(['https://gregle.uk', 'https://www.gregle.uk', 'https://maps.gregle.uk']);
const sources = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const day = 86400000, freshAge = day, maxAge = 7 * day, limit = 750;
const wrap = n => ((n + 180) % 360 + 360) % 360 - 180;
const round = n => Number(n.toFixed(6));
const quiet = promise => promise.catch(() => {});

export function area(raw) {
  if (!/^-?\d+(\.\d+)?,(-?\d+(\.\d+)?,){2}-?\d+(\.\d+)?$/.test(raw || '')) return null;
  const box = raw.split(',').map(Number), [w, s, e, n] = box;
  if (!box.every(Number.isFinite) || w < -180 || w >= 180 || e <= w || e - w > 2.35 || s < -90 || n > 90 || s >= n || n - s > 1.15) return null;
  // Shared, stable area keys make nearby views and repeat visits reuse the same query.
  const west = round(Math.floor((w + 1e-8) * 20) / 20), east = round(Math.ceil((e - 1e-8) * 20) / 20);
  return [west, round(Math.max(-90, Math.floor((s + 1e-8) * 20) / 20)), east, round(Math.min(90, Math.ceil((n - 1e-8) * 20) / 20))];
}
export function query(box, scope, kind = 'charging_station') {
  const [w, s, e, n] = box;
  const boxes = e > 180 ? [[w, 180], [-180, e - 360]] : [[w, e]];
  const filter = '[~"^(name|brand|network|operator|brand:wikidata|network:wikidata|operator:wikidata|website|contact:website)$"~"Tesla|Supercharg|Q17089620|Q478214",i]';
  const selectors = boxes.flatMap(([west, east]) => {
    const bounds = `(${s},${west},${n},${east});`;
    return kind === 'fuel' ? [`nwr[amenity=fuel]${bounds}`] : scope === 'tesla' ? [`nwr[amenity=charging_station]${filter}${bounds}`, `nwr[amenity=charging_station]["ref:supercharge_info"]${bounds}`] : [`nwr[amenity=charging_station]${bounds}`];
  });
  return `[out:json][timeout:${kind === 'fuel' ? 20 : 8}][maxsize:16777216];${selectors.length > 1 ? `(${selectors.join('')});` : selectors[0]}out center ${limit + 1};`;
}
async function readJSON(response, maxBytes = 2 * 1024 * 1024) {
  if (!response.body) throw new Error('empty_response');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('oversized_response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function normalize(data, box, kind = 'charging_station') {
  if (!Array.isArray(data?.elements) || data.elements.length > limit + 1 || data.remark || !Number.isFinite(Date.parse(data.osm3s?.timestamp_osm_base))) throw new Error('incomplete_response');
  const elements = [], seen = new Set(), [w, s, e, n] = box;
  for (const item of data.elements) {
    if (!['node', 'way', 'relation'].includes(item?.type) || !Number.isSafeInteger(item.id) || item.id < 1 || item.tags?.amenity !== kind) continue;
    const lat = item.type === 'node' ? item.lat : item.center?.lat, lon = item.type === 'node' ? item.lon : item.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < s || lat > n || lon < -180 || lon > 180 || ((lon - w) % 360 + 360) % 360 > e - w || seen.has(`${item.type}/${item.id}`)) continue;
    const tags = {};
    for (const [key, value] of Object.entries(item.tags).slice(0, 120)) if (typeof value === 'string' && key.length <= 100 && /^(amenity|name|brand(:wikidata)?|network(:wikidata)?|operator(:wikidata)?|ref:supercharge_info|socket:[a-zA-Z0-9_:]+|fuel:[a-zA-Z0-9_:]+|access|fee|capacity|motorcar|motor_vehicle|charging_station:output|addr:[a-z_]+|opening_hours|contact:[a-z_]+|website|phone)$/.test(key)) tags[key] = value.slice(0, 1000);
    elements.push({type: item.type, id: item.id, ...(item.type === 'node' ? {lat, lon} : {center: {lat, lon}}), tags}); seen.add(`${item.type}/${item.id}`);
  }
  return {elements, osm3s: {timestamp_osm_base: data.osm3s.timestamp_osm_base}, truncated: data.elements.length > limit};
}
async function serve(request, env, ctx, kind = 'charging_station') {
    const origin = request.headers.get('Origin') || '';
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'Retry-After'};
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {status, headers: {...headers, ...extra}});
    if (!origins.has(origin)) return reply({error: 'Origin not allowed'}, 403);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400'}});
    if (request.method !== 'GET') return reply({error: 'GET required'}, 405, {Allow: 'GET, OPTIONS'});
    const url = new URL(request.url), params = url.searchParams, box = area(params.get('bbox')), scope = params.get('scope') || 'all';
    if (url.pathname !== (kind === 'fuel' ? '/fuel-stations' : '/charging')) return reply({error: 'Not found'}, 404);
    if (!box || !(kind === 'fuel' ? ['all'] : ['all', 'tesla']).includes(scope) || [...params.keys()].some(k => !['bbox', 'scope'].includes(k)) || [...params.keys()].length !== new Set(params.keys()).size) return reply({error: 'Invalid charging area'}, 400);
    const cache = caches.default, prefix = `${url.origin}/cache/${kind === 'fuel' ? 'fuel-v1' : 'ev-v1'}/`, region = box.join(',');
    const key = new Request(`${prefix}${scope}/${region}`), allKey = new Request(`${prefix}all/${region}`), lease = new Request(`${prefix}refresh/${scope}/${region}`), cooldown = new Request(`${prefix}cooldown`);
    async function stored(k) {
      const response = await cache.match(k); if (!response) return null;
      const data = await readJSON(response);
      return Number.isFinite(data.fetchedAt) && data.fetchedAt <= Date.now() && Date.now() - data.fetchedAt < maxAge && Array.isArray(data.elements) && data.elements.length <= limit + 1 ? data : null;
    }
    async function update() {
      if(env.OCM_RATE_LIMIT&&!((await env.OCM_RATE_LIMIT.limit({key:request.headers.get('CF-Connecting-IP')||'anonymous'})).success))throw Object.assign(new Error('rate_limited'),{retryAfter:60});
      let failure;
      for (const endpoint of sources) {
        try {
          const paused = await cache.match(cooldown);
          if (paused) { const error = new Error('provider_cooldown'); error.stop = true; error.retryAfter = Number(paused.headers.get('Retry-After')) || 60; throw error; }
          const sourceURL = new URL(endpoint);
          // Short, stable GET queries let public Overpass mirrors reuse their response caches.
          // Keep the existing charging query protocol unchanged.
          const body = new URLSearchParams({data: query(box, scope, kind)});
          if (kind === 'fuel') sourceURL.search = body;
          const response = await fetch(sourceURL.href, {headers: {Accept: 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)'}, redirect: 'manual', method: kind === 'fuel' ? 'GET' : 'POST', ...(kind === 'fuel' ? {} : {body}), signal: AbortSignal.timeout(kind === 'fuel' ? 30000 : 20000)});
          if (!response.ok) {
            const retry = response.headers.get('Retry-After'), seconds = retry && /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry || '') - Date.now()) / 1000);
            await response.body?.cancel();
            const error = new Error(`upstream_${response.status}`);
            error.stop = !!retry || [403, 406, 429].includes(response.status); error.retryAfter = Math.min(3600, Math.max(60, seconds || 60));
            if (error.stop) await quiet(cache.put(cooldown, new Response('paused', {headers: {'Cache-Control': `public, max-age=${error.retryAfter}`, 'Retry-After': String(error.retryAfter)}})));
            throw error;
          }
          const entry = {...normalize(await readJSON(response), box, kind), fetchedAt: Date.now(), area: box, scope};
          await quiet(cache.put(key, new Response(JSON.stringify(entry), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800'}})));
          return entry;
        } catch (error) { console.warn(JSON.stringify({event: 'ev_provider_failed', provider: new URL(endpoint).hostname, cause: String(error.message).slice(0, 80)})); failure = error; if (error.stop) break; }
      }
      throw failure || new Error('source_unavailable');
    }
    try {
      let entry = scope === 'tesla' ? await stored(allKey) : null;
      if (entry?.truncated) entry = null;
      entry ||= await stored(key);
      const stale = !!entry && Date.now() - entry.fetchedAt >= freshAge;
      if (entry && stale) {
        if (!await cache.match(cooldown) && !await cache.match(lease)) {
          await quiet(cache.put(lease, new Response('refreshing', {headers: {'Cache-Control': 'public, max-age=30'}})));
          ctx.waitUntil((async () => { try { await update(); } catch (error) { console.warn(JSON.stringify({event: 'ev_refresh_delayed',cause: String(error.message).slice(0, 80)})); } finally { await quiet(cache.delete(lease)); } })());
        }
      }
      if (!entry) {
        const paused = await cache.match(cooldown);
        if (paused) return reply({error: 'Station source temporarily unavailable'}, 503, {'Retry-After': paused.headers.get('Retry-After') || '60'});
        entry = await update();
      }
      return reply({...entry, gregle: {fetchedAt: entry.fetchedAt, area: entry.area, scope: entry.scope, stale, cached: Date.now() - entry.fetchedAt > 1000}});
    } catch (error) {
      console.warn(JSON.stringify({event: 'ev_source_unavailable', cause: String(error.message).slice(0, 80)}));
      return reply({error: 'Station source temporarily unavailable'}, 503, {'Retry-After': String(error.retryAfter || 60)});
    }
}
export default {fetch: serve};
export const fuelStations = {fetch: (request, env, ctx) => serve(request, env, ctx, 'fuel')};
