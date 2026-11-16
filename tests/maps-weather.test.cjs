const {test}=require('node:test'),assert=require('node:assert/strict');
const data=require('../assets/maps-weather-core.js'),tides=require('../assets/tide-core.js');
const city={id:1,name:'Victoria',country:'CA',region:'British Columbia',latitude:48.4359,longitude:-123.3516,timezone:'America/Vancouver'};
const model=(dates=['2026-11-16','2026-11-17'])=>({timezone:'America/Vancouver',current:{time:'2026-11-16T16:30',temperature_2m:0,weather_code:3,is_day:1,relative_humidity_2m:80,wind_speed_10m:0},daily:{time:dates,weather_code:[0,61],temperature_2m_max:[12,9],temperature_2m_min:[7,4],precipitation_probability_max:[10,85]}});
function period(name,high,low){return {period:{value:{en:name}},abbreviatedForecast:{textSummary:{en:name+' showers'}},temperatures:{temperature:[...(high===undefined?[]:[{class:{en:'high'},value:{en:high}}]),...(low===undefined?[]:[{class:{en:'low'},value:{en:low}}])]}};}
function canada(now){return {properties:{currentConditions:{timestamp:{en:new Date(now-600000).toISOString()},temperature:{value:{en:8}},condition:{en:'Rain'},wind:{speed:{value:{en:6}}},relativeHumidity:{value:{en:80}}},forecastGroup:{timestamp:{en:'2026-11-16T21:00:00Z'},forecasts:[period('Monday',11),period('Monday night',undefined,7),period('Tuesday',9),period('Tuesday night',undefined,4),period('Wednesday',10),period('Wednesday night',undefined,3)]}}};}
test('nearest indexed city uses great-circle distance across the dateline and validates records',()=>{
 const point={latitude:0,longitude:179.9},a=data.cityCandidate([1,'East',0,-179.9,'FJ','Eastern','Pacific/Fiji'],point),b=data.cityCandidate([2,'West',0,179,'FJ','Western','Pacific/Fiji'],point);
 assert(a.distance<b.distance);assert.equal(data.cityCandidate([2,'West',0,179,'FJ','Western','Pacific/Fiji'],point,a.distance),null);
 for(const row of [[1,'bad',95,0,'CA','','UTC'],[1,'',48,0,'CA','','UTC'],[1,'bad',48,0,'javascript:evil','','UTC']])assert.equal(data.cityCandidate(row,point),null);
});
test('the Weather link round-trips the forecast city rather than the clicked map point',()=>{
 const url=data.link(city);assert.equal(new URL(url).origin,'https://weather.gregle.uk');const result=tides.locationFromURL(url);assert.equal(result.name,city.name);assert.equal(result.latitude,city.latitude);assert.equal(result.longitude,city.longitude);assert.equal(result.timezone,city.timezone);assert.equal(result.country,'CA');
 const hostile=data.link({...city,name:'<script>&"'});assert.equal(new URL(hostile).searchParams.get('name'),'<script>&"');assert.throws(()=>data.link({...city,latitude:Infinity}));
});
test('model weather selects tomorrow in the city timezone and preserves zero readings',()=>{
 const result=data.model(model(),city,Date.parse('2026-11-17T01:30:00Z'));
 assert.equal(result.tomorrow.date,'2026-11-17');assert.equal(result.tomorrow.high,9);assert.equal(result.tomorrow.low,4);assert.equal(result.tomorrow.rain,85);assert.equal(result.current.temperature,0);assert.equal(result.current.wind,0);assert.equal(result.source,'Open-Meteo');
 assert.equal(data.dayKey(Date.parse('2026-11-16T13:00:00Z'),'Pacific/Auckland'),'2026-11-17');assert.equal(data.shift('2026-12-31',1),'2027-01-01');
});
test('missing tomorrow and incomplete temperatures are not substituted with today',()=>{
 assert.throws(()=>data.model(model(['2026-11-15','2026-11-16']),city,Date.parse('2026-11-17T01:30:00Z')),/unavailable/);
 const bad=model();bad.current.temperature_2m=null;assert.throws(()=>data.model(bad,city,Date.parse('2026-11-17T01:30:00Z')),/unavailable/);
});
test('Canadian weather combines tomorrow daytime high and the following night low',()=>{
 const now=Date.parse('2026-11-17T01:30:00Z'),result=data.canadian(canada(now),city,now);
 assert.equal(result.source,'Environment Canada');assert.equal(result.tomorrow.date,'2026-11-17');assert.equal(result.tomorrow.high,9);assert.equal(result.tomorrow.low,4);assert.equal(result.current.temperature,8);
});
test('Canadian period names remain anchored to issuance across local midnight',()=>{
 const now=Date.parse('2026-11-17T09:00:00Z'),source=canada(now);source.properties.forecastGroup.forecasts.unshift(period('Tomorrow',20));
 const result=data.canadian(source,city,now);assert.equal(result.tomorrow.date,'2026-11-18');assert.equal(result.tomorrow.high,10);assert.equal(result.tomorrow.low,3);
});
test('old Canadian observations and missing next-day forecasts trigger fallback',()=>{
 const now=Date.parse('2026-11-17T01:30:00Z'),source=canada(now);source.properties.currentConditions.timestamp.en='2026-11-16T01:00:00Z';assert.throws(()=>data.canadian(source,city,now),/out of date/);
 const missing=canada(now);missing.properties.forecastGroup.forecasts=[];assert.throws(()=>data.canadian(missing,city,now),/unavailable/);
});
