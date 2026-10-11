(function(root,factory) {
  'use strict';
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.GregleWeatherHourly=api.createController(root);
})(globalThis,function() {
  'use strict';
  const fields=['temperature_2m','weather_code','is_day','precipitation_probability','wind_speed_10m'];
  function forecastURL(location) {
    if(!Number.isFinite(location?.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude)>90 || Math.abs(location.longitude)>180) throw Error('Invalid coordinates');
    return 'https://api.open-meteo.com/v1/forecast?latitude='+location.latitude.toFixed(2)+'&longitude='+location.longitude.toFixed(2)+'&hourly='+fields.join(',')+'&timezone=auto&timeformat=unixtime&forecast_hours=24&temperature_unit=celsius&wind_speed_unit=kmh';
  }
  function parseHours(data,now=Date.now()) {
    const h=data?.hourly;
    if(data?.error || !h || !Array.isArray(h.time) || !h.time.length || fields.some(f=>!Array.isArray(h[f]) || h[f].length!==h.time.length)) throw Error('Incomplete hourly forecast');
    const timezone=data.timezone;
    if(typeof timezone!=='string' || !timezone) throw Error('Missing time zone');
    const time=new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit',timeZone:timezone});
    const day=new Intl.DateTimeFormat('en-CA',{weekday:'short',month:'short',day:'numeric',timeZone:timezone});
    const full=new Intl.DateTimeFormat('en-CA',{weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:timezone});
    const start=Math.floor(now/3600000)*3600000;
    let previous=-Infinity;
    const hours=h.time.flatMap((seconds,i)=>{
      const timestamp=seconds*1000;
      if(!Number.isFinite(seconds) || timestamp<=previous || !Number.isFinite(new Date(timestamp).getTime())) throw Error('Invalid hourly timestamp');
      previous=timestamp;
      if(timestamp<start || timestamp>=start+24*3600000) return [];
      const chance=h.precipitation_probability[i],wind=h.wind_speed_10m[i];
      return [{timestamp,time:time.format(timestamp),day:day.format(timestamp),label:full.format(timestamp),temperature:h.temperature_2m[i],code:h.weather_code[i],night:h.is_day[i]===0,
        chance:Number.isFinite(chance)&&chance>=0&&chance<=100?chance:null,wind:Number.isFinite(wind)&&wind>=0?wind:null}];
    });
    if(!hours.length || !hours.some(h=>Number.isFinite(h.temperature))) throw Error('Hourly forecast unavailable');
    return {hours,timezone};
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
      const cards=forecast.hours.map(hour=>{
        const card=node('article','forecast-card hourly-card');card.setAttribute('aria-label',hour.label);
        const time=node('h3','period',hour.time),date=node('p','hourly-date',hour.day);
        const icon=node('div','forecast-icon');icon.innerHTML=core.weatherIcon(core.condition(hour.code),hour.night);
        const temp=node('p','hourly-temperature',Number.isFinite(hour.temperature)?Math.round(hour.temperature)+'°C':'—');
        const condition=node('p','forecast-condition',core.condition(hour.code));
        const details=node('dl','hourly-details');
        for(const [label,value] of [['Precipitation',Number.isFinite(hour.chance)?Math.round(hour.chance)+'%':'—'],['Wind',Number.isFinite(hour.wind)?Math.round(hour.wind)+' km/h':'—']]) {
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
