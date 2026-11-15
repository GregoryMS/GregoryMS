// Fixed user-supplied files only. Firmware is streamed, never stored by the site.
export const FILES={
  '/boot1':{url:'https://cloud.gregle.uk/public.php/dav/files/4MTzsFkbjYXKK5m/?accept=zip',size:524288},
  '/flash':{url:'https://cloud.gregle.uk/public.php/dav/files/sxsdNJnFw2tmyaA/?accept=zip',size:138412032}
};
export async function firmware(request,fetcher=fetch) {
  const url=new URL(request.url), file=FILES[url.pathname];
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Length','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/octet-stream'};
  const error=(message,status)=>new Response(message,{status,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
  if (!file) return error('Not found',404);
  if (url.search) return error('Unsupported parameters',400);
  if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{...headers,Allow:'GET, HEAD'}});
  if (request.method==='HEAD') return new Response(null,{headers:{...headers,'Content-Length':String(file.size)}});
  try {
    const response=await fetcher(file.url,{redirect:'manual',signal:AbortSignal.timeout(120000),headers:{Accept:'application/octet-stream'}});
    if (response.status!==200 || !response.body || Number(response.headers.get('Content-Length'))!==file.size) {
      await response.body?.cancel();
      return error('Calculator firmware unavailable. Retry or choose local Boot1 and flash files.',502);
    }
    // Pass the stream through without buffering a 132 MiB file in Worker memory.
    // Exact lengths and SHA-256 fingerprints are enforced by the browser loader.
    return new Response(response.body,{headers:{...headers,'Content-Length':String(file.size)}});
  } catch (_) {
    console.error(JSON.stringify({event:'nspire_firmware_unavailable',file:url.pathname}));
    return error('Calculator firmware unavailable. Retry or choose local files.',502);
  }
}
export default {fetch(request) {return firmware(request);}};
