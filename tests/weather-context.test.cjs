const {test}=require('node:test');
const assert=require('node:assert/strict');
const {aqhiObservation,normals,previousDay,createController}=require('../assets/weather-context.js');
const core=require('../assets/weather-core.js');
const NOW=Date.parse('2026-10-09T15:00:00Z');
const victoria={latitude:48.421,longitude:-123.393,name:'Victoria',country:'CA',timezone:'America/Vancouver'};
const observation=(value=4,overrides={},coordinates=[-123.3667,48.4333])=>({geometry:{coordinates},properties:{aqhi:value,observation_datetime:new Date(NOW-3600000).toISOString(),location_name_en:'Victoria / Saanich',...overrides}});
const feed=(...features)=>({features});
test('AQHI uses the closest fresh observation and rounds the published index',()=>{
  const result=aqhiObservation(feed(observation(3.5),observation(9,{},[-123.49,48.42])),victoria,core.distance,NOW);
  assert.equal(result.value,4);
  assert.equal(aqhiObservation(feed(observation(3.4)),victoria,core.distance,NOW).value,3);
  for(const f of [observation(null),observation(-1),observation(5,{observation_datetime:'bad'}),observation(5,{observation_datetime:new Date(NOW-10800001).toISOString()}),observation(5,{},[-120,50])]) assert.equal(aqhiObservation(feed(f),victoria,core.distance,NOW),null);
});
test('normals preserve missing values and zero rather than inventing temperatures',()=>{
  assert.deepEqual(normals(null),{high:null,low:null});
  assert.deepEqual(normals({forecastGroup:{regionalNormals:{temperature:[{class:{en:'high'},value:{en:15}},{class:{en:'low'},value:{en:0}}]}}}),{high:15,low:0});
});
test('yesterday is selected by the location date, including year boundaries',()=>{
  const data={timezone:'America/Vancouver',daily:{time:['2025-12-30','2025-12-31'],temperature_2m_max:[9,10],temperature_2m_min:[0,null],precipitation_sum:[0,2.25]}};
  assert.deepEqual(previousDay(data,new Date('2026-01-01T02:00:00Z')),{date:'2025-12-30',high:9,low:0,rain:0});
  assert.equal(previousDay(data,new Date('2026-01-03T02:00:00Z')),null);
  assert.equal(previousDay({...data,timezone:'not-a-timezone'}),null);
});
function harness() {
  const nodes=new Map(),timers=new Map();let next=0,fetchImpl;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',dataset:{}});return nodes.get(id);};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}}
  const win={document:{getElementById:node},Date:Clock,AbortController,GregleWeather:core,fetch:(...args)=>fetchImpl(...args),
    setTimeout(fn,ms){timers.set(++next,{fn,ms});return next;},clearTimeout(id){timers.delete(id);}};
  const controller=createController(win);
  return {node,controller,timers,setFetch:fn=>fetchImpl=fn};
}
const response=data=>({ok:true,json:async()=>data});
const history={timezone:'America/Vancouver',daily:{time:['2026-10-08','2026-10-09'],temperature_2m_max:[18,19],temperature_2m_min:[8,9],precipitation_sum:[0,0]}};
test('air quality hides low and missing readings, shows moderate and higher, and clears on failure',async()=>{
  const h=harness();
  for(const [value,visible,label] of [[3,false,''],[4,true,'Moderate risk'],[7,true,'High risk'],[11,true,'Very high risk'],[null,false,'']]) {
    h.setFetch(async url=>response(url.includes('aqhi')?feed(observation(value)):history));
    await h.controller.setLocation(victoria);
    assert.equal(h.node('airQualityMetric').hidden,!visible);
    if(visible) assert.ok(h.node('airQuality').textContent.includes(label));
    assert.equal(h.node('yesterdayHigh').textContent,'18°C');
    assert.equal(h.node('yesterdayRain').textContent,'0.0 mm');
  }
  h.setFetch(async()=>{throw Error('offline');}); await h.controller.setLocation(victoria);
  assert.equal(h.node('airQualityMetric').hidden,true);
  assert.equal(h.node('yesterdayHigh').textContent,'—');
  assert.match(h.node('yesterdayNote').textContent,/unavailable/);
});
test('a late request cannot overwrite the newly selected city',async()=>{
  const h=harness(),pending=[];
  h.setFetch((url,options)=>new Promise(resolve=>pending.push({url,options,resolve})));
  const first=h.controller.setLocation(victoria);
  h.setFetch(async url=>response(url.includes('aqhi')?feed(observation(2)):history));
  await h.controller.setLocation({...victoria,name:'New city'});
  for(const request of pending) {assert.equal(request.options.signal.aborted,true);request.resolve(response(request.url.includes('aqhi')?feed(observation(9)):history));}
  await first;
  assert.equal(h.node('historyLocation').textContent,'New city');
  assert.equal(h.node('airQualityMetric').hidden,true);
  assert.match(h.node('yesterdayNote').textContent,/New city/);
});
test('international locations label modelled US AQI and hide good readings',async()=>{
  const h=harness();
  for(const value of [50,51,151,301]) {
    h.setFetch(async url=>response(url.includes('air-quality-api')?{current:{us_aqi:value,time:NOW/1000}}:history));
    await h.controller.setLocation({...victoria,country:'US'});
    assert.equal(h.node('airQualityMetric').hidden,value===50);
    if(value>50) {assert.match(h.node('airQuality').textContent,/US AQI/);assert.match(h.node('airQualityLink').title,/model estimate/);}
  }
});
