// One fixed, fingerprinted download; firmware is never committed to the site.
export const TI89_ROM_URL='https://cloud.gregle.uk/public.php/dav/files/xN2iNF4ZP4Eo45b/?accept=zip';
const SIZE=4194304, SHA256='2cc77d4dacfa9f32a08b4e72b236eeeb3ef884dfccd9d3e5fd8388261f2ca3a1';
export async function calculatorRom(request,fetcher=(url,options) => globalThis.fetch(url,options)) {
  const url=new URL(request.url);
  const headers={'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};
  const error=(message,status) => new Response(message,{status,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
  if (!['https://calc.gregle.uk','https://gregle-calculator.square-rain-5ded.workers.dev'].includes(url.origin) || url.pathname!=='/api/calculator/ti89-rom') return error('Not found',404);
  if (url.search) return error('Unsupported parameters',400);
  if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{...headers,Allow:'GET, HEAD'}});
  if (request.method==='HEAD') return new Response(null,{headers:{...headers,'Content-Length':String(SIZE)}});
  let reader;
  try {
    const response=await fetcher(TI89_ROM_URL,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{Accept:'application/octet-stream'}});
    if (response.status!==200 || !response.body || (response.headers.has('Content-Length') && Number(response.headers.get('Content-Length'))!==SIZE)) {
      await response.body?.cancel(); return error('Calculator download unavailable. Choose a local ROM file or retry.',502);
    }
    reader=response.body.getReader();
    const bytes=new Uint8Array(SIZE); let offset=0;
    while (true) {
      const {done,value}=await reader.read(); if (done) break;
      if (offset+value.length>SIZE) throw Error('Unexpected ROM size');
      bytes.set(value,offset); offset+=value.length;
    }
    if (offset!==SIZE) throw Error('Incomplete ROM');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte => byte.toString(16).padStart(2,'0')).join('');
    if (hash!==SHA256) throw Error('Unexpected ROM');
    return new Response(bytes,{headers:{...headers,'Content-Length':String(SIZE)}});
  } catch {return error('Calculator download unavailable. Choose a local ROM file or retry.',502);}
  finally {if (reader) {try {await reader.cancel();} catch {}}}
}
