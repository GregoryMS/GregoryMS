const {test}=require('node:test');
const assert=require('node:assert/strict');
const details=require('../assets/weather-details.js');
const photo=require('../assets/weather-photography.js');
const sun=require('../assets/vendor/suncalc.js');
const now=Date.parse('2026-10-16T17:15:00Z');
function fixture() {return {timezone:'America/Vancouver',current:{time:now/1000,pressure_msl:1022,apparent_temperature:0},hourly:{time:[now/1000-3*3600-900,now/1000-900],pressure_msl:[1020,1022]},daily:{time:[Date.parse('2026-10-16T07:00:00Z')/1000],apparent_temperature_max:[0],apparent_temperature_min:[null]}};}
test('pressure uses station units and reported tendency, preserving unknown trends',()=>{
  assert.deepEqual(details.stationPressure({pressure:{value:{en:102.2},units:{en:'kPa'},tendency:{en:'falling'}}}),{value:102.2,trend:'falling',source:'Environment Canada station observation'});
  assert.equal(details.stationPressure({pressure:{value:{en:1022},units:{en:'hPa'},tendency:{en:'rising'}}}).value,102.2);
  assert.equal(details.stationPressure({pressure:{value:{en:1022},units:{en:'hPa'}}}).trend,null);
  assert.equal(details.stationPressure({pressure:{value:{en:null},units:{en:'kPa'}}}),null);
  assert.equal(details.pressureTrend(0),'steady');assert.equal(details.pressureTrend(-.8),'falling');assert.equal(details.pressureTrend(.8),'rising');assert.equal(details.pressureTrend(null),null);
});
test('model pressure compares matching samples three hours apart and rejects stale data',()=>{
  const data=fixture();assert.equal(details.modelPressure(data,now).trend,'rising');
  data.hourly.pressure_msl[0]=null;assert.equal(details.modelPressure(data,now).trend,null);
  assert.equal(details.modelPressure(data,now+4*3600000),null);
  assert.equal(details.modelPressure(data,now-10*60000),null);
});
test('feels-like ranges retain zero and missing values, and Canadian periods match destination calendar dates',()=>{
  assert.deepEqual(details.dailyFeels(fixture()).get('2026-10-16'),{high:0,low:null});
  assert.deepEqual(details.forecastDates([{key:'Friday'},{key:'Saturday'},{key:'Sunday'}],'2026-10-17T01:00:00Z','America/Vancouver'),['2026-10-16','2026-10-17','2026-10-18']);
  assert.deepEqual(details.forecastDates([{key:'Tonight'},{key:'Monday'}],'2026-11-02T01:00:00Z','America/Vancouver'),['2026-11-01','2026-11-02']);
  const url=new URL(details.forecastURL({latitude:0,longitude:0}));assert.match(url.searchParams.get('current'),/apparent_temperature/);assert.equal(url.searchParams.get('past_days'),'1');
});
test('light windows bracket sunrise and sunset and use the selected time zone across the date line and DST',()=>{
  for(const [place,timezone,key] of [[{latitude:49.24,longitude:-123.12},'America/Vancouver','2026-10-16'],[{latitude:-36.85,longitude:174.76},'Pacific/Auckland','2026-10-17'],[{latitude:49.24,longitude:-123.12},'America/Vancouver','2026-11-01']]) {
    assert.equal(photo.dateKey(photo.zonedNoon(key,timezone),timezone),key);
    const {windows,times}=photo.lightWindows(sun,place,key,timezone);
    assert(windows.every(w=>Number.isFinite(w.start)&&w.start<w.end));
    assert(windows[0].end<times.sunrise);assert(windows[1].start<times.sunrise&&windows[1].end>times.sunrise);
    assert(windows[2].start<times.sunset&&windows[2].end>times.sunset);assert(windows[3].start>times.sunset);
    assert.equal(photo.dateKey(times.solarNoon,timezone),key);
  }
});
test('polar day and night leave unavailable light windows empty',()=>{
  for(const key of ['2026-06-21','2026-12-21']) {
    const {windows}=photo.lightWindows(sun,{latitude:89,longitude:0},key,'UTC');
    assert(windows.every(w=>w.start===null&&w.end===null));
  }
});
test('photography weather keeps missing values unknown and rejects distant hourly samples',()=>{
  const data={hourly:{time:[now/1000],cloud_cover:[0],precipitation_probability:[null],wind_speed_10m:[0],visibility:[10000]}};
  assert.deepEqual(photo.nearbyWeather(data,now),{cloud:0,rain:null,wind:0,visibility:10000});
  assert.equal(photo.nearbyWeather(data,now+3600000),null);
});
function setup() {
  const elements=new Map(),requests=[];
  function node(){return {children:[],textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},querySelector(){return this.feels;}};}
  const el=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const win={document:{getElementById:el},Date:{now:()=>now},AbortController,setTimeout(){return 1;},clearTimeout(){},fetch(url,options){return new Promise(resolve=>requests.push({url,options,resolve}));}};
  const api=details.createController(win),flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  return {api,el,requests,flush,respond:async(i,data)=>{requests[i].resolve({ok:true,json:async()=>data});await flush();}};
}
test('late details cannot overwrite a new city, station pressure wins, and feels-like cards paint in either response order',async()=>{
  const h=setup();h.api.setLocation({latitude:49,longitude:-123});h.api.setLocation({latitude:51,longitude:0});
  assert(h.requests[0].options.signal.aborted);await h.respond(0,fixture());assert.equal(h.el('feelsLike').textContent,'—');
  const feels={setAttribute(){}};h.el('forecastGrid').children=[{querySelector(){return feels;}}];
  h.api.setForecastDays([{date:'2026-10-16'}],'2026-10-16T12:00:00Z','UTC');
  h.api.setObservation({pressure:{value:{en:99},units:{en:'kPa'},tendency:{en:'falling'}}});
  await h.respond(1,fixture());assert.equal(h.el('feelsLike').textContent,'0°C');assert.equal(h.el('pressure').textContent,'99.0 kPa ↓');assert.equal(feels.textContent,'Feels like 0° / —');
  h.api.setForecastDays([{date:'2026-10-16'}],'2026-10-16T12:00:00Z','UTC');assert.equal(feels.textContent,'Feels like 0° / —');
});
