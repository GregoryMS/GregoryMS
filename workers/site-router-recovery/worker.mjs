import router from '../site-router/worker.mjs';

// Serve app pages independently while the original Worker reports
// "This script has been killed." Its secrets remain on that Worker.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.endsWith('.workers.dev')) {
      return new Response('Gregle app router ready', {headers: {'Cache-Control': 'no-store'}});
    }
    if (url.hostname === 'maps.gregle.uk' && url.pathname.startsWith('/api/maps/')) {
      try {
        return await env.MAPS_API.fetch(request);
      } catch {
        const config = ['/api/maps/google-config', '/api/maps/tomtom-config'].includes(url.pathname);
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(config
          ? {enabled: false, reason: 'temporarily_unavailable'}
          : {error: 'Map service temporarily unavailable'}), {
          status: config ? 200 : 503,
          headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
        });
      }
    }
    return router.fetch(request, {});
  },
};
