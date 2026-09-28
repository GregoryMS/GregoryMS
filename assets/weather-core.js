(function(root) {
  'use strict';
  const coordinates = (latitude,longitude) => Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude)<=90 && Math.abs(longitude)<=180;
  function distance(a,b) {
    const rad=Math.PI/180, dLat=(b.latitude-a.latitude)*rad, dLon=(b.longitude-a.longitude)*rad;
    const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;
    return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
  }
  function nearestStation(data,location) {
    if (!Array.isArray(data?.features) || data.links?.some(link=>link.rel==='next')) throw Error('Incomplete Canadian city directory');
    const stations=data.features.flatMap(feature=>{
      const c=feature.geometry?.coordinates, p=feature.properties;
      if(!c || !coordinates(c[1],c[0]) || !/^[a-z]{2}-\d+$/.test(p?.identifier) || !p?.name?.en) return [];
      const station={id:p.identifier,name:p.name.en,latitude:c[1],longitude:c[0]};
      return [{...station,distance:distance(location,station)}];
    }).sort((a,b)=>a.distance-b.distance);
    if(!stations[0] || stations[0].distance>150) throw Error('No nearby Canadian forecast location');
    return stations[0];
  }
  function searchLocations(data) {
    if(data?.error || (data.results!==undefined && !Array.isArray(data.results))) throw Error('Invalid city search');
    return (data.results || []).filter(r=>coordinates(r.latitude,r.longitude) && r.name && /^[A-Z]{2}$/.test(r.country_code)).map(r=>({
      name:String(r.name),region:[r.admin1,r.country].filter(Boolean).join(', '),country:r.country_code,
      latitude:r.latitude,longitude:r.longitude,timezone:r.timezone || 'UTC'
    }));
  }
  const codes={0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Freezing fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Heavy freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Light rain showers',81:'Rain showers',82:'Heavy rain showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorms',96:'Thunderstorms with hail',99:'Severe thunderstorms with hail'};
  const condition=code=>codes[code] || 'Conditions unavailable';
  function globalWeather(data) {
    const d=data?.daily, c=data?.current;
    if(data?.error || !d || !Array.isArray(d.time) || !d.time.length || !c || typeof c.time!=='string' || !data.timezone) throw Error('Incomplete global forecast');
    const fields=['weather_code','temperature_2m_max','temperature_2m_min'];
    if(fields.some(f=>!Array.isArray(d[f]) || d[f].length!==d.time.length)) throw Error('Incomplete daily forecast');
    const days=d.time.map((day,i)=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error('Invalid forecast date');
      const rain=d.precipitation_probability_max?.[i];
      return {label:new Date(day+'T12:00:00Z').toLocaleDateString('en-CA',{weekday:'long',timeZone:'UTC'}),date:day,
        high:d.temperature_2m_max[i],low:d.temperature_2m_min[i],condition:condition(d.weather_code[i]),
        description:condition(d.weather_code[i])+(Number.isFinite(rain)?`. Chance of precipitation ${rain}%.`:'.')};
    });
    return {current:c,days,timezone:String(data.timezone)};
  }
  function forecastURL(location) {
    if(!coordinates(location.latitude,location.longitude)) throw Error('Invalid coordinates');
    return 'https://api.open-meteo.com/v1/forecast?latitude='+location.latitude.toFixed(2)+'&longitude='+location.longitude.toFixed(2)+'&current=temperature_2m,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7';
  }
  const api={coordinates,distance,nearestStation,searchLocations,condition,globalWeather,forecastURL};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else root.GregleWeather=api;
})(typeof globalThis!=='undefined'?globalThis:this);
