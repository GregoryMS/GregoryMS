import pages from '../../assets/site-routes.json' with {type: 'json'};

const pageForHost = new Map(Object.entries(pages).map(([page, host]) => [host, page]));
const pageForPath = new Map(Object.keys(pages).flatMap(page => [[`/${page}`, page], [`/${page.slice(0, -5)}`, page]]));
pageForPath.set('/environment-canada.html', 'weather.html');

function redirect(host, search) {
  return new Response(null, {status: 308, headers: {
    Location: `https://${host}/${search}`,
    'Cache-Control': 'public, max-age=300',
  }});
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const page = pageForHost.get(url.hostname);
    // A wildcard route also sees existing Cloud, Docs and www hosts.
    // Let Cloudflare contact their original DNS origins unchanged.
    if (!page || page === 'index.html') return fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
    }
    if (url.protocol !== 'https:') {
      url.protocol = 'https:';
      return new Response(null, {status: 308, headers: {Location: url.href}});
    }
    if (url.pathname !== '/') {
      const destination = pageForPath.get(url.pathname);
      if (destination) return redirect(pages[destination], url.search);
    }

    // The apex stays the GitHub Pages origin; no copied site or second build.
    const upstream = new URL('https://gregle.uk/');
    upstream.pathname = url.pathname === '/' ? `/${page}` : url.pathname;
    upstream.search = url.search;
    const headers = new Headers();
    for (const name of ['Accept', 'Accept-Language', 'If-Modified-Since', 'If-None-Match', 'If-Range', 'Range']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    let response;
    try {
      response = await fetch(upstream, {method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(20000)});
    } catch {
      return new Response('Gregle is temporarily unavailable. Please try again.', {
        status: 502, headers: {'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8'},
      });
    }
    const resultHeaders = new Headers(response.headers);
    resultHeaders.delete('Set-Cookie');
    if (response.headers.has('Location')) {
      const target = new URL(response.headers.get('Location'), upstream);
      if (target.origin === upstream.origin) {
        const destination = pageForPath.get(target.pathname);
        target.hostname = destination ? pages[destination] : url.hostname;
        if (destination) target.pathname = '/';
        resultHeaders.set('Location', target.href);
      }
    }
    const manifestPath = `/${page.slice(0, -5)}.webmanifest`;
    if (request.method === 'GET' && response.status === 200 && url.pathname === manifestPath) {
      // Only our small, version-controlled app manifest is parsed. Assets and
      // generated data otherwise stream directly from GitHub Pages.
      let manifest;
      try {
        const reader = response.body.getReader(), chunks = [];
        let size = 0;
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16384) { await reader.cancel(); throw Error('Manifest too large'); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
        manifest = JSON.parse(new TextDecoder().decode(bytes));
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Error('Invalid manifest');
      } catch {
        return new Response('App manifest temporarily unavailable', {status: 502, headers: {'Cache-Control': 'no-store'}});
      }
      manifest.id = '/';
      manifest.start_url = '/';
      manifest.scope = '/';
      resultHeaders.set('Content-Type', 'application/manifest+json; charset=utf-8');
      for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified']) resultHeaders.delete(name);
      return new Response(JSON.stringify(manifest), {headers: resultHeaders});
    }
    if (url.pathname === '/' && response.status === 200) {
      resultHeaders.set('Link', `<https://${url.hostname}/>; rel="canonical"`);
    }
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers: resultHeaders});
  },
};
