// Only this browser-scoped Google key is returned to the website. Store its value
// as a Cloudflare Worker secret, never in the repository or Wrangler vars.
export function mapsGoogleConfig(request, env) {
  const url = new URL(request.url);
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin'};
  const reply = (body, status) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {status, headers});
  if (url.hostname !== 'maps.gregle.uk') return reply({enabled: false}, 404);
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {status: 405, headers: {...headers, Allow: 'GET, HEAD'}});
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return reply({enabled: false}, 403);
  const browserKey = typeof env?.GOOGLE_MAPS_BROWSER_KEY === 'string' ? env.GOOGLE_MAPS_BROWSER_KEY.trim() : '';
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(browserKey)) return reply({enabled: false, reason: 'not_configured'}, 503);
  return reply({enabled: true, browserKey}, 200);
}
