(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.GreglePhotography=api.createController(root);
})(globalThis,function() {
  'use strict';
  function dateKey(date,timezone) {
    return new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:timezone}).format(date);
  }
  function addDay(key,days) {return new Date(Date.parse(key+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
  function zonedNoon(key,timezone) {
    const target=Date.parse(key+'T12:00:00Z');let value=target;
    const format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    for(let i=0;i<2;i++) {
      const parts=Object.fromEntries(format.formatToParts(value).map(p=>[p.type,p.value]));
      value+=target-Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    }
    return new Date(value);
  }
  function lightWindows(sun,place,key,timezone) {
    if(!sun.times.some(t=>t[1]==='photoMorningStart')) sun.addTime(-4,'photoMorningStart','photoEveningEnd');
    const times=sun.getTimes(zonedNoon(key,timezone),place.latitude,place.longitude);
    const definitions=[['morning-blue','Morning blue hour',times.dawn,times.photoMorningStart,'blue'],
      ['morning-golden','Morning golden hour',times.photoMorningStart,times.goldenHourEnd,'golden'],
      ['evening-golden','Evening golden hour',times.goldenHour,times.photoEveningEnd,'golden'],
      ['evening-blue','Evening blue hour',times.photoEveningEnd,times.dusk,'blue']];
    return {times,windows:definitions.map(([id,label,start,end,kind])=>({id,label,kind,
      start:Number.isFinite(start?.getTime())?start.getTime():null,end:Number.isFinite(end?.getTime())?end.getTime():null}))};
  }
  function nearbyWeather(data,timestamp) {
    const h=data?.hourly;
    if(!Number.isFinite(timestamp) || !Array.isArray(h?.time)) return null;
    let index=-1,distance=Infinity;
    h.time.forEach((s,i)=>{const delta=Math.abs(s*1000-timestamp);if(Number.isFinite(s)&&delta<distance){index=i;distance=delta;}});
    if(index<0 || distance>45*60000) return null;
    const value=(field,min,max)=>{const n=h[field]?.[index];return Number.isFinite(n)&&n>=min&&n<=max?n:null;};
    return {cloud:value('cloud_cover',0,100),rain:value('precipitation_probability',0,100),wind:value('wind_speed_10m',0,500),visibility:value('visibility',0,Infinity)};
  }
  function createController(win) {
    const $=id=>win.document.getElementById(id);let place=null,forecast=null,timezone=null,selected=null,today=null;
    function node(tag,cls,text) {const el=win.document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;}
    function render() {
      if(!place || !win.SunCalc) return;
      if(!timezone) {$('photoStatus').textContent='Finding local light times…';return;}
      try {
        const now=win.Date.now(),localToday=dateKey(now,timezone);
        if(today!==localToday) {today=localToday;selected=today;}
        const select=$('photoDay');
        const options=Array.from({length:7},(_,i)=>{const key=addDay(today,i),label=i===0?'Today':i===1?'Tomorrow':new Date(key+'T12:00:00Z').toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});const option=node('option','',label);option.value=key;return option;});
        select.replaceChildren(...options);select.value=selected;
        const {times,windows}=lightWindows(win.SunCalc,place,selected,timezone);
        const format=new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit',timeZone:timezone});
        const time=value=>Number.isFinite(value instanceof Date?value.getTime():value)?format.format(value):'—';
        const next=windows.filter(w=>w.start!==null&&w.end!==null&&w.end>now).sort((a,b)=>a.start-b.start)[0];
        const active=next && next.start<=now;
        $('photoStatus').textContent=next?`${active?'Now':'Next'} · ${next.label}${active?' · until '+time(next.end):' · '+time(next.start)}`:'No more light windows on this day.';
        $('photoLocation').textContent=`${place.name} · ${selected} · ${timezone.replaceAll('_',' ')}`;
        $('photoWindows').replaceChildren(...windows.map(window=>{
          const card=node('article','photo-card photo-card--'+window.kind);
          if(window.id===next?.id)card.className+=' photo-card--next';
          const label=node('h3','',window.label),valid=window.start!==null&&window.end!==null;
          const range=node('p','photo-time',valid?`${time(window.start)} – ${time(window.end)}`:'No window on this day');
          const duration=node('p','photo-duration',valid?`${Math.round((window.end-window.start)/60000)} min${window.id===next?.id?(active?' · Now':' · Next'):''}`:'Sun does not cross this light range');
          card.append(label,range,duration);return card;
        }));
        const solar=[['Sunrise',time(times.sunrise)],['Sunset',time(times.sunset)],['Solar noon',time(times.solarNoon)]];
        const duration=times.sunset-times.sunrise;
        if(Number.isFinite(duration)&&duration>=0) {const minutes=Math.round(duration/60000);solar.push(['Daylight',`${Math.floor(minutes/60)} h ${minutes%60} min`]);}
        $('photoSun').replaceChildren(...solar.map(([label,value])=>{const row=node('div','');row.append(node('dt','',label),node('dd','',value));return row;}));
        const weather=next?nearbyWeather(forecast,(next.start+next.end)/2):null;
        $('photoWeatherLabel').textContent=next?`Weather near ${next.label.toLowerCase()}`:'Light-window weather';
        const readings=[['Cloud cover',weather?.cloud,'%'],['Rain chance',weather?.rain,'%'],['Wind',weather?.wind,' km/h'],['Visibility',weather?.visibility===null||weather?.visibility===undefined?null:weather.visibility/1000,' km']];
        $('photoWeather').replaceChildren(...readings.map(([label,value,unit])=>{const row=node('div','');row.append(node('dt','',label),node('dd','',Number.isFinite(value)?Math.round(value)+unit:'—'));return row;}));
      } catch(_) {$('photoStatus').textContent='Photography times are temporarily unavailable.';}
    }
    $('photoDay').addEventListener('change',()=>{selected=$('photoDay').value;render();});
    win.document.addEventListener('DOMContentLoaded',render);
    win.document.addEventListener('visibilitychange',()=>{if(!win.document.hidden)render();});
    win.setInterval(()=>{if(!win.document.hidden)render();},60000);
    return {setLocation(value){place=value;forecast=null;timezone=value.timezone || null;today=null;$('photoWindows').replaceChildren();$('photoSun').replaceChildren();$('photoWeather').replaceChildren();render();},
      setForecast(data){forecast=data;if(data?.timezone)timezone=data.timezone;render();}};
  }
  return {dateKey,addDay,zonedNoon,lightWindows,nearbyWeather,createController};
});
