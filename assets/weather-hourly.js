(function(root,factory) {
  'use strict';
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.GregleWeatherHourly=api.createController(root);
})(globalThis,function() {
  'use strict';
  const fields=['temperature_2m','apparent_temperature','weather_code','is_day','precipitation_probability','wind_speed_10m'];
  function forecastURL(location) {
    if(!Number.isFinite(location?.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude)>90 || Math.abs(location.longitude)>180) throw Error('Invalid coordinates');
    return 'https://api.open-meteo.com/v1/forecast?latitude='+location.latitude.toFixed(2)+'&longitude='+location.longitude.toFixed(2)+'&hourly='+fields.join(',')+'&daily=sunrise,sunset&timezone=auto&timeformat=unixtime&forecast_hours=24&forecast_days=2&temperature_unit=celsius&wind_speed_unit=kmh';
  }
  function parseHours(data,now=Date.now()) {
    const h=data?.hourly;
    if(data?.error || !h || !Array.isArray(h.time) || !h.time.length || fields.filter(f=>f!=='apparent_temperature').some(f=>!Array.isArray(h[f]) || h[f].length!==h.time.length)) throw Error('Incomplete hourly forecast');
    const timezone=data.timezone;
    if(typeof timezone!=='string' || !timezone) throw Error('Missing time zone');
    const time=new Intl.DateTimeFormat('en-CA',{hour:'2-digit',hourCycle:'h23',minute:'2-digit',timeZone:timezone});
    const day=new Intl.DateTimeFormat('en-CA',{weekday:'short',month:'short',day:'numeric',timeZone:timezone});
    const full=new Intl.DateTimeFormat('en-CA',{weekday:'long',month:'short',day:'numeric',hour:'2-digit',hourCycle:'h23',minute:'2-digit',timeZoneName:'short',timeZone:timezone});
    const start=Math.floor(now/3600000)*3600000;
    let previous=-Infinity;
    const hours=h.time.flatMap((seconds,i)=>{
      const timestamp=seconds*1000;
      if(!Number.isFinite(seconds) || timestamp<=previous || !Number.isFinite(new Date(timestamp).getTime())) throw Error('Invalid hourly timestamp');
      previous=timestamp;
      if(timestamp<start || timestamp>=start+24*3600000) return [];
      const chance=h.precipitation_probability[i],wind=h.wind_speed_10m[i];
      return [{timestamp,time:time.format(timestamp),day:day.format(timestamp),label:full.format(timestamp),temperature:h.temperature_2m[i],feelsLike:Number.isFinite(h.apparent_temperature?.[i])?h.apparent_temperature[i]:null,code:h.weather_code[i],night:h.is_day[i]===0,
        chance:Number.isFinite(chance)&&chance>=0&&chance<=100?chance:null,wind:Number.isFinite(wind)&&wind>=0?wind:null}];
    });
    if(!hours.length || !hours.some(h=>Number.isFinite(h.temperature))) throw Error('Hourly forecast unavailable');
    // Solar events are optional: polar days/nights and missing data must not hide the forecast.
    const seen=new Set(),events=[];
    for(const [kind,name] of [['sunrise','Sunrise'],['sunset','Sunset']]) {
      const values=data.daily?.[kind];
      if(!Array.isArray(values)) continue;
      for(const seconds of values) {
        const timestamp=seconds*1000,key=kind+':'+timestamp;
        if(!Number.isFinite(seconds) || !Number.isFinite(new Date(timestamp).getTime()) || timestamp<start || timestamp>=start+24*3600000 || seen.has(key)) continue;
        seen.add(key);
        events.push({kind,name,timestamp,time:time.format(timestamp),day:day.format(timestamp),label:name+' · '+full.format(timestamp)});
      }
    }
    events.sort((a,b)=>a.timestamp-b.timestamp);
    return {hours,events,timezone};
  }
  function createController(win) {
    const $=id=>win.document.getElementById(id),core=win.GregleWeather;
    let location=null,active=false,controller=null,version=0,cached=null;
    const grid=$('hourlyGrid'),panel=$('hourlyPanel'),status=$('hourlyStatus');
    const now=()=>win.Date.now();
    function cancel() { version++;controller?.abort();controller=null;panel.setAttribute('aria-busy','false'); }
    function navigation() {
      $('hourlyPrevious').disabled=grid.scrollLeft<=1;
      $('hourlyNext').disabled=grid.scrollLeft+grid.clientWidth>=grid.scrollWidth-1;
    }
    function node(tag,className,text) {const el=win.document.createElement(tag);el.className=className;if(text!==undefined)el.textContent=text;return el;}
    function render(data) {
      const forecast=parseHours(data,now());
      const timeline=[...forecast.hours,...forecast.events].sort((a,b)=>a.timestamp-b.timestamp || (a.kind?-1:b.kind?1:0));
      const cards=timeline.map(hour=>{
        if(hour.kind) {
          const card=node('article','forecast-card hourly-card hourly-solar-card');card.setAttribute('aria-label',hour.label);
          const icon=node('div','forecast-icon hourly-solar-icon');
          const arrow=hour.kind==='sunrise'?'M32 27V9m-6 6 6-6 6 6':'M32 9v18m-6-6 6 6 6-6';
          icon.innerHTML='<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 44a14 14 0 0 1 28 0M8 44h48M16 53h32M11 30l5 3m32 0 5-3M9 39h4m38 0h4"/><path d="'+arrow+'"/></svg>';
          card.append(node('h3','period',hour.time),node('p','hourly-date',hour.day),icon,node('p','hourly-solar-label',hour.name));
          return card;
        }
        const card=node('article','forecast-card hourly-card');card.setAttribute('aria-label',hour.label);
        const time=node('h3','period',hour.time),date=node('p','hourly-date',hour.day);
        const icon=node('div','forecast-icon');icon.innerHTML=core.weatherIcon(core.condition(hour.code),hour.night);
        const temp=node('p','hourly-temperature',Number.isFinite(hour.temperature)?Math.round(hour.temperature)+'°C':'—');
        const condition=node('p','forecast-condition',core.condition(hour.code));
        const details=node('dl','hourly-details');
        for(const [label,value] of [['Feels like',Number.isFinite(hour.feelsLike)?Math.round(hour.feelsLike)+'°C':'—'],['Precipitation',Number.isFinite(hour.chance)?Math.round(hour.chance)+'%':'—'],['Wind',Number.isFinite(hour.wind)?Math.round(hour.wind)+' km/h':'—']]) {
          const row=node('div','');row.append(node('dt','',label),node('dd','',value));details.append(row);
        }
        card.append(time,date,icon,temp,condition,details);return card;
      });
      grid.replaceChildren(...cards);grid.scrollLeft=0;
      status.textContent=`${forecast.hours.length} hours · ${location.name} · ${forecast.timezone.replaceAll('_',' ')}`;
      navigation();
    }
    async function load() {
      if(!active || !location) return;
      cancel();const id=version;
      $('hourlyRetry').hidden=true;
      if(cached && now()-cached.fetched<15*60000 && Math.floor(cached.fetched/3600000)===Math.floor(now()/3600000)) {render(cached.data);return;}
      grid.replaceChildren();navigation();status.textContent=`Loading hourly forecast for ${location.name}…`;panel.setAttribute('aria-busy','true');
      const request=new win.AbortController();controller=request;
      const timeout=win.setTimeout(()=>request.abort(),12000);
      try {
        const response=await win.fetch(forecastURL(location),{signal:request.signal});
        if(!response.ok) throw Error('Service unavailable');
        const data=await response.json();
        if(id!==version || !active || request.signal.aborted) return;
        render(data);cached={data,fetched:now()};
      } catch(error) {
        if(id!==version || !active) return;
        status.textContent=`Hourly forecast for ${location.name} is temporarily unavailable. Try again or switch to Daily.`;
        $('hourlyRetry').hidden=false;
      } finally {win.clearTimeout(timeout);if(id===version){controller=null;panel.setAttribute('aria-busy','false');}}
    }
    function setActive(value) {
      active=value;$('forecastGrid').hidden=active;$('updated').hidden=active;panel.hidden=!active;
      $('forecast-heading').textContent=active?'The hours ahead':'The days ahead';
      if(active) load();else cancel();
    }
    $('forecastDaily').addEventListener('change',()=>setActive(false));
    $('forecastHourly').addEventListener('change',()=>setActive(true));
    $('hourlyRetry').addEventListener('click',()=>load());
    for(const [id,direction] of [['hourlyPrevious',-1],['hourlyNext',1]]) $(id).addEventListener('click',()=>grid.scrollBy({left:direction*grid.clientWidth*.85,behavior:'auto'}));
    grid.addEventListener('scroll',navigation,{passive:true});win.addEventListener('resize',navigation);
    return {setLocation(value){cancel();location=value;cached=null;grid.replaceChildren();status.textContent='';if(active)load();},setActive};
  }
  return {forecastURL,parseHours,createController};
});


