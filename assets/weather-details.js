(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.GregleWeatherDetails=api.createController(root);
})(globalThis,function() {
  'use strict';
  const finite=value=>Number.isFinite(value)?value:null;
  function forecastURL(place) {
    if(!Number.isFinite(place?.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude)>90 || Math.abs(place.longitude)>180) throw Error('Invalid coordinates');
    const params=new URLSearchParams({latitude:place.latitude.toFixed(2),longitude:place.longitude.toFixed(2),
      current:'apparent_temperature,pressure_msl',hourly:'pressure_msl,cloud_cover,precipitation_probability,wind_speed_10m,visibility,apparent_temperature',
      daily:'apparent_temperature_max,apparent_temperature_min',past_days:'1',forecast_days:'8',timezone:'auto',timeformat:'unixtime',temperature_unit:'celsius',wind_speed_unit:'kmh'});
    return 'https://api.open-meteo.com/v1/forecast?'+params;
  }
  function pressureTrend(change) {
    return !Number.isFinite(change)?null:change>.5?'rising':change<-.5?'falling':'steady';
  }
  function stationPressure(current) {
    const pressure=current?.pressure,value=pressure?.value?.en,unit=pressure?.units?.en;
    if(!Number.isFinite(value) || value<=0 || !['kPa','hPa','mb'].includes(unit)) return null;
    const tendency=String(pressure.tendency?.en || '').toLowerCase();
    return {value:unit==='kPa'?value:value/10,trend:/rising|increasing/.test(tendency)?'rising':/falling|decreasing/.test(tendency)?'falling':/steady|stable/.test(tendency)?'steady':null,source:'Environment Canada station observation'};
  }
  function modelPressure(data,now=Date.now()) {
    const c=data?.current,age=now-c?.time*1000;
    if(!Number.isFinite(c?.pressure_msl) || c.pressure_msl<=0 || !Number.isFinite(age) || age < -300000 || age>3*3600000) return null;
    const times=data.hourly?.time || [],end=Math.floor(c.time/3600)*3600;
    const latest=times.indexOf(end),earlier=times.indexOf(end-3*3600);
    const a=data.hourly?.pressure_msl?.[latest],b=data.hourly?.pressure_msl?.[earlier];
    return {value:c.pressure_msl/10,trend:pressureTrend(Number.isFinite(a)&&Number.isFinite(b)?a-b:null),source:'Open-Meteo sea-level pressure estimate; trend over the past 3 hours'};
  }
  function dailyFeels(data) {
    const d=data?.daily, result=new Map();
    if(!Array.isArray(d?.time) || !data.timezone) return result;
    const format=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:data.timezone});
    d.time.forEach((seconds,i)=>{if(Number.isFinite(seconds))result.set(format.format(seconds*1000),{high:finite(d.apparent_temperature_max?.[i]),low:finite(d.apparent_temperature_min?.[i])});});
    return result;
  }
  function forecastDates(days,issued,timezone) {
    const start=new Date(issued);
    if(!Number.isFinite(start.getTime())) return days.map(()=>null);
    const local=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:timezone}).format(start);
    const noon=new Date(local+'T12:00:00Z'); let offset=0;
    return days.map(day=>{
      if(day.date) return day.date;
      const key=String(day.key || day.label).replace(/\s+night$/i,'');
      for(let n=offset;n<8;n++) {
        const date=new Date(noon.getTime()+n*86400000),weekday=date.toLocaleDateString('en-CA',{weekday:'long',timeZone:'UTC'});
        if(weekday.toLowerCase()===key.toLowerCase() || /^(today|tonight)$/i.test(key)&&n===0) {offset=n;return date.toISOString().slice(0,10);}
      }
      return null;
    });
  }
  function createController(win) {
    const $=id=>win.document.getElementById(id),degrees=value=>Number.isFinite(value)?Math.round(value)+'°':'—';
    let version=0,controller=null,data=null,observed=null,dates=[];
    function renderPressure() {
      const reading=observed || modelPressure(data,win.Date.now()),el=$('pressure');
      const arrows={rising:'↑',falling:'↓',steady:'→'};
      el.textContent=reading?`${reading.value.toFixed(1)} kPa${reading.trend?' '+arrows[reading.trend]:''}`:'—';
      el.title=reading?`${reading.trend || 'Trend unavailable'} · ${reading.source}`:'Pressure unavailable';
      el.setAttribute('aria-label',reading?`${reading.value.toFixed(1)} kilopascals, ${reading.trend || 'trend unavailable'}`:'Pressure unavailable');
    }
    function renderFeels() {
      const age=win.Date.now()-data?.current?.time*1000;
      const value=age>=-300000&&age<=3*3600000?data?.current?.apparent_temperature:null;
      $('feelsLike').textContent=Number.isFinite(value)?Math.round(value)+'°C':'—';
      $('feelsLike').title='Open-Meteo apparent temperature estimate';
      const values=dailyFeels(data),cards=$('forecastGrid').children;
      Array.from(cards).forEach((card,i)=>{
        const target=card.querySelector('.forecast-feels');
        if(!target) return;
        const day=values.get(dates[i]);
        target.textContent=`Feels like ${degrees(day?.high)} / ${degrees(day?.low)}`;
        target.title='Feels-like daily high / low · Open-Meteo';
        target.setAttribute('aria-label',`Feels-like daily high ${degrees(day?.high)}, low ${degrees(day?.low)}`);
      });
    }
    async function setLocation(place) {
      controller?.abort(); const id=++version; controller=new win.AbortController(); const request=controller;
      data=null;observed=null;dates=[];renderPressure();renderFeels();
      win.GreglePhotography?.setLocation(place);
      const timeout=win.setTimeout(()=>request.abort(),12000);
      try {
        const response=await win.fetch(forecastURL(place),{signal:request.signal});
        if(!response.ok) throw Error('Weather details unavailable');
        const result=await response.json();
        if(id!==version || request.signal.aborted || result?.error) return;
        data=result;renderPressure();renderFeels();
        win.GreglePhotography?.setForecast(result);
      } catch(_) { /* These optional details do not interrupt the main forecast. */ }
      finally {win.clearTimeout(timeout);}
    }
    return {setLocation,setObservation(current){observed=stationPressure(current);renderPressure();},
      setForecastDays(days,issued,timezone){dates=forecastDates(days,issued,timezone);renderFeels();}};
  }
  return {forecastURL,pressureTrend,stationPressure,modelPressure,dailyFeels,forecastDates,createController};
});
