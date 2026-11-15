/* Fixed public ODbL release assets only; no arbitrary URL proxy or credentials. */
const region = '(?:victoria|greater-victoria|vancouver-island|greater-vancouver|british-columbia)';
const asset = new RegExp(`^/api/maps/offline/(offline-\\d{8,14})/(${region}-(?:maps|routing)\\.bin)$`);
export async function mapsOffline(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405,headers:{Allow:'GET, HEAD'}});
  const url=new URL(request.url),catalog=url.pathname==='/api/maps/offline/catalog.json',match=asset.exec(url.pathname);
  if(url.search||!catalog&&!match)return new Response('Unknown offline package',{status:404,headers:{'Cache-Control':'no-store'}});
  const tag=catalog?'offline-current':match[1],file=catalog?'catalog.json':match[2];
  try{
    const response=await fetch(`https://github.com/GregoryMS/GregoryMS/releases/download/${tag}/${file}`,{
      method:request.method,credentials:'omit',redirect:'follow',signal:AbortSignal.timeout(120000),
      headers:{'User-Agent':'Gregle-Offline-Maps','Accept':'application/octet-stream'},
      cf:{cacheEverything:true,cacheTtlByStatus:{'200-299':catalog?120:86400,'300-599':-1}}
    });
    if(!response.ok)return new Response('Offline packages are not available yet. Try again shortly.',{status:response.status===404?404:502,headers:{'Cache-Control':'no-store'}});
    const headers=new Headers(response.headers);headers.delete('Set-Cookie');headers.delete('Content-Disposition');
    headers.set('Content-Type',catalog?'application/json; charset=utf-8':'application/octet-stream');
    headers.set('Cache-Control',catalog?'public, max-age=60':'public, max-age=86400, immutable');
    headers.set('X-Content-Type-Options','nosniff');
    return new Response(response.body,{status:response.status,headers});
  }catch{return new Response('Offline downloads are temporarily unavailable.',{status:502,headers:{'Cache-Control':'no-store'}});}
}
