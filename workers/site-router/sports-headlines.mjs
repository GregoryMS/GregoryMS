const FEED = 'https://feeds.bbci.co.uk/sport/rss.xml';
const MAX_BYTES = 500000;

// A fixed BBC feed, shared by visitors, independent of scheduled Pages builds.
export async function sportsHeadlines(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
  }
  let stage = 'fetch';
  try {
    const response = await fetch(FEED, {
      headers: {Accept: 'application/rss+xml, application/xml, text/xml'},
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      cf: {cacheEverything: true, cacheTtlByStatus: {'200-299': 300, '300-599': 0}},
    });
    stage = 'upstream_' + response.status;
    if (!response.ok || !/xml/i.test(response.headers.get('Content-Type') || '')) {
      await response.body?.cancel();
      throw Error('Feed unavailable');
    }
    stage = 'read';
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw Error('Feed too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(request.method === 'HEAD' ? null : bytes, {headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    }});
  } catch (error) {
    console.warn(JSON.stringify({event: 'sports_headlines_unavailable', stage, error: String(error?.message || 'Unknown error').slice(0, 200)}));
    return new Response(request.method === 'HEAD' ? null : 'BBC Sport headlines temporarily unavailable', {
      status: 503, headers: {'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Gregle-Feed-Status': stage},
    });
  }
}
