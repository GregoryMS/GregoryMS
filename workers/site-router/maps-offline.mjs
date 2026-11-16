/* Fixed public ODbL release assets; small byte ranges for mobile-safe downloads. */
const region='(?:victoria|greater-victoria|vancouver-island|greater-vancouver|british-columbia)';
const asset=new RegExp(`^/api/maps/offline/(offline-\\d{8,14})/(${region}-(?:(?:maps|routing)\\.bin|maps\\.pmtiles))$`);
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Range, Content-Length, Accept-Ranges'};
const error=(text,status,extra={})=>new Response(text,{status,headers:{...cors,'Cache-Control':'no-store',...extra}});
export async function mapsOffline(request){
  const url=new URL(request.url),catalog=['/api/maps/offline/catalog.json','/api/maps/offline/catalog-v2.json'].includes(url.pathname),match=asset.exec(url.pathname);
  if(url.search||!catalog&&!match)return error('Unknown offline package',404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range','Access-Control-Max-Age':'86400'}});
  if(!['GET','HEAD'].includes(request.method))return error('Method not allowed',405,{Allow:'GET, HEAD, OPTIONS'});
  const range=request.headers.get('Range'),parts=range&&/^bytes=(\d+)-(\d+)$/.exec(range);
  if(range&&(catalog||!parts||!Number.isSafeInteger(Number(parts[1]))||!Number.isSafeInteger(Number(parts[2]))||Number(parts[2])<Number(parts[1])||Number(parts[2])-Number(parts[1])>=8*1024*1024))return error('Invalid download range',416);
  const tag=catalog?'offline-current':match[1],file=catalog?url.pathname.split('/').at(-1):match[2];
  // Stop old cached clients from allocating the entire 731 MB BC map.
  if(file==='british-columbia-maps.bin'&&!range&&request.method==='GET')return error('Refresh Maps to use the updated resumable BC download.',409);
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);let response;
    try{response=await fetch(`https://github.com/GregoryMS/GregoryMS/releases/download/${tag}/${file}`,{
      method:request.method,credentials:'omit',redirect:'follow',signal:controller.signal,
      headers:{'User-Agent':'Gregle-Offline-Maps','Accept':'application/octet-stream',...(range?{Range:range}:{})},
      ...(range?{cache:'no-store'}:{cf:{cacheEverything:true,cacheTtlByStatus:{'200-299':catalog?120:86400,'300-599':-1}}})
    });}finally{clearTimeout(timer);}
    if(!response.ok)return error('Offline packages are temporarily unavailable.',response.status===404?404:response.status===416?416:502);
    const headers=new Headers(response.headers);headers.delete('Set-Cookie');headers.delete('Content-Disposition');
    for(const [key,value]of Object.entries(cors))headers.set(key,value);
    headers.set('Content-Type',catalog?'application/json; charset=utf-8':'application/octet-stream');
    headers.set('Cache-Control',range?'no-store':catalog?'public, max-age=60':'public, max-age=86400, immutable');
    headers.set('X-Content-Type-Options','nosniff');
    return new Response(response.body,{status:response.status,headers});
  }catch{return error('Offline downloads are temporarily unavailable.',502);}
}
