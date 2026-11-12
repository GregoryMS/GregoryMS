import router from '../site-router/worker.mjs';

// Serve app pages and Maps APIs with this Worker's own provider secrets.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.endsWith('.workers.dev')) {
      return new Response('Gregle app router ready', {headers: {'Cache-Control': 'no-store'}});
    }
    if (url.hostname === 'maps.gregle.uk' && url.pathname.startsWith('/api/maps/') && url.pathname !== '/api/maps/search') {
      const localKey = url.pathname === '/api/maps/google-config'
        ? env.GOOGLE_MAPS_BROWSER_KEY : env.TOMTOM_API_KEY;
      if (typeof localKey === 'string' && localKey.trim()) {
        return router.fetch(request, env);
      }
      const config = ['/api/maps/google-config', '/api/maps/tomtom-config'].includes(url.pathname);
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(config
        ? {enabled: false, reason: 'temporarily_unavailable'}
        : {error: 'Map service temporarily unavailable'}), {
        status: config ? 200 : 503,
        headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
      });
    }
    return router.fetch(request, env);
  },
};
