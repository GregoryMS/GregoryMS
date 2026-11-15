// Fixed, bounded Open-Meteo relay: browser networks need only reach Gregle.
export async function astroForecast(request, fetcher = (url, options) => globalThis.fetch(url, options)) {
  const headers = {'Cache-Control':'no-store', 'Content-Type':'application/json; charset=utf-8', 'X-Content-Type-Options':'nosniff'};
  const fail = (status, error) => new Response(request.method === 'HEAD' ? null : JSON.stringify({error}), {status, headers});
  if (!['GET','HEAD'].includes(request.method)) return new Response(null, {status:405, headers:{Allow:'GET, HEAD'}});
  const query = new URL(request.url).searchParams;
  const lat = query.get('latitude'), lon = query.get('longitude');
  if ([...query.keys()].some(key => !['latitude','longitude'].includes(key)) ||
      query.getAll('latitude').length !== 1 || query.getAll('longitude').length !== 1 ||
      ![lat,lon].every(value => /^-?\d{1,3}(?:\.\d{1,2})?$/.test(value || '')) ||
      Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) return fail(400, 'Invalid coordinates');
  const params = new URLSearchParams({latitude:Number(lat).toFixed(2), longitude:Number(lon).toFixed(2),
    current:'temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m',
    hourly:'cloud_cover,temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,precipitation_probability,visibility',
    timeformat:'unixtime', timezone:'auto', forecast_days:'4', temperature_unit:'celsius', wind_speed_unit:'kmh'});
  try {
    const response = await fetcher('https://api.open-meteo.com/v1/forecast?' + params, {
      headers:{Accept:'application/json'}, redirect:'manual', signal:AbortSignal.timeout(8000),
      cf:{cacheEverything:true, cacheTtlByStatus:{'200-299':300, '300-599':0}}
    });
    if (!response.ok || !/application\/json/i.test(response.headers.get('Content-Type') || '')) {
      await response.body?.cancel(); throw Error('Upstream unavailable');
    }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 300000) { await reader.cancel(); throw Error('Response too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    return new Response(request.method === 'HEAD' ? null : bytes, {headers:{...headers,'Cache-Control':'public, max-age=60'}});
  } catch {
    console.warn(JSON.stringify({event:'astro_forecast_unavailable'}));
    return fail(503, 'Forecast temporarily unavailable');
  }
}
