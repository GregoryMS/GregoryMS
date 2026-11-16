/* Weather-card normalization. All calendar dates use the forecast city's zone. */
((root,factory)=>{const api=factory(typeof module==='object'&&module.exports?require('./weather-core.js'):root.GregleWeather);if(typeof module==='object'&&module.exports)module.exports=api;else root.GregleMapWeatherData=api;})(globalThis,weather=>{
 'use strict';
 function dayKey(time,zone){const p=new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time)),get=t=>p.find(p=>p.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`;}
 const shift=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const weekday=date=>new Intl.DateTimeFormat('en',{weekday:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 function cityCandidate(row,point,limit=Infinity){
  if(!Array.isArray(row)||row.length!==7||!Number.isSafeInteger(row[0])||typeof row[1]!=='string'||!row[1].trim()||row[1].length>160||!weather.coordinates(row[2],row[3])||!/^[A-Z]{2}$/.test(row[4])||typeof row[5]!=='string'||typeof row[6]!=='string')return null;
  const distance=weather.distance(point,{latitude:row[2],longitude:row[3]});if(distance>=limit)return null;
  return {id:row[0],name:row[1],latitude:row[2],longitude:row[3],country:row[4],region:row[5],timezone:row[6],distance};
 }
 function link(city){
  if(!weather.coordinates(city.latitude,city.longitude))throw Error('Invalid weather location');
  const url=new URL('https://weather.gregle.uk/');
  for(const [key,value]of Object.entries({lat:city.latitude,lon:city.longitude,name:city.name,country:city.country,region:city.region,tz:city.timezone}))if(value!==null&&value!==undefined&&value!=='')url.searchParams.set(key,String(value));
  return url.href;
 }
 function model(data,city,now=Date.now()){
  const parsed=weather.globalWeather(data),current=parsed.current,date=shift(dayKey(now,city.timezone),1),index=data.daily.time.indexOf(date);
  if(!Number.isFinite(current.temperature_2m)||index<0||!Number.isFinite(data.daily.temperature_2m_max[index])||!Number.isFinite(data.daily.temperature_2m_min[index]))throw Error('Current conditions or tomorrow’s forecast are unavailable.');
  return {source:'Open-Meteo',sourceURL:'https://open-meteo.com/',zone:city.timezone,
   current:{temperature:current.temperature_2m,condition:weather.condition(current.weather_code),night:current.is_day===0,humidity:current.relative_humidity_2m,wind:current.wind_speed_10m,time:current.time,localTime:true},
   tomorrow:{date,condition:weather.condition(data.daily.weather_code[index]),high:data.daily.temperature_2m_max[index],low:data.daily.temperature_2m_min[index],rain:data.daily.precipitation_probability_max?.[index]}};
 }
 function canadian(data,city,now=Date.now()){
  const p=data?.properties,c=p?.currentConditions,group=p?.forecastGroup,issued=Date.parse(group?.timestamp?.en),observed=Date.parse(c?.timestamp?.en);
  if(!Number.isFinite(issued)||!Number.isFinite(observed)||Math.abs(now-observed)>6*3600000||Math.abs(now-issued)>36*3600000||!Number.isFinite(c?.temperature?.value?.en)||!Array.isArray(group.forecasts))throw Error('Canadian weather is unavailable or out of date.');
  const base=dayKey(issued,city.timezone),date=shift(dayKey(now,city.timezone),1);
  const matching=group.forecasts.filter(item=>{
   const raw=String(item.period?.value?.en||item.period?.textForecastName?.en||'').toLowerCase().replace(/\s+night$/,'');
   if(['today','tonight'].includes(raw))return base===date;
   if(raw==='tomorrow')return shift(base,1)===date;
   for(let n=0;n<7;n++){const candidate=shift(base,n);if(weekday(candidate).toLowerCase()===raw)return candidate===date;}return false;
  });
  const day=matching.find(item=>!/night/i.test(item.period?.value?.en||item.period?.textForecastName?.en||''));
  if(!day)throw Error('Tomorrow’s forecast is unavailable.');
  let high=null,low=null;
  for(const item of matching)for(const temperature of item.temperatures?.temperature||[]){const kind=temperature.class?.en,value=temperature.value?.en;if(Number.isFinite(value)){if(kind==='high')high=value;if(kind==='low')low=value;}}
  if(!Number.isFinite(high))throw Error('Tomorrow’s high is unavailable.');
  const code=c.iconCode?.value;
  return {source:'Environment Canada',sourceURL:'https://weather.gc.ca/',zone:city.timezone,
   current:{temperature:c.temperature.value.en,condition:c.condition?.en||'Conditions unavailable',night:Number.isFinite(code)&&code>=30&&code<40,humidity:c.relativeHumidity?.value?.en,wind:c.wind?.speed?.value?.en,time:c.timestamp.en,station:c.station?.value?.en},
   tomorrow:{date,condition:day.abbreviatedForecast?.textSummary?.en||day.cloudPrecip?.en||'See detailed forecast',high,low,rain:day.abbreviatedForecast?.pop?.value?.en}};
 }
 return {dayKey,shift,weekday,cityCandidate,link,model,canadian};
});
