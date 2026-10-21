(function(root) {
  'use strict';
  const coordinates = (latitude,longitude) => Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude)<=90 && Math.abs(longitude)<=180;
  function distance(a,b) {
    const rad=Math.PI/180, dLat=(b.latitude-a.latitude)*rad, dLon=(b.longitude-a.longitude)*rad;
    const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;
    return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
  }
  function stationsByDistance(data,location) {
    if (!Array.isArray(data?.features) || data.links?.some(link=>link.rel==='next')) throw Error('Incomplete Canadian city directory');
    const stations=data.features.flatMap(feature=>{
      const c=feature.geometry?.coordinates, p=feature.properties;
      if(!c || !coordinates(c[1],c[0]) || !/^[a-z]{2}-[a-z0-9]+$/.test(p?.identifier) || typeof p?.name?.en!=='string' || !p.name.en.trim()) return [];
      const station={id:p.identifier,name:p.name.en,latitude:c[1],longitude:c[0],observationName:p.currentConditions?.station?.value?.en};
      return [{...station,distance:distance(location,station)}];
    }).sort((a,b)=>a.distance-b.distance);
    return stations;
  }
  function nearestStation(data,location) {
    const stations=stationsByDistance(data,location);
    if(!stations[0] || stations[0].distance>150) throw Error('No nearby Canadian forecast location');
    return stations[0];
  }
  function stationChoices(data,location,selected) {
    const normalized=value=>typeof value==='string' ? value.normalize('NFD').replace(/\p{M}/gu,'').replace(/['’]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() : '';
    const family=name=>normalized(name.replace(/\s*\([^)]*\)\s*$/,'').replace(/\s+(?:Harbour|Island|Airport)$/i,''));
    const namesCity=(value,city)=>(' '+normalized(value)+' ').includes(' '+city+' ');
    const stations=stationsByDistance(data,location), anchor=stations.find(station=>station.id===selected.id);
    if(!anchor) return [];
    const city=family(anchor.name);
    const nearby=stations.filter(station=>station.id.slice(0,2)===anchor.id.slice(0,2) && distance(anchor,station)<=75);
    const named=nearby.filter(station=>station.id===anchor.id || namesCity(station.name,city));
    const observations=new Set(named.map(station=>normalized(station.observationName)).filter(Boolean));
    // A station can serve a city without using that city in its forecast-location name
    // (Gonzales Point reports Victoria Gonzales). Don't add other towns sharing an existing observation.
    const extra=nearby.filter(station=>{
      if(named.includes(station) || !namesCity(station.observationName,city)) return false;
      const observation=normalized(station.observationName);
      if(!observation || observations.has(observation)) return false;
      observations.add(observation); return true;
    });
    return [...named,...extra]
      .sort((a,b)=>a.name.localeCompare(b.name))
      .map(station=>({...station,label:typeof station.observationName==='string' && (normalized(station.name)===city || !namesCity(station.name,city)) ? station.observationName : station.name}));
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
  function iconKind(condition, night = false) {
    const text = String(condition || '').toLowerCase();
    if (/thunder|storm/.test(text)) return 'storm';
    if (/freezing|sleet|ice pellet|rain.*snow|snow.*rain/.test(text)) return 'sleet';
    if (/snow|flurr|blizzard/.test(text)) return 'snow';
    if (/rain|shower|drizzle/.test(text)) return 'rain';
    if (/fog|mist|haze|smoke/.test(text)) return 'fog';
    if (/partly|few cloud|mix of|mainly/.test(text)) return night ? 'partly-night' : 'partly';
    if (/cloud|overcast/.test(text)) return 'cloud';
    if (/clear|sun/.test(text)) return night ? 'moon' : 'sun';
    return 'unknown';
  }
  function weatherIcon(condition, night = false) {
    const kind = iconKind(condition, night);
    const sun = '<g class="sun-stroke"><circle cx="25" cy="24" r="10"/><path d="M25 7v-3m0 40v-3M8 24H5m40 0h-3M13 12l-2-2m28 28-2-2M13 36l-2 2m28-28-2 2"/></g>';
    const moon = '<path class="sun-stroke" d="M36 9a17 17 0 1 0 17 23A18 18 0 0 1 36 9Z"/>';
    const cloud = '<path d="M19 45a10 10 0 0 1-1-20 14 14 0 0 1 26-2 11 11 0 1 1 3 22Z"/>';
    const smallCloud = '<path d="M26 47a8 8 0 0 1-1-16 11 11 0 0 1 21-2 9 9 0 1 1 3 18Z" fill="var(--panel)"/>';
    let art;
    if (kind === 'sun') art = '<g transform="translate(7 7)">' + sun + '</g>';
    else if (kind === 'moon') art = moon;
    else if (kind === 'partly' || kind === 'partly-night') art = (night ? moon : sun) + smallCloud;
    else if (kind === 'fog') art = '<path d="M20 31a9 9 0 0 1 0-18 13 13 0 0 1 24 4 8 8 0 0 1 2 14"/><path class="rain-stroke" d="M10 39h44M16 47h32M21 55h22"/>';
    else if (kind === 'unknown') art = '<circle cx="32" cy="32" r="20" stroke-dasharray="3 6"/><path d="M27 26a5 5 0 1 1 8 4c-3 2-3 3-3 5m0 7h.01"/>';
    else { art = cloud; if (kind === 'rain') art += '<path class="rain-stroke" d="m22 51-3 6m15-6-3 6m15-6-3 6"/>'; if (kind === 'snow') art += '<path class="rain-stroke" d="M22 51v8m-4-4h8m-7-3 6 6m0-6-6 6m23-7v8m-4-4h8m-7-3 6 6m0-6-6 6"/>'; if (kind === 'sleet') art += '<path class="rain-stroke" d="m22 51-3 6m16-6v8m-4-4h8m7-4-3 6"/>'; if (kind === 'storm') art += '<path class="sun-stroke" d="m34 43-9 11h8l-3 8"/>'; }
    return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${art}</svg>`;
  }
  const api={iconKind,weatherIcon,coordinates,distance,nearestStation,stationChoices,searchLocations,condition,globalWeather,forecastURL};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else root.GregleWeather=api;
})(typeof globalThis!=='undefined'?globalThis:this);

