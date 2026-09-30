(function(root) {
  'use strict';
  const T=typeof module!=='undefined' && module.exports?require('./tide-core.js'):root.GregleTides;
  const W=typeof module!=='undefined' && module.exports?require('./weather-core.js'):root.GregleWeather;
  const fields={marine:{wave_height:'m',wave_direction:'°',wave_period:'s',swell_wave_height:'m',swell_wave_direction:'°',swell_wave_period:'s',sea_surface_temperature:'°C'},wind:{wind_speed_10m:'km/h',wind_direction_10m:'°',wind_gusts_10m:'km/h'}};
  function url(place,type) {
    if(!W.coordinates(place.latitude,place.longitude))throw Error('Invalid location');
    const p=new URLSearchParams({latitude:place.latitude,longitude:place.longitude,hourly:Object.keys(fields[type]).join(','),timezone:'auto',timeformat:'unixtime',forecast_days:7});
    if(type==='marine')p.set('cell_selection','sea');else p.set('wind_speed_unit','kmh');
    return (type==='marine'?'https://marine-api.open-meteo.com/v1/marine?':'https://api.open-meteo.com/v1/forecast?')+p;
  }
  function parse(data,type,place) {
    if(data?.error || !W.coordinates(data?.latitude,data?.longitude) || !Array.isArray(data?.hourly?.time))throw Error('Invalid forecast');
    const distance=W.distance(place,data);
    if(type==='marine' && distance>25)throw Error('No nearby sea forecast');
    const rows=data.hourly.time.map((t,i)=>{
      if(!Number.isFinite(t) || (i && t<=data.hourly.time[i-1]))throw Error('Invalid forecast time');
      const row={time:t*1000};
      for(const [key,unit] of Object.entries(fields[type])) {
        const value=data.hourly[key]?.[i];
        row[key]=data.hourly_units?.[key]===unit && Number.isFinite(value) && (unit==='°C' || value>=0) && (unit!=='°' || value<=360)?value:null;
      }
      return row;
    });
    return {rows,timezone:T.timezone(data.timezone),distance};
  }
  function direction(value) {return Number.isFinite(value)?['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(value/22.5)%16]:null;}
  function hours(marine,wind,day,zone) {
    const rows=new Map();
    for(const source of [marine,wind])for(const row of source?.rows || [])if(T.dayKey(row.time,zone)===day)rows.set(row.time,{...rows.get(row.time),...row});
    return [...rows.values()].sort((a,b)=>a.time-b.time);
  }
  function defaultTime(rows,day,zone,now=Date.now()) {
    if(!rows.length)return null;
    if(day===T.dayKey(now,zone))return rows.reduce((a,b)=>Math.abs(a.time-now)<=Math.abs(b.time-now)?a:b).time;
    const hour=t=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(t));
    return rows.reduce((a,b)=>Math.abs(hour(a.time)-12)<=Math.abs(hour(b.time)-12)?a:b).time;
  }
  async function request(place,type,signal) {
    const c=new AbortController(),abort=()=>c.abort();
    if(signal?.aborted)throw Error('Cancelled');
    signal?.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,12000);
    try {const r=await fetch(url(place,type),{signal:c.signal});if(!r.ok)throw Error('Unavailable');return parse(await r.json(),type,place);}
    finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  const api={fields,url,parse,direction,hours,defaultTime,request};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.GregleSurf=api;
})(globalThis);
