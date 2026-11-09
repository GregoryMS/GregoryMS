const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const fixture=require('./fixtures/transit-vehicle-feed.json'),NOW=fixture.now;
const vint=n=>{const a=[];do{a.push((n%128)|(n>=128?128:0));n=Math.floor(n/128);}while(n);return a;};
const field=(id,value,wire=typeof value==='number'?0:2)=>[...vint(id*8+wire),...(wire===0?vint(value):wire===2?[...vint(value.length),...value]:value)];
const text=(id,s)=>field(id,Buffer.from(s));
const float=(id,n)=>{const b=Buffer.alloc(4);b.writeFloatLE(n);return field(id,b,5);};
const feed=(now=NOW,records=[{}],header=[])=>new Uint8Array([...field(1,[...text(1,'2.0'),...field(3,now/1000),...header]),...records.flatMap((r,i)=>field(2,[...text(1,r.id||'bus'+i),...(r.deleted?field(2,1):[]),...field(4,[...field(1,[...text(1,'trip'+i),...text(5,r.route||'4-VIC'),...(r.cancelled?field(4,3):[])]),...field(2,[...float(1,r.lat??48.43),...float(2,r.lng??-123.36)]),...(r.missingTime?[]:field(5,(r.observed??now)/1000))])]))]);
async function setup(){
 const {provider,resolveRoute}=await import('../workers/transit/providers.mjs'),{readVehicles,readBytes}=await import('../workers/transit/gtfs.mjs');
 let now=NOW,impl=async()=>new Response(feed(now)),calls=[],instances=new Map(),stores=new Map();
 class Clock extends Date{static now(){return now;}}
 class Base{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 const context={DurableObject:Base,provider,resolveRoute,readVehicles,readBytes,Date:Clock,console:{warn(){}},URL,Response,AbortSignal,Set,JSON,Math,fetch:async(url,options)=>{calls.push({url:String(url),options});return impl(url,options);}};
 const source=fs.readFileSync(require.resolve('../workers/transit/worker.mjs'),'utf8').replace(/^import .*\n/gm,'').replace('export class TransitFeed','class TransitFeed').replace('export default','const worker=');
 vm.runInNewContext(source+'\nthis.exports={TransitFeed,worker};',context);
 const env={TRANSLINK_API_KEY:'test-secret',TRANSIT_FEEDS:{getByName(name){
  if(!stores.has(name))stores.set(name,{value:null});const store=stores.get(name);
  if(!instances.has(name)){const sql={exec(statement,value){if(statement.startsWith('INSERT'))store.value=value;return {toArray:()=>statement.startsWith('SELECT')&&store.value?[{value:store.value}]:[]};}};instances.set(name,new context.exports.TransitFeed({storage:{sql}},env));}
  return instances.get(name);
 }}};
 const ask=(route='ca-bc-Victoria-Transit_4-VIC',options={})=>context.exports.worker.fetch(new Request('https://transit.test'+(options.path||'/vehicles')+'?'+new URLSearchParams({route})+(options.extra||''),{method:options.method||'GET',headers:{Origin:options.origin||'https://maps.gregle.uk'}}),env);
 return {ask,calls,env,advance:ms=>now+=ms,setFetch:f=>impl=f,restart:()=>instances.clear()};
}
test('recorded Victoria GTFS vehicle positions decode with original GPS timestamps',async()=>{
 const {readVehicles}=await import('../workers/transit/gtfs.mjs');const data=readVehicles(new Uint8Array(Buffer.from(fixture.base64,'base64')),NOW,120);
 assert.equal(data.vehicles.length,8);assert.equal(data.timestamp,NOW);assert.equal(data.vehicles[0].routeId,'3-VIC');assert.equal(data.vehicles[0].observed,NOW-5000);assert.equal(data.vehicles[0].direction,0);
});
test('decoder rejects stale or malformed feeds and never refreshes missing or old GPS fixes',async()=>{
 const {readVehicles,readBytes}=await import('../workers/transit/gtfs.mjs');
 for(const bytes of [feed(NOW-121000),feed(NOW,[{}],field(2,1)),new Uint8Array([10,9,1]),new Uint8Array(2*1024*1024+1)])assert.throws(()=>readVehicles(bytes,NOW,120));
 const data=readVehicles(feed(NOW,[{}, {missingTime:true},{observed:NOW-121000},{observed:NOW+31000},{lat:0},{lng:0},{cancelled:true},{deleted:true},{id:'bus0',observed:NOW-1000}]),NOW,120);assert.equal(data.vehicles.length,1);assert.equal(data.vehicles[0].observed,NOW);
 await assert.rejects(readBytes(new Response(new Uint8Array(2*1024*1024+1))));
});
test('relay validates origin, path, method and route before contacting any feed',async()=>{
 const h=await setup();assert.equal((await h.ask(undefined,{origin:'https://elsewhere.test'})).status,403);assert.equal((await h.ask(undefined,{method:'POST'})).status,405);assert.equal((await h.ask(undefined,{path:'/other'})).status,404);assert.equal((await h.ask(undefined,{extra:'&url=https://evil.test'})).status,400);assert.equal((await h.ask(undefined,{extra:'&route=duplicate'})).status,400);
 const unsupported=await(await h.ask('gb-london_4')).json();assert.equal(unsupported.supported,false);assert.equal(h.calls.length,0);
});
test('route matching retains city namespace and shares one BC feed snapshot across routes and restarts',async()=>{
 const h=await setup();h.setFetch(async()=>new Response(feed(NOW,[{}, {route:'3-VIC'},{route:'4-COW'}])));
 const response=await h.ask();assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://maps.gregle.uk');const d=await response.json();assert.equal(d.vehicles.length,1);assert.equal(d.source,'BC Transit');assert.equal(d.vehicles[0].routeId,'4-VIC');assert.equal(new URL(h.calls[0].url).searchParams.get('operatorIds'),'48');
 h.restart();assert.equal((await(await h.ask('ca-bc-Victoria-Transit_3-VIC')).json()).vehicles.length,1);assert.equal(h.calls.length,1);
 await h.ask('ca-bc-Cowichan-Valley-Transit_4-COW');assert.equal(new URL(h.calls[1].url).searchParams.get('operatorIds'),'10');
});
test('TransLink keeps the key upstream, shares refreshes globally and preserves the interval after restart',async()=>{
 const h=await setup();h.setFetch(async()=>new Response(feed(NOW,[{route:'12345'}])));const route='ca-bc-TransLink_12345';
 const result=await(await h.ask(route)).json();assert.equal(result.source,'TransLink');assert.equal(result.maxAgeSeconds,300);assert.equal(result.vehicles.length,1);assert.equal(new URL(h.calls[0].url).searchParams.get('apikey'),'test-secret');assert(!JSON.stringify(result).includes('test-secret'));
 h.advance(60000);h.restart();await h.ask(route);assert.equal(h.calls.length,1);h.advance(61000);await h.ask(route);assert.equal(h.calls.length,2);
});
test('concurrent requests coalesce and Retry-After persists across restart and route changes',async()=>{
 const h=await setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));const a=h.ask(),b=h.ask('ca-bc-Victoria-Transit_3-VIC');await Promise.resolve();assert.equal(h.calls.length,1);release(new Response('slow',{status:429,headers:{'Retry-After':'180'}}));assert.equal((await a).status,503);assert.equal((await b).status,503);h.restart();const result=await h.ask();assert.equal(result.headers.get('Retry-After'),'180');assert.equal(h.calls.length,1);
});
test('missing TransLink configuration fails closed without an upstream request',async()=>{
 const h=await setup();delete h.env.TRANSLINK_API_KEY;assert.equal((await h.ask('ca-bc-TransLink_12345')).status,503);assert.equal(h.calls.length,0);
});
