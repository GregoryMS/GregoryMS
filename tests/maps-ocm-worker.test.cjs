const {test}=require('node:test'),assert=require('node:assert/strict');
const now=Date.now(),base='https://gregle-ev.square-rain-5ded.workers.dev';
const poi=(extra={})=>({ID:100,AddressInfo:{Title:'Test charger',Latitude:48.43,Longitude:-123.36},DataProvider:{ID:1,Title:'Open Charge Map Contributors',WebsiteURL:'https://openchargemap.org',IsOpenDataLicensed:true,License:'Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0)'},Connections:[{Quantity:2,PowerKW:7.2,ConnectionType:{Title:'Type 1 (J1772)'}}],...extra});
async function setup(){
 const worker=(await import('../workers/ev/worker.mjs')).default,store=new Map(),calls=[],pending=[];let impl=async()=>new Response(JSON.stringify([poi()])),allowed=true;
 const saved={fetch:global.fetch,caches:global.caches};global.caches={default:{match:async k=>store.get(k.url)?.clone(),put:async(k,v)=>{store.set(k.url,v.clone());},delete:async k=>store.delete(k.url)}};
 global.fetch=async(url,options)=>{calls.push({url,...options});return impl(url,options);};
 const env={OCM_API_KEY:'unit-test-secret',OCM_RATE_LIMIT:{limit:async()=>({success:allowed})}};
 return {calls,store,env,setFetch:fn=>impl=fn,limit:()=>allowed=false,request:(path='/charging?bbox=-123.4,48.4,-123.3,48.5',origin='https://gregle.uk',method='GET')=>worker.fetch(new Request(base+path,{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.1'}}),env,{waitUntil:p=>pending.push(p)}),close:async()=>{await Promise.all(pending);Object.assign(global,saved);}};
}
test('OCM relay uses the secret header, identifies Gregle, requires open data and preserves full attribution',async()=>{
 const h=await setup();try{
  const r=await h.request();assert.equal(r.status,200);const d=await r.json(),call=h.calls[0],url=new URL(call.url);
  assert.equal(url.origin+url.pathname,'https://api.openchargemap.io/v3/poi/');assert.equal(url.searchParams.get('opendata'),'true');assert.equal(url.searchParams.get('compact'),'false');assert.equal(url.searchParams.get('includecomments'),'false');assert.equal(url.searchParams.get('maxresults'),'751');assert.equal(url.searchParams.get('key'),null);
  assert.equal(call.headers['X-API-Key'],'unit-test-secret');assert.match(call.headers['User-Agent'],/GregleMaps.*gregle\.uk/);assert.equal(call.redirect,'manual');
  assert.equal(d.source,'openchargemap');assert.deepEqual(d.locations[0].DataProvider,poi().DataProvider);assert(!JSON.stringify(d).includes('unit-test-secret'));
  await h.request();await h.request('/charging?bbox=-123.4,48.4,-123.3,48.5&scope=tesla');assert.equal(h.calls.length,1);
 }finally{await h.close();}
});
test('unlicensed, unattributed, duplicate and out-of-area records are not redistributed; comments and media are omitted',async()=>{
 const h=await setup();try{
  const longLicense='Full licence text. '.repeat(200);
  h.setFetch(async()=>new Response(JSON.stringify([poi({DataProvider:{...poi().DataProvider,License:longLicense},UserComments:[{Comment:'omit'}],MediaItems:[{ItemURL:'omit'}]}),poi(),poi({ID:101,DataProvider:{...poi().DataProvider,IsOpenDataLicensed:false}}),poi({ID:102,DataProvider:{Title:'Missing licence',IsOpenDataLicensed:true}}),poi({ID:103,AddressInfo:{Latitude:0,Longitude:0}})])));
  const d=await(await h.request()).json();assert.equal(d.locations.length,1);assert.equal(d.locations[0].DataProvider.License,longLicense.trim());assert(!JSON.stringify(d).includes('UserComments'));assert(!JSON.stringify(d).includes('MediaItems'));
 }finally{await h.close();}
});
test('invalid origins, methods, broad bounds and arbitrary query parameters never contact OCM',async()=>{
 const h=await setup();try{
  assert.equal((await h.request(undefined,'https://evil.example')).status,403);assert.equal((await h.request(undefined,undefined,'POST')).status,405);
  for(const path of ['/charging?bbox=-180,-80,180,80','/charging?bbox=NaN,0,1,1','/charging?bbox=-123.4,48.4,-123.3,48.5&key=other','/charging?bbox=0,0,1,1&url=https://evil.example','/charging?bbox=0,0,1,1&bbox=0,0,1,1'])assert.equal((await h.request(path)).status,400);
  assert.equal(h.calls.length,0);delete h.env.OCM_API_KEY;assert.equal((await h.request()).status,503);assert.equal(h.calls.length,0);
 }finally{await h.close();}
});
test('upstream Retry-After applies across uncached areas, and errors never expose keys or source bodies',async()=>{
 const h=await setup();try{
  h.setFetch(async()=>new Response('private upstream body',{status:429,headers:{'Retry-After':'600'}}));const r=await h.request();assert.equal(r.status,503);assert.equal(r.headers.get('Retry-After'),'600');assert(!await r.text().then(x=>/private|unit-test-secret/.test(x)));
  await h.request('/charging?bbox=0,0,0.1,0.1');assert.equal(h.calls.length,1);
 }finally{await h.close();}
});
test('cached locations remain usable without new upstream queries during client throttling',async()=>{
 const h=await setup();try{await h.request();h.limit();assert.equal((await h.request()).status,200);assert.equal((await h.request('/charging?bbox=0,0,0.1,0.1')).status,503);assert.equal(h.calls.length,1);}finally{await h.close();}
});
test('dateline requests split into two bounded OCM boxes and deduplicate returned IDs',async()=>{
 const h=await setup();try{
  h.setFetch(async()=>new Response(JSON.stringify([poi({AddressInfo:{Title:'Dateline',Latitude:.05,Longitude:179.99}})])));
  const d=await(await h.request('/charging?bbox=179.9,0,180.1,0.1')).json();assert.equal(h.calls.length,2);assert.equal(d.locations.length,1);
  assert(h.calls.every(c=>!new URL(c.url).searchParams.get('boundingbox').includes('180.1')));
 }finally{await h.close();}
});
test('stale cache receipts are retained while one background refresh replaces the original data',async()=>{
 const h=await setup();try{
  const first=await(await h.request()).json();const key=[...h.store.keys()].find(x=>/cache\/ocm-v1\/-/.test(x));const old={...first,fetchedAt:now-86401000};h.store.set(key,new Response(JSON.stringify(old)));
  let release;h.setFetch(()=>new Promise(resolve=>release=resolve));const second=await(await h.request()).json();assert(second.stale);assert.equal(second.fetchedAt,old.fetchedAt);
  await h.request();assert.equal(h.calls.length,2);release(new Response(JSON.stringify([poi({ID:200})])));
 }finally{await h.close();}
});
test('OSM selection uses only Overpass, never sends the OCM key, and cannot overwrite OCM cache entries',async()=>{
 const h=await setup();try{
  const first=await(await h.request()).json();
  h.setFetch(async()=>new Response(JSON.stringify({elements:[{type:'node',id:1,lat:48.43,lon:-123.36,tags:{amenity:'charging_station',name:'OSM charger'}}],osm3s:{timestamp_osm_base:new Date().toISOString()}})));
  const second=await(await h.request('/charging?bbox=-123.4,48.4,-123.3,48.5&source=osm')).json();assert.equal(second.elements.length,1);assert(!second.locations);assert(!h.calls[1].headers['X-API-Key']);assert.equal(new URL(h.calls[1].url).hostname,'maps.mail.ru');
  const again=await(await h.request()).json();assert.equal(again.fetchedAt,first.fetchedAt);assert.equal(again.source,'openchargemap');assert.equal(h.calls.length,2);
  assert.equal((await h.request('/charging?bbox=-123.4,48.4,-123.3,48.5&source=osm&source=osm')).status,400);
 }finally{await h.close();}
});
