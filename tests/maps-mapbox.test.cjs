const {test} = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../assets/maps-routing.js');
const core = require('../assets/maps-navigation-core.js');
const a = {lat:48.42,lng:-123.36}, b = {lat:48.43,lng:-123.35};
const data = () => ({code:'Ok', routes:[{distance:1800,duration:300,geometry:{type:'LineString',coordinates:[[-123.36,48.42],[-123.36,48.43],[-123.35,48.43]]},legs:[{
  annotation:{maxspeed:[{speed:50,unit:'km/h'},{unknown:true}],duration:[200,100]},steps:[
    {distance:1100,maneuver:{type:'depart',instruction:'Head north',location:[-123.36,48.42]},intersections:[{geometry_index:1,lanes:[{indications:['left','straight'],valid:false},{indications:['right'],valid:true,active:true,valid_indication:'right'}]}]},
    {distance:700,maneuver:{type:'turn',modifier:'right',instruction:'Turn right onto Test Street',location:[-123.36,48.43]}},
    {distance:0,maneuver:{type:'arrive',location:[-123.35,48.43]}}
  ]}]}]});

test('Mapbox guidance preserves lanes, speed units, provider text and segment travel times', () => {
  const route = routing.readMapboxRoute(data(), true);
  assert.equal(route.steps[0].text,'Head north'); assert.equal(route.provider,'mapbox'); assert(route.traffic);
  assert.equal(route.laneGuidance.length,1); assert.equal(route.laneGuidance[0].at,route.cumulative[1]);
  assert.equal(route.laneGuidance[0].lanes[1].preferred,'right'); assert.equal(route.laneGuidance[0].lanes[0].valid,false);
  assert.deepEqual(route.speedLimits,[{speed:50,unit:'km/h'},null]); assert.deepEqual(route.timings,[0,200,300]);
  assert(Math.abs(core.progress(route,{lat:48.425,lng:-123.36}).seconds-200)<1);
  const invalid = data(); invalid.routes[0].legs[0].steps[0].intersections[0].geometry_index = 999;
  invalid.routes[0].legs[0].annotation.maxspeed.pop();
  const checked = routing.readMapboxRoute(invalid); assert.equal(checked.laneGuidance.length,0); assert.equal(checked.speedLimits,undefined);
});

test('3D routes use the Worker without a token; walking stays on the pedestrian service', async () => {
  const calls=[];
  const service=routing.create({storage:{getItem:()=>null},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>data()};}});
  service.setMapbox(true); const route=await service.request(a,b); assert.equal(route.provider,'mapbox');
  assert.equal(calls[0].url,routing.mapboxEndpoint+'/route'); assert.deepEqual(JSON.parse(calls[0].options.body),{from:a,to:b,traffic:false});
  service.setEnabled(true); await service.request(a,b); assert.equal(JSON.parse(calls[1].options.body).traffic,true);
  await service.request(a,b,'walking'); assert(calls[2].url.includes('routed-foot'));
  service.setMapbox(false); await service.request(a,b); assert(calls[3].url.includes('project-osrm'));
});

test('Mapbox failures keep their error and cancelled requests never become routes', async () => {
  const service=routing.create({fetch:async()=>({ok:false})}); service.setMapbox(true);
  await assert.rejects(service.request(a,b),/3D route update unavailable/);
  const abort=new AbortController(); abort.abort();
  const cancelled=routing.create({fetch:async()=>({ok:true,json:async()=>data()})}); cancelled.setMapbox(true);
  await assert.rejects(cancelled.request(a,b,'driving',{signal:abort.signal}),{name:'AbortError'});
});

async function fixture(run,upstream=()=>Response.json(data())) {
  const worker=(await import('../workers/mapbox/worker.mjs')).default;
  const saved=global.fetch, calls=[];
  global.fetch=async(...args)=>{calls.push(args);return upstream(...args);};
  const env={MAPBOX_PUBLIC_TOKEN:'pk.unit-test-only',ROUTE_LIMITER:{limit:async()=>({success:true})}};
  const request=(path='/route',opts={})=>worker.fetch(new Request('https://relay.example'+path,{method:path==='/config'?'GET':'POST',headers:{Origin:'https://maps.gregle.uk','Content-Type':'application/json'},...(path==='/config'?{}:{body:JSON.stringify({from:a,to:b,traffic:true})}),...opts}),env);
  try { await run({request,env,calls}); } finally {global.fetch=saved;}
}

test('Worker fixes upstream URLs, keeps token out of directions, and serves no-store CORS config',async()=>{
  await fixture(async h=>{
    const response=await h.request();assert.equal(response.status,200);assert(!(await response.text()).includes(h.env.MAPBOX_PUBLIC_TOKEN));
    const u=new URL(h.calls[0][0]);assert.equal(u.hostname,'api.mapbox.com');assert(u.pathname.includes('driving-traffic/-123.360000,48.420000;-123.350000,48.430000'));
    assert.equal(u.searchParams.get('access_token'),h.env.MAPBOX_PUBLIC_TOKEN);assert.equal(u.searchParams.get('annotations'),'duration,maxspeed');assert.equal(h.calls[0][1].redirect,'manual');
    const config=await h.request('/config');assert.equal(config.headers.get('Cache-Control'),'no-store');assert.equal(config.headers.get('Access-Control-Allow-Origin'),'https://maps.gregle.uk');assert.equal((await config.json()).publicToken,h.env.MAPBOX_PUBLIC_TOKEN);
  });
});

test('Worker rejects invalid requests and limits usage before contacting Mapbox',async()=>{
  await fixture(async h=>{
    for(const [path,options,status] of [
      ['/route',{headers:{Origin:'https://other.example'}},403],['/route?url=https://other.example',{},404],
      ['/route',{body:'x'.repeat(1025)},400],['/route',{body:JSON.stringify({from:{lat:90,lng:0},to:b,traffic:true})},400],
      ['/route',{body:JSON.stringify({from:a,to:b,traffic:'true'})},400]
    ])assert.equal((await h.request(path,options)).status,status);
    h.env.ROUTE_LIMITER.limit=async()=>({success:false});assert.equal((await h.request()).status,429);assert.equal(h.calls.length,0);
  });
});

test('upstream errors and exceptions cannot leak tokens or redirects',async()=>{
  for(const upstream of [()=>new Response('pk.unit-test-only',{status:403}),()=>new Response(null,{status:302,headers:{Location:'https://other.example'}}),()=>{throw Error('pk.unit-test-only');}]){
    await fixture(async h=>{const r=await h.request();assert.equal(r.status,502);assert(!(await r.text()).includes(h.env.MAPBOX_PUBLIC_TOKEN));assert.equal(r.headers.get('Location'),null);},upstream);
  }
});
