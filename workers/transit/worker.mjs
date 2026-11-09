import {DurableObject} from 'cloudflare:workers';
import {provider,resolveRoute} from './providers.mjs';
import {readVehicles,readBytes} from './gtfs.mjs';
const origins=new Set(['https://gregle.uk','https://www.gregle.uk','https://maps.gregle.uk']);
export class TransitFeed extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.pending=null;ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)');}
  save(entry){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO snapshot (id,value) VALUES (1,?)',JSON.stringify(entry));return entry;}
  async read(feed){
    const config=provider(feed);if(!config)throw Error('Unsupported feed');
    if(this.pending)return this.pending;
    const stored=this.ctx.storage.sql.exec('SELECT value FROM snapshot WHERE id = 1').toArray()[0];
    const cached=stored?JSON.parse(stored.value):null,now=Date.now();
    if(cached&&now<cached.refreshAt)return cached;
    // Persist the refresh reservation before external I/O. Restarts and callers
    // in other edge locations cannot bypass the TransLink request interval.
    this.save({status:503,refreshAt:now+config.interval,data:null});
    this.pending=(async()=>{
      try{
        if(feed==='translink'&&!this.env.TRANSLINK_API_KEY)throw Error('Missing provider key');
        const url=feed==='translink'?new URL('https://gtfsapi.translink.ca/v3/gtfsposition'):new URL('https://bct.tmix.se/gtfs-realtime/vehicleupdates.pb');
        if(feed==='translink')url.searchParams.set('apikey',this.env.TRANSLINK_API_KEY);else url.searchParams.set('operatorIds',config.operator);
        const response=await fetch(url,{headers:{Accept:'application/x-protobuf','User-Agent':'GregleMaps/1.0 (+https://maps.gregle.uk/)'},redirect:'manual',signal:AbortSignal.timeout(10000)});
        if(!response.ok){
          const raw=response.headers.get('Retry-After'),seconds=/^\d+$/.test(raw||'')?Number(raw):Math.ceil((Date.parse(raw||'')-Date.now())/1000);
          await response.body?.cancel();const error=new Error('Provider unavailable');error.wait=Math.min(3600,Math.max(60,seconds||60));throw error;
        }
        const data=readVehicles(await readBytes(response),Date.now(),config.maxAgeSeconds);
        return this.save({status:200,refreshAt:Date.now()+config.interval,data});
      }catch(error){
        // Never log the upstream URL or exception text: it could contain a key.
        console.warn(JSON.stringify({event:'transit_feed_unavailable',feed}));
        return this.save({status:503,refreshAt:Date.now()+Math.max(config.interval,(error.wait||60)*1000),data:null});
      }finally{this.pending=null;}
    })();
    return this.pending;
  }
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin')||'',headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Access-Control-Expose-Headers':'Retry-After'};
    if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
    const reply=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});
    if(!origins.has(origin))return reply({error:'Origin not allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Max-Age':'86400'}});
    if(request.method!=='GET')return reply({error:'GET required'},405,{Allow:'GET, OPTIONS'});
    const url=new URL(request.url),id=url.searchParams.get('route')||'';
    if(url.pathname!=='/vehicles')return reply({error:'Not found'},404);
    if(!id||id.length>250||[...url.searchParams.keys()].some(k=>k!=='route')||url.searchParams.getAll('route').length!==1)return reply({error:'Invalid route'},400);
    const route=resolveRoute(id);
    if(!route)return reply({supported:false,routeId:id,vehicles:[]});
    try{
      const result=await env.TRANSIT_FEEDS.getByName(route.feed).read(route.feed),now=Date.now();
      if(result.status!==200)return reply({error:'Live bus positions temporarily unavailable'},503,{'Retry-After':String(Math.max(1,Math.ceil((result.refreshAt-now)/1000)))});
      const vehicles=result.data.vehicles.filter(v=>v.routeId===route.route&&v.observed>=now-route.maxAgeSeconds*1000&&v.observed<=now+30000);
      return reply({supported:true,routeId:id,source:route.label,maxAgeSeconds:route.maxAgeSeconds,now,timestamp:result.data.timestamp,refreshAfter:Math.max(1,Math.ceil((result.refreshAt-now)/1000)),vehicles});
    }catch{return reply({error:'Live bus positions temporarily unavailable'},503,{'Retry-After':'60'});}
  }
};
