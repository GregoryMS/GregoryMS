// Fixed, public emulator assets. Never forward caller cookies or credentials.
const FILES = new Map([
  ['tigraphing.min.js', ['js/tigraphing.min.js', 'text/javascript; charset=utf-8']],
  ['ti84.js', ['js/ti84.js', 'text/javascript; charset=utf-8']],
  ['ti84-7.0.0.4117.worker.js', ['js/ti84-7.0.0.4117.worker.js', 'text/javascript; charset=utf-8']],
  ['ti84-7.0.0.4117.wasm', ['js/ti84-7.0.0.4117.wasm', 'application/wasm']],
  ['ti84-7.0.0.4117.data', ['js/ti84-7.0.0.4117.data', 'application/octet-stream']],
  ['styles.dfbb85698a29160d.css', ['css/styles.dfbb85698a29160d.css', 'text/css; charset=utf-8']],
  ['lato-regular.woff2', ['css/lato-regular.woff2', 'font/woff2']],
]);

export function isolateCalculator(response) {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

export async function evoAsset(request) {
  const name = new URL(request.url).pathname.slice('/assets/ti84evo/vendor/'.length);
  const file = FILES.get(name);
  if (!file) return new Response('Not found', {status: 404});
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
  try {
    const response = await fetch('https://ti84evo.pages.dev/' + file[0], {
      method: request.method, redirect: 'manual', signal: AbortSignal.timeout(30000),
      cf: {cacheEverything: true, cacheTtl: 86400},
    });
    if (!response.ok || /text\/html/i.test(response.headers.get('Content-Type') || '')) throw new Error('Emulator asset unavailable');
    return isolateCalculator(new Response(response.body, {headers: {
      'Content-Type': file[1], 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
    }}));
  } catch {
    return new Response('Evo download unavailable. Please retry online.', {status: 502, headers: {'Cache-Control': 'no-store'}});
  }
}
