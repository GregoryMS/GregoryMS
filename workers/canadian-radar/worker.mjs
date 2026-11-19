const STATIONS=new Set(['CASAG','CASHP']);
const UPSTREAM='https://dd.weather.gc.ca';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','X-Content-Type-Options':'nosniff'};
export function scanTime(code) {
  if(!/^\d{8}T\d{4}Z$/.test(code))return NaN;
  const iso=`${code.slice(0,4)}-${code.slice(4,6)}-${code.slice(6,8)}T${code.slice(9,11)}:${code.slice(11,13)}:00Z`;
  const time=Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,16)===iso.slice(0,16)?time:NaN;
}
export function scansFrom(html,station,now=Date.now()) {
  if(!STATIONS.has(station))throw Error('Unsupported station');
  const regex=new RegExp(`href="(\\d{8}T\\d{4}Z)_MSC_Radar-DPQPE_${station}_Rain\\.gif"`,'g');
  const found=new Map();
  for(const match of html.matchAll(regex)) {
    const time=scanTime(match[1]);
    if(time<=now+60000 && time>=now-3*3600000)found.set(time,{time:time/1000,code:match[1]});
  }
  const frames=[...found.values()].sort((a,b)=>a.time-b.time);
  if(!frames.length)return [];
  return frames.filter(f=>f.time>=frames.at(-1).time-7200).slice(-25);
}
export function upstreamPath(station,code,now=Date.now()) {
  if(!STATIONS.has(station))throw Error('Unsupported station');
  const day=new Date(now).toISOString().slice(0,10).replaceAll('-','');
  const prefix=code.slice(0,8)===day?'today':`${code.slice(0,8)}/WXO-DD`;
  return `${UPSTREAM}/${prefix}/radar/DPQPE/GIF/${station}/${code}_MSC_Radar-DPQPE_${station}_Rain.gif`;
}
async function boundedFetch(url,fetcher,limit) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetcher(url,{signal:controller.signal,redirect:'manual'});
    if(!response.ok)throw Error('Radar upstream unavailable');
    if(Number(response.headers.get('Content-Length'))>limit)throw Error('Radar response too large');
    const reader=response.body.getReader(),chunks=[];let length=0;
    for(;;) {
      const {done,value}=await reader.read();if(done)break;
      length+=value.length;if(length>limit){await reader.cancel();throw Error('Radar response too large');}
      chunks.push(value);
    }
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
  } finally {clearTimeout(timer);}
}
function json(body,status=200,ttl=0) {
  return new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':ttl?`public, max-age=${ttl}`:'no-store'}});
}
export async function handle(request,{fetcher=fetch,cache=null,ctx=null,now=Date.now()}={}) {
  const url=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  if(url.search)return json({error:'Unexpected query'},400);
  if(url.pathname==='/health')return json({status:'ok',stations:[...STATIONS]},200,60);
  const match=/^\/stations\/(CASAG|CASHP)\/(frames|images\/(\d{8}T\d{4}Z)\.gif)$/.exec(url.pathname);
  if(!match)return json({error:'Not found'},404);
  const station=match[1],code=match[3];
  if(code && (!Number.isFinite(scanTime(code)) || scanTime(code)<now-3*3600000 || scanTime(code)>now+60000))return json({error:'Image outside recent history'},400);
  const key=new Request(url.origin+url.pathname);
  const hit=await cache?.match(key);if(hit)return hit;
  try {
    let result;
    if(code) {
      const bytes=await boundedFetch(upstreamPath(station,code,now),fetcher,512000);
      if(!/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0,6))))throw Error('Invalid radar image');
      result=new Response(bytes,{headers:{...CORS,'Content-Type':'image/gif','Cache-Control':'public, max-age=86400, immutable'}});
    } else {
      const today=`${UPSTREAM}/today/radar/DPQPE/GIF/${station}/`;
      let html=new TextDecoder().decode(await boundedFetch(today,fetcher,1000000));
      // Across UTC midnight, include the preceding day's actual published scans.
      if(now%86400000<2*3600000) {
        const day=new Date(now-86400000).toISOString().slice(0,10).replaceAll('-','');
        try {html+='\n'+new TextDecoder().decode(await boundedFetch(`${UPSTREAM}/${day}/WXO-DD/radar/DPQPE/GIF/${station}/`,fetcher,1000000));}catch(_){}
      }
      const frames=scansFrom(html,station,now);
      if(!frames.length)throw Error('No recent radar scans');
      result=json({station,product:'DPQPE rainfall rate',units:'mm/h',frames},200,60);
    }
    if(cache){const write=cache.put(key,result.clone()).catch(()=>{});if(ctx)ctx.waitUntil(write);else await write;}
    return result;
  } catch(error) {
    console.error(JSON.stringify({message:'Canadian radar upstream failed',station,error:error.message}));
    return json({error:'Canadian radar unavailable; try again shortly'},502);
  }
}
export default {fetch(request,env,ctx){return handle(request,{ctx,cache:caches.default});}};
