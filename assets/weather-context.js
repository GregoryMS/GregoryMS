(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root.document) root.GregleWeatherContext=api.createController(root);
})(typeof globalThis!=='undefined'?globalThis:this,function() {
  'use strict';
  const MAX_AGE=3*60*60*1000;
  function aqhiObservation(data,location,distance,now=Date.now()) {
    const candidates=(data?.features || []).map(feature=>{
      const p=feature.properties || {}, coordinates=feature.geometry?.coordinates;
      if(!Array.isArray(coordinates) || !coordinates.every(Number.isFinite)) return null;
      const age=now-Date.parse(p.observation_datetime);
      if(!Number.isFinite(age) || age < -300000 || age>MAX_AGE || !Number.isFinite(p.aqhi) || p.aqhi<0) return null;
      const km=distance(location,{latitude:coordinates[1],longitude:coordinates[0]});
      if(!Number.isFinite(km) || km>50) return null;
      return {value:Math.max(1,Math.round(p.aqhi)),name:p.location_name_en || 'Nearby station',time:p.observation_datetime,km};
    }).filter(Boolean).sort((a,b)=>a.km-b.km || Date.parse(b.time)-Date.parse(a.time));
    // Choose the nearest station before applying the threshold, not the worst reading nearby.
    return candidates[0] || null;
  }
  function normals(weather) {
    const values=weather?.forecastGroup?.regionalNormals?.temperature;
    const result={high:null,low:null};
    for(const item of Array.isArray(values)?values:[]) {
      const kind=item?.class?.en,value=item?.value?.en;
      if((kind==='high' || kind==='low') && Number.isFinite(value)) result[kind]=value;
    }
    return result;
  }
  function previousDay(data,now=new Date()) {
    const timezone=data?.timezone;
    if(typeof timezone!=='string') return null;
    let today;
    try { today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now); } catch(_) { return null; }
    const date=new Date(today+'T12:00:00Z'); date.setUTCDate(date.getUTCDate()-1);
    const expected=date.toISOString().slice(0,10),daily=data?.daily;
    const index=daily?.time?.indexOf(expected);
    if(!Number.isInteger(index) || index<0) return null;
    const finite=value=>Number.isFinite(value)?value:null;
    return {date:expected,high:finite(daily.temperature_2m_max?.[index]),low:finite(daily.temperature_2m_min?.[index]),rain:finite(daily.precipitation_sum?.[index])};
  }
  function createController(win) {
    const $=id=>win.document.getElementById(id), degree=value=>Number.isFinite(value)?`${Math.round(value)}°C`:'—';
    let active=null,version=0,location=null,refresh=null;
    function renderNormals(weather,name) {
      const values=normals(weather);
      $('normalHigh').textContent=degree(values.high); $('normalLow').textContent=degree(values.low);
      $('normalNote').textContent=values.high!==null || values.low!==null
        ? `Regional seasonal normals for ${name || location?.name || 'this location'}, supplied with the current Environment Canada forecast.`
        : 'Regional normals are not available for this forecast location.';
    }
    function clearAir() { $('airQualityMetric').hidden=true; $('airQuality').textContent=''; }
    async function json(url,signal) {
      const response=await win.fetch(url,{signal});
      if(!response.ok) throw Error('Weather context unavailable');
      return response.json();
    }
    async function loadAir(place,signal,id) {
      try {
        let reading,scale,label,risk,link;
        if(place.country==='CA') {
          const lat=place.latitude,lon=place.longitude,dx=Math.min(180,0.5/Math.max(.1,Math.cos(lat*Math.PI/180)));
          const bbox=[Math.max(-180,lon-dx),Math.max(-90,lat-.5),Math.min(180,lon+dx),Math.min(90,lat+.5)].join(',');
          const data=await json('https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?f=json&latest=true&limit=1000&bbox='+bbox,signal);
          reading=aqhiObservation(data,place,win.GregleWeather.distance,win.Date.now());
          if(!reading || reading.value<4) return;
          scale='AQHI'; label=reading.value>10?'Very high risk':reading.value>=7?'High risk':'Moderate risk';
          risk=reading.value>10?'very-high':reading.value>=7?'high':'moderate';
          link='https://weather.gc.ca/airquality/pages/index_e.html';
        } else {
          const data=await json(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.latitude.toFixed(2)}&longitude=${place.longitude.toFixed(2)}&current=us_aqi&timeformat=unixtime`,signal);
          const value=data?.current?.us_aqi,time=data?.current?.time,age=win.Date.now()-time*1000;
          if(!Number.isFinite(value) || value<51 || !Number.isFinite(age) || age < -300000 || age>MAX_AGE) return;
          reading={value:Math.round(value),name:'CAMS / Open-Meteo model estimate',time:new Date(time*1000).toISOString()};
          scale='US AQI';label=value>300?'Hazardous':value>200?'Very unhealthy':value>150?'Unhealthy':value>100?'Unhealthy for sensitive groups':'Moderate';
          risk=value>200?'very-high':value>100?'high':'moderate';link='https://open-meteo.com/en/docs/air-quality-api';
        }
        if(id!==version || signal.aborted) return;
        $('airQuality').textContent=`${scale} ${scale==='AQHI' && reading.value>10?'10+':reading.value} · ${label}`;
        $('airQualityMetric').dataset.risk=risk;
        $('airQualityLink').href=link;
        $('airQualityLink').title=`${reading.name} · ${new Date(reading.time).toLocaleString('en-CA',{timeZone:place.timezone || 'UTC',hourCycle:'h23'})}`;
        $('airQualityMetric').hidden=false;
      } catch(_) { /* Optional air quality must not interrupt the forecast. */ }
    }
    async function loadHistory(place,signal,id) {
      try {
        const data=await json(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude.toFixed(2)}&longitude=${place.longitude.toFixed(2)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&past_days=1&forecast_days=1&timezone=auto`,signal);
        if(id!==version || signal.aborted) return;
        const day=previousDay(data,new win.Date());
        if(!day || [day.high,day.low,day.rain].every(value=>value===null)) throw Error('Missing history');
        $('yesterdayHigh').textContent=degree(day.high); $('yesterdayLow').textContent=degree(day.low);
        $('yesterdayRain').textContent=day.rain===null?'—':`${day.rain.toFixed(1)} mm`;
        $('yesterdayLabel').textContent='Yesterday · '+new Date(day.date+'T12:00:00Z').toLocaleDateString('en-CA',{month:'short',day:'numeric',timeZone:'UTC'});
        $('yesterdayNote').textContent=`Archived model estimates for ${place.name}. Calendar day in ${data.timezone.replaceAll('_',' ')}.`;
      } catch(_) {
        if(id===version && !signal.aborted) $('yesterdayNote').textContent='Previous-day weather is temporarily unavailable.';
      }
    }
    async function setLocation(place) {
      active?.abort(); win.clearTimeout(refresh); const id=++version;
      location=place; const controller=new win.AbortController(); active=controller;
      clearAir(); renderNormals(null); $('historyLocation').textContent=place.name;
      $('normalNote').textContent=place.country==='CA'?'Loading regional normals…':'Regional normals are not available for this forecast location.';
      for(const field of ['yesterdayHigh','yesterdayLow','yesterdayRain']) $(field).textContent='—';
      $('yesterdayLabel').textContent='Yesterday'; $('yesterdayNote').textContent='Loading previous-day weather…';
      const timeout=win.setTimeout(()=>{controller.abort();if(id===version && $('yesterdayNote').textContent==='Loading previous-day weather…') $('yesterdayNote').textContent='Previous-day weather is temporarily unavailable.';},12000);
      await Promise.allSettled([loadAir(place,controller.signal,id),loadHistory(place,controller.signal,id)]);
      win.clearTimeout(timeout);
      if(id===version) refresh=win.setTimeout(()=>refreshAir(place,id),15*60*1000);
    }
    async function refreshAir(place,id) {
      if(id!==version) return;
      clearAir(); const controller=new win.AbortController(); active=controller;
      const timeout=win.setTimeout(()=>controller.abort(),12000);
      await loadAir(place,controller.signal,id); win.clearTimeout(timeout);
      if(id===version) refresh=win.setTimeout(()=>refreshAir(place,id),15*60*1000);
    }
    return {setLocation,renderNormals};
  }
  return {aqhiObservation,normals,previousDay,createController};
});
