// Public, government-funded daily survey. Preserve the observation date and source.
export const sourceURL = 'https://charting.kalibrate.com/WPPS_Public/DPPS_Public.htm';
const day = 86400000;
const cities = `WHITEHORSE|Whitehorse|YT|60.7212|-135.0568
VANCOUVER|Vancouver|BC|49.2827|-123.1207
VICTORIA|Victoria|BC|48.4284|-123.3656
PRINCE GEORGE|Prince George|BC|53.9171|-122.7497
KAMLOOPS|Kamloops|BC|50.6745|-120.3273
KELOWNA|Kelowna|BC|49.8880|-119.4960
FORT ST JOHN|Fort St. John|BC|56.2465|-120.8476
ABBOTSFORD|Abbotsford|BC|49.0504|-122.3045
YELLOWKNIFE|Yellowknife|NT|62.4540|-114.3718
CALGARY|Calgary|AB|51.0447|-114.0719
RED DEER|Red Deer|AB|52.2681|-113.8112
EDMONTON|Edmonton|AB|53.5461|-113.4938
LETHBRIDGE|Lethbridge|AB|49.6956|-112.8451
LLOYDMINSTER|Lloydminster|AB/SK|53.2780|-110.0050
GRANDE PRAIRIE|Grande Prairie|AB|55.1707|-118.7947
REGINA|Regina|SK|50.4452|-104.6189
SASKATOON|Saskatoon|SK|52.1332|-106.6700
PRINCE ALBERT|Prince Albert|SK|53.2033|-105.7531
MOOSE JAW|Moose Jaw|SK|50.3934|-105.5519
WINNIPEG|Winnipeg|MB|49.8951|-97.1384
BRANDON|Brandon|MB|49.8485|-99.9501
CITY OF TORONTO|Toronto|ON|43.6532|-79.3832
BRAMPTON|Brampton|ON|43.7315|-79.7624
ETOBICOKE|Etobicoke|ON|43.6205|-79.5132
MISSISSAUGA|Mississauga|ON|43.5890|-79.6441
NORTH YORK|North York|ON|43.7615|-79.4111
SCARBOROUGH|Scarborough|ON|43.7764|-79.2318
VAUGHAN MARKHAM|Vaughan / Markham|ON|43.8563|-79.4260
OTTAWA|Ottawa|ON|45.4215|-75.6972
KINGSTON|Kingston|ON|44.2312|-76.4860
PETERBOROUGH|Peterborough|ON|44.3091|-78.3197
WINDSOR|Windsor|ON|42.3149|-83.0364
LONDON|London|ON|42.9849|-81.2453
SUDBURY|Sudbury|ON|46.4917|-80.9930
SAULT STE MARIE|Sault Ste. Marie|ON|46.5219|-84.3461
THUNDER BAY|Thunder Bay|ON|48.3809|-89.2477
NORTH BAY|North Bay|ON|46.3091|-79.4608
TIMMINS|Timmins|ON|48.4758|-81.3305
HAMILTON|Hamilton|ON|43.2557|-79.8711
ST CATHARINES|St. Catharines|ON|43.1594|-79.2469
BARRIE|Barrie|ON|44.3894|-79.6903
BRANTFORD|Brantford|ON|43.1394|-80.2644
GUELPH|Guelph|ON|43.5448|-80.2482
KITCHENER|Kitchener|ON|43.4516|-80.4925
OSHAWA|Oshawa|ON|43.8971|-78.8658
SARNIA|Sarnia|ON|42.9745|-82.4066
MONTREAL|Montréal|QC|45.5019|-73.5674
QUEBEC|Québec City|QC|46.8139|-71.2080
SHERBROOKE|Sherbrooke|QC|45.4042|-71.8929
GASPE|Gaspé|QC|48.8316|-64.4869
CHICOUTIMI|Chicoutimi|QC|48.4277|-71.0594
RIMOUSKI|Rimouski|QC|48.4488|-68.5230
TROIS RIVIERES|Trois-Rivières|QC|46.3432|-72.5430
DRUMMONDVILLE|Drummondville|QC|45.8803|-72.4843
VAL D OR|Val-d’Or|QC|48.1002|-77.7828
GATINEAU|Gatineau|QC|45.4765|-75.7013
SAINT JOHN|Saint John|NB|45.2733|-66.0633
FREDERICTON|Fredericton|NB|45.9636|-66.6431
MONCTON|Moncton|NB|46.0878|-64.7782
BATHURST|Bathurst|NB|47.6181|-65.6510
EDMUNDSTON|Edmundston|NB|47.3737|-68.3251
MIRAMICHI|Miramichi|NB|47.0296|-65.5059
CAMPBELLTON|Campbellton|NB|48.0044|-66.6731
SUSSEX|Sussex|NB|45.7227|-65.5119
WOODSTOCK|Woodstock|NB|46.1500|-67.6034
HALIFAX|Halifax|NS|44.6488|-63.5752
SYDNEY|Sydney|NS|46.1368|-60.1942
YARMOUTH|Yarmouth|NS|43.8375|-66.1174
TRURO|Truro|NS|45.3656|-63.2793
KENTVILLE|Kentville|NS|45.0771|-64.4953
NEW GLASGOW|New Glasgow|NS|45.5872|-62.6451
CHARLOTTETOWN|Charlottetown|PE|46.2382|-63.1311
ST JOHNS|St. John’s|NL|47.5615|-52.7126
GANDER|Gander|NL|48.9560|-54.6080
LABRADOR CITY|Labrador City|NL|52.9390|-66.9142
CORNER BROOK|Corner Brook|NL|48.9501|-57.9400
GRAND FALLS|Grand Falls-Windsor|NL|48.9280|-55.6650`.split('\n').map(line => {
  const [key, name, province, lat, lng] = line.split('|');
  return {key, name, province, lat: Number(lat), lng: Number(lng)};
});
const keyOf = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const plain = html => html.replace(/&(?:Eacute|Egrave|eacute|egrave);/g, entity => ({'&Eacute;':'É','&Egrave;':'È','&eacute;':'é','&egrave;':'è'})[entity]).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
export function parseSurvey(html, now = Date.now()) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => plain(cell[1])));
  const heading = rows.find(row => /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(row[0] || ''));
  if (!heading || !/Regular.*Mid-Grade.*Premium.*Diesel/i.test(heading.join(' '))) throw Error('survey_format_changed');
  const stamp = Date.parse(heading[0] + ' 00:00:00 GMT');
  if (!Number.isFinite(stamp) || stamp > now || now - stamp > 4 * day) throw Error('survey_date_unavailable');
  const byName = new Map(cities.map(city => [city.key, city])), markets = [], seen = new Set(); let canada = null;
  for (const row of rows) {
    if (row.length !== 23) continue;
    const key = keyOf(row[0]), city = byName.get(key);
    if (!city && key !== 'CANADA AVERAGE V') continue;
    if (seen.has(key)) throw Error('duplicate_market');
    seen.add(key);
    const prices = Object.fromEntries(['regular', 'midgrade', 'premium', 'diesel'].map((fuel, index) => {
      const raw = row[1 + index * 4], value = /^\d{1,3}\.\d$/.test(raw) ? Number(raw) : NaN;
      return [fuel, Number.isFinite(value) && value >= 20 && value <= 500 ? value : null];
    }));
    if (city) { const {key: unused, ...location} = city; markets.push({...location, prices}); }
    else canada = prices;
  }
  if (markets.filter(m => m.prices.regular !== null).length < 50 || !markets.some(m => m.name === 'Victoria') || !canada?.regular) throw Error('incomplete_survey');
  return {source: 'Kalibrate Canada', sourceURL, date: new Date(stamp).toISOString().slice(0, 10), unit: 'CAD cents/litre', markets, canada};
}
async function readSurvey(response) {
  if (!response.body) throw Error('empty_response');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 500000) { await reader.cancel(); throw Error('oversized_response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder('windows-1252').decode(bytes);
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin'), allowed = ['https://gregle.uk', 'https://www.gregle.uk'].includes(origin);
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', ...(allowed ? {'Access-Control-Allow-Origin': origin} : {})};
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers});
    if (!allowed) return reply({error: 'Origin not allowed'}, 403);
    if (request.method !== 'GET') return reply({error: 'GET required'}, 405);
    const url = new URL(request.url);
    if (url.pathname !== '/fuel-prices' || url.search) return reply({error: 'Invalid request'}, 400);
    const cache = caches.default, key = new Request(url.origin + '/cache/canada-daily-fuel-v1');
    let stored;
    try {
      stored = await cache.match(key); stored = stored ? await stored.json() : null;
      if (stored?.markets?.length && Number.isFinite(stored.fetchedAt) && stored.fetchedAt <= Date.now() && Date.now() - stored.fetchedAt < 1800000 && Date.now() - Date.parse(stored.date) <= 4 * day) return reply(stored);
      if (env.OCM_RATE_LIMIT && !(await env.OCM_RATE_LIMIT.limit({key: request.headers.get('CF-Connecting-IP') || 'anonymous'})).success) throw Error('rate_limited');
      const response = await fetch(sourceURL, {headers: {Accept: 'text/html', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)'}, redirect: 'manual', signal: AbortSignal.timeout(15000)});
      if (!response.ok) { await response.body?.cancel(); throw Error('survey_unavailable'); }
      const data = {...parseSurvey(await readSurvey(response)), fetchedAt: Date.now()};
      await cache.put(key, new Response(JSON.stringify(data), {headers: {'Cache-Control': 'public, max-age=345600'}})).catch(() => {});
      return reply(data);
    } catch {
      if (stored?.markets?.length && Date.now() - Date.parse(stored.date) <= 4 * day) return reply({...stored, delayed: true});
      return reply({error: 'Daily fuel survey unavailable'}, 503);
    }
  }
};
