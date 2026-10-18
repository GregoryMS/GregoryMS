const origins = new Set(['https://gregle.uk', 'https://www.gregle.uk']);
const positionTypes = new Set(['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'LongRangeAisBroadcastMessage']);
const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
const numeric = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const clean = x => typeof x === 'string' ? x.trim().slice(0, 160) : '';
async function readJSON(response, maxBytes = 3 * 1024 * 1024) {
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error('Oversized response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function vesselType(code) {
  return ({30:'Fishing',31:'Towing',32:'Towing',33:'Dredging',34:'Diving',35:'Military',36:'Sailing',37:'Pleasure craft',50:'Pilot vessel',51:'Search and rescue',52:'Tug',53:'Port tender',54:'Anti-pollution',55:'Law enforcement',58:'Medical transport'})[code] || (code >= 60 && code < 70 ? 'Passenger' : code >= 70 && code < 80 ? 'Cargo' : code >= 80 && code < 90 ? 'Tanker' : code >= 40 && code < 50 ? 'High-speed craft' : '');
}
function normalize(data, box, now) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 20000) throw new Error('Invalid vessel data');
  const records = new Map(), [west, south, east, north] = box;
  for (const f of data.features) {
    const p = f?.properties, point = f?.geometry?.coordinates;
    // `seen` also advances for static messages. Only position-carrying messages may refresh a marker's age.
    if (f?.geometry?.type !== 'Point' || !Array.isArray(point) || p?.kind !== 'vessel' || !positionTypes.has(p.msg_type)) continue;
    const [lng, lat] = point, id = String(p.mmsi || ''), stamp = typeof p.seen === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(p.seen) ? Date.parse(p.seen) : NaN;
    if (!/^[1-9]\d{8}$/.test(id) || !numeric(lat,-85.05113,85.05113) || !numeric(lng,-180,180) || !numeric(stamp,now-600000+1,now+30000) || lat<south || lat>north || ((lng-west)%360+360)%360>east-west) continue;
    const old = records.get(id); if (old && Date.parse(old.observed) >= stamp) continue;
    const provider = ({aisstream:'AISStream.io',aishub:'AISHub',kystverket:'Kystverket',barentswatch:'BarentsWatch',digitraffic:'Fintraffic Digitraffic'})[p.source] || 'community receivers';
    records.set(id,{mmsi:id,lat,lng,name:clean(p.name),type:vesselType(p.type),country:/^[A-Z]{2}$/.test(p.flag||'')?p.flag:'',destination:clean(p.destination),heading:p.heading??null,course:p.cog??null,speed:p.sog??null,source:'openwaters',sourceLabel:`Open Waters / ${provider}`,observed:p.seen});
  }
  const ships=[...records.values()].sort((a,b)=>Date.parse(b.observed)-Date.parse(a.observed));
  const credits=[...new Set(Object.values(data.attribution||{}).filter(x=>typeof x==='string').map(x=>x.trim().slice(0,600)))].slice(0,20);
  return {ships:ships.slice(0,5000),credits,limited:data.truncated===true||ships.length>5000};
}
export default {
  async fetch(request, env, ctx) {
    const origin=request.headers.get('Origin')||'';
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Access-Control-Expose-Headers':'Retry-After'};
    if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
    const reply=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
    if(!origins.has(origin))return reply({error:'Origin not allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Max-Age':'86400'}});
    if(request.method!=='GET')return reply({error:'GET required'},405,{Allow:'GET, OPTIONS'});
    const url=new URL(request.url),params=url.searchParams;
    if(url.pathname!=='/vessels')return reply({error:'Not found'},404);
    const raw=params.get('bbox')||'',box=raw.split(',').map(Number),[west,south,east,north]=box;
    const cursor=params.get('cursor')||'',snapshot=params.get('snapshot')||'';
    if(!/^-?\d+(\.\d+)?,(-?\d+(\.\d+)?,){2}-?\d+(\.\d+)?$/.test(raw)||box.length!==4||!box.every(Number.isFinite)||south< -85.05113||north>85.05113||south>=north||north-south>10||west< -189||east>189||east<=west||east-west>18||(east-west)*(north-south)>100||
      (cursor&&(!/^[1-9]\d{3,4}$/.test(cursor)||+cursor%5000||+cursor>55000||!/^[a-f0-9]{24}$/.test(snapshot)))||(!cursor&&snapshot)||[...params.keys()].some(k=>!['bbox','cursor','snapshot'].includes(k)))return reply({error:'Invalid map area or page'},400);
    const cache=caches.default,area=box.map(x=>x.toFixed(4)).join(',');
    const key=new Request(`${url.origin}/v4/openwaters/fresh/${area}`),backupKey=new Request(`${url.origin}/v4/openwaters/backup/${area}`),lease=new Request(`${url.origin}/v4/openwaters/refresh/${area}`),cooldown=new Request(`${url.origin}/v4/openwaters/cooldown`);
    const quiet=p=>p.catch(()=>{});
    async function stored(cacheKey){
      const r=await cache.match(cacheKey);if(!r)return null;const entry=await readJSON(r,4*1024*1024);
      return typeof entry.savedAt==='number'&&entry.savedAt<=Date.now()+30000&&Date.now()-entry.savedAt<=300000&&Array.isArray(entry.ships)&&entry.ships.length<=5000&&/^[a-f0-9]{24}$/.test(entry.snapshotId||'')?entry:null;
    }
    async function update(){
      const boxes=west< -180?[[west+360,south,180,north],[-180,south,east,north]]:east>180?[[west,south,180,north],[-180,south,east-360,north]]:[box];
      const upstreamURL=new URL('https://ais.openwaters.io/v1/vessels');
      upstreamURL.searchParams.set('kind','vessel');upstreamURL.searchParams.set('max_age','600');upstreamURL.searchParams.set('max_age_moving','600');
      for(const b of boxes)upstreamURL.searchParams.append('bbox',[b[1],b[0],b[3],b[2]].join(','));
      let data,lastError;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const paused=await cache.match(cooldown);if(paused){const e=new Error('provider_cooldown');e.status=429;e.retryAfter=Number(paused.headers.get('Retry-After'))||60;e.stop=true;throw e;}
          const r=await fetch(upstreamURL.href,{headers:{Accept:'application/geo+json, application/json','User-Agent':'GregleMaps/1.0 (+https://gregle.uk/maps.html)'},redirect:'manual',signal:AbortSignal.timeout(attempt?12000:8000)});
          if(!r.ok){const value=r.headers.get('Retry-After'),wait=Math.min(900,Math.max(60,value&&/^\d+$/.test(value)?Number(value):Math.ceil((Date.parse(value||'')-Date.now())/1000)||60));await r.body?.cancel();const e=new Error(`upstream_${r.status}`);e.status=r.status;e.retryAfter=wait;e.stop=r.status===429||!!value||![500,502,503,504].includes(r.status);if(r.status===429||value)await quiet(cache.put(cooldown,new Response('paused',{headers:{'Cache-Control':`public, max-age=${wait}`,'Retry-After':String(wait)}})));throw e;}
          const rawData=await readJSON(r);
          try{data=normalize(rawData,box,Date.now());}catch(e){e.stop=true;throw e;}
          break;
        }catch(e){lastError=e;if(e.stop||e instanceof SyntaxError)break;}
      }
      if(!data)throw lastError||new Error('source_unavailable');
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
      const snapshotId=[...new Uint8Array(digest)].slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('');
      const entry={...data,snapshotId,savedAt:Date.now()},body=JSON.stringify(entry);
      await Promise.all([quiet(cache.put(key,new Response(body,{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=45'}}))),quiet(cache.put(backupKey,new Response(body,{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=300'}})))]);
      return entry;
    }
    try{
      let entry=await stored(key),cached=false;
      if(!entry){
        const backup=await stored(backupKey),paused=await cache.match(cooldown);
        if(backup){entry=backup;cached=true;if(!paused&&!await cache.match(lease)){await quiet(cache.put(lease,new Response('refreshing',{headers:{'Cache-Control':'public, max-age=25'}})));ctx.waitUntil((async()=>{try{await update();}catch(e){console.warn(JSON.stringify({event:'vessel_refresh_delayed',provider:'openwaters',cause:e instanceof Error?e.message.slice(0,80):'UnknownError'}));}finally{await quiet(cache.delete(lease));}})());}}
        else{if(paused)return reply({error:'Vessel source temporarily unavailable'},503,{'Retry-After':paused.headers.get('Retry-After')||'60'});entry=await update();}
      }
      const ships=entry.ships.filter(s=>Date.now()-Date.parse(s.observed)<600000);
      return reply({now:Date.now(),ships,credits:entry.credits,snapshotId:entry.snapshotId,pages:1,cursor:'',cached,cacheAgeSeconds:Math.max(0,Math.floor((Date.now()-entry.savedAt)/1000)),limited:entry.limited,degraded:false});
    }catch(e){console.warn(JSON.stringify({event:'vessel_source_unavailable',provider:'openwaters',cause:e instanceof Error?e.message.slice(0,80):'UnknownError'}));return reply({error:'Vessel source temporarily unavailable'},e.status===429?429:503,{'Retry-After':String(e.retryAfter||60)});}
  }
};
