const origins = new Set(['https://gregle.uk', 'https://www.gregle.uk']);
const day = 86400000, maxAge = 7 * day, limit = 750;
const quiet = promise => promise.catch(() => {});
const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const round = n => Number(n.toFixed(6));
const fields = (value, keys) => Object.fromEntries(keys.filter(key => ['string', 'number', 'boolean'].includes(typeof value?.[key])).map(key => [key, typeof value[key] === 'string' ? text(value[key]) : value[key]]));
export function area(raw) {
  if (!/^-?\d+(\.\d+)?,(-?\d+(\.\d+)?,){2}-?\d+(\.\d+)?$/.test(raw || '')) return null;
  const box = raw.split(',').map(Number), [w,s,e,n] = box;
  if (!box.every(Number.isFinite) || w < -180 || w >= 180 || e <= w || e-w > 2.35 || s < -90 || n > 90 || s >= n || n-s > 1.15) return null;
  return [round(Math.floor((w+1e-8)*20)/20), round(Math.max(-90,Math.floor((s+1e-8)*20)/20)), round(Math.ceil((e-1e-8)*20)/20), round(Math.min(90,Math.ceil((n-1e-8)*20)/20))];
}
async function readJSON(response, maxBytes = 4 * 1024 * 1024) {
  if (!response.body) throw new Error('empty_response');
  const reader=response.body.getReader(), chunks=[]; let size=0;
  try { while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>maxBytes){await reader.cancel();throw new Error('oversized_response');} chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function normalize(data, box) {
  if (!Array.isArray(data) || data.length > limit+1) throw new Error('invalid_response');
  const locations=[],seen=new Set(),[w,s,e,n]=box;
  for(const item of data){
    const address=item?.AddressInfo, provider=item?.DataProvider, lat=address?.Latitude, lng=address?.Longitude;
    if(!Number.isSafeInteger(item?.ID)||item.ID<1||seen.has(item.ID)||typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<s||lat>n||lng< -180||lng>180||((lng-w)%360+360)%360>e-w)continue;
    // Do not redistribute records whose open licence and attribution cannot be retained.
    if(provider?.IsOpenDataLicensed!==true||!text(provider.Title)||!text(provider.License)||provider.License.length>20000)continue;
    const record=fields(item,['ID','NumberOfPoints','UsageCost','GeneralComments','DateLastVerified','DateLastStatusUpdate']);
    record.AddressInfo={...fields(address,['Title','AddressLine1','AddressLine2','Town','StateOrProvince','Postcode','Latitude','Longitude','ContactTelephone1','ContactTelephone2','ContactEmail','RelatedURL','AccessComments']),Country:fields(address.Country,['Title','ISOCode'])};
    record.DataProvider=fields(provider,['ID','Title','WebsiteURL','License','IsOpenDataLicensed']);
    record.DataProvider.License=provider.License.trim();
    record.OperatorInfo=fields(item.OperatorInfo,['ID','Title','WebsiteURL']);
    record.UsageType=fields(item.UsageType,['ID','Title','IsMembershipRequired','IsAccessKeyRequired','IsPayAtLocation']);
    record.StatusType=fields(item.StatusType,['ID','Title','IsOperational']);
    record.Connections=(Array.isArray(item.Connections)?item.Connections:[]).slice(0,50).map(c=>({...fields(c,['ID','Quantity','PowerKW']),ConnectionType:fields(c.ConnectionType,['ID','Title']),CurrentType:fields(c.CurrentType,['ID','Title']),Level:fields(c.Level,['ID','Title','IsFastChargeCapable']),StatusType:fields(c.StatusType,['ID','Title','IsOperational'])}));
    locations.push(record);seen.add(item.ID);
  }
  return {locations:locations.slice(0,limit),truncated:data.length>limit};
}
export default {
  async fetch(request,env,ctx){
    const origin=request.headers.get('Origin')||'';
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Access-Control-Expose-Headers':'Retry-After'};
    if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
    const reply=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
    if(!origins.has(origin))return reply({error:'Origin not allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Max-Age':'86400'}});
    if(request.method!=='GET')return reply({error:'GET required'},405,{Allow:'GET, OPTIONS'});
    const url=new URL(request.url),p=url.searchParams,box=area(p.get('bbox'));
    if(url.pathname!=='/charging')return reply({error:'Not found'},404);
    if(!box||![null,'all','tesla'].includes(p.get('scope'))||[...p.keys()].some(k=>!['bbox','scope'].includes(k))||[...p.keys()].length!==new Set(p.keys()).size)return reply({error:'Invalid charging area'},400);
    if(!env.OCM_API_KEY)return reply({error:'Charging source not configured'},503,{'Retry-After':'300'});
    const cache=caches.default,prefix=`${url.origin}/cache/ocm-v1/`,key=new Request(prefix+box.join(',')),cooldown=new Request(prefix+'cooldown'),lease=new Request(prefix+'refresh/'+box.join(','));
    async function update(){
      if(await cache.match(cooldown))throw Object.assign(new Error('provider_cooldown'),{retryAfter:60});
      if(env.OCM_RATE_LIMIT&&!((await env.OCM_RATE_LIMIT.limit({key:request.headers.get('CF-Connecting-IP')||'anonymous'})).success))throw Object.assign(new Error('rate_limited'),{retryAfter:60});
      const [w,s,e,n]=box,boxes=e>180?[[w,180],[-180,e-360]]:[[w,e]],locations=[];let truncated=false;
      for(const [west,east] of boxes){
        const source=new URL('https://api.openchargemap.io/v3/poi/');
        source.search=new URLSearchParams({output:'json',boundingbox:`(${n},${west}),(${s},${east})`,maxresults:String(limit+1),opendata:'true',compact:'false',verbose:'false',includecomments:'false'});
        const response=await fetch(source.href,{headers:{Accept:'application/json','X-API-Key':env.OCM_API_KEY,'User-Agent':'GregleMaps/1.0 (+https://gregle.uk/maps.html)'},redirect:'manual',signal:AbortSignal.timeout(20000)});
        if(!response.ok){
          const value=response.headers.get('Retry-After'),seconds=value&&/^\d+$/.test(value)?Number(value):Math.ceil((Date.parse(value||'')-Date.now())/1000);
          const retryAfter=Math.max(60,Math.min(86400,seconds||60));await response.body?.cancel();
          await quiet(cache.put(cooldown,new Response('paused',{headers:{'Cache-Control':`public, max-age=${retryAfter}`,'Retry-After':String(retryAfter)}})));
          throw Object.assign(new Error(`upstream_${response.status}`),{retryAfter});
        }
        const result=normalize(await readJSON(response),box);locations.push(...result.locations);truncated ||= result.truncated;
      }
      const unique=[...new Map(locations.map(item=>[item.ID,item])).values()];
      const entry={source:'openchargemap',locations:unique.slice(0,limit),truncated:truncated||unique.length>limit,fetchedAt:Date.now(),area:box,scope:'all'};
      await quiet(cache.put(key,new Response(JSON.stringify(entry),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=604800'}})));
      return entry;
    }
    try{
      let entry,stored=await cache.match(key);
      if(stored){const data=await readJSON(stored);if(data.source==='openchargemap'&&Array.isArray(data.locations)&&data.locations.length<=limit&&Number.isFinite(data.fetchedAt)&&data.fetchedAt<=Date.now()&&Date.now()-data.fetchedAt<maxAge)entry=data;}
      const stale=!!entry&&Date.now()-entry.fetchedAt>=day;
      if(stale&&!await cache.match(cooldown)&&!await cache.match(lease)){
        await quiet(cache.put(lease,new Response('refreshing',{headers:{'Cache-Control':'public, max-age=45'}})));
        ctx.waitUntil((async()=>{try{await update();}catch{console.warn(JSON.stringify({event:'ocm_refresh_delayed'}));}finally{await quiet(cache.delete(lease));}})());
      }
      if(!entry){const paused=await cache.match(cooldown);if(paused)return reply({error:'Charging source temporarily unavailable'},503,{'Retry-After':paused.headers.get('Retry-After')||'60'});entry=await update();}
      return reply({...entry,stale});
    }catch(error){console.warn(JSON.stringify({event:'ocm_source_unavailable'}));return reply({error:'Charging source temporarily unavailable'},503,{'Retry-After':String(error.retryAfter||60)});}
  }
};
