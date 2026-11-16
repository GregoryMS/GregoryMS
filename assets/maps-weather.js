/* A point-specific weather card; no GPS permission and no geocoding service. */
'use strict';
window.GregleMapWeather=({map,drawer})=>{
 const $=id=>document.getElementById(id),data=window.GregleMapWeatherData,weather=window.GregleWeather,card=$('map-weather-card'),status=$('map-weather-status'),body=$('map-weather-body'),link=$('map-weather-link'),retry=$('map-weather-retry');
 let controller,version=0,worker,job=0,pending,lastPoint,directory;
 const cache=new Map(),focusMap=()=>map.native3D?.active?map.native3D.focus():$('gregle-map').focus({preventScroll:true});
 function cancel(){version++;controller?.abort();controller=null;if(pending){pending.reject(new DOMException('Aborted','AbortError'));pending=null;worker?.postMessage({cancel:true});}}
 function close(){cancel();card.hidden=true;focusMap();}
 $('close-map-weather').addEventListener('click',close);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!card.hidden&&$('map-context-menu').hidden){event.preventDefault();event.stopImmediatePropagation();close();}},true);
 async function json(url,signal,timeout=9000){
  signal.throwIfAborted();const request=new AbortController(),abort=()=>request.abort(),timer=setTimeout(abort,timeout);signal.addEventListener('abort',abort,{once:true});
  try{const response=await fetch(url,{signal:request.signal,credentials:'omit'});if(!response.ok)throw Error('Weather service temporarily unavailable.');return await response.json();}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
 function cityAt(point,signal){
  if(!worker){worker=new Worker('/assets/maps-weather-worker.js');worker.onmessage=event=>{if(event.data.id!==pending?.id)return;const current=pending;pending=null;event.data.error?current.reject(Error(event.data.error)):current.resolve(event.data.city);};worker.onerror=()=>{pending?.reject(Error('The city directory could not load. Reopen Maps and try again.'));pending=null;worker.terminate();worker=null;};}
  return new Promise((resolve,reject)=>{const id=++job,abort=()=>{if(pending?.id===id){pending=null;worker.postMessage({cancel:true});reject(new DOMException('Aborted','AbortError'));}},cleanup=()=>signal.removeEventListener('abort',abort);pending={id,resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else worker.postMessage({id,point:{latitude:point.lat,longitude:point.lng}});});
 }
 async function forecast(city,signal){
  const key=String(city.id),saved=cache.get(key),today=data.dayKey(Date.now(),city.timezone);
  if(saved&&Date.now()-saved.time<300000&&saved.day===today)return saved.value;
  let value;
  if(city.country==='CA'){
   try{
    if(!directory)directory=json('https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&limit=1000&properties=identifier,name.en,name.fr',signal).catch(error=>{directory=null;throw error;});
    let station=weather.nearestStation(await directory,city);
    // Match Gregle Weather's default Victoria Harbour observation.
    if(station.id==='bc-85'||city.name.toLowerCase()==='victoria'&&['bc-32','bc-59','bc-66'].includes(station.id))station={...station,id:'bc-75'};
    value=data.canadian(await json('https://api.weather.gc.ca/collections/citypageweather-realtime/items/'+station.id+'?f=json',signal),city);
   }catch(error){signal.throwIfAborted();}
  }
  if(!value){const url=new URL(weather.forecastURL(city));url.searchParams.set('forecast_days','2');url.searchParams.set('timezone',city.timezone);url.searchParams.set('temperature_unit','celsius');url.searchParams.set('wind_speed_unit','kmh');value=data.model(await json(url.href,signal),city);}
  signal.throwIfAborted();cache.delete(key);cache.set(key,{time:Date.now(),day:today,value});while(cache.size>12)cache.delete(cache.keys().next().value);return value;
 }
 const degrees=value=>Number.isFinite(value)?Math.round(value)+'°C':'—';
 function render(city,value){
  const c=value.current,t=value.tomorrow;
  $('map-weather-current-icon').innerHTML=weather.weatherIcon(c.condition,c.night);$('map-weather-temperature').textContent=degrees(c.temperature);$('map-weather-condition').textContent=c.condition;
  const facts=[];if(Number.isFinite(c.wind))facts.push(`Wind ${Math.round(c.wind)} km/h`);if(Number.isFinite(c.humidity))facts.push(`Humidity ${Math.round(c.humidity)}%`);$('map-weather-facts').textContent=facts.join(' · ');
  const time=c.localTime?String(c.time).slice(11,16):new Intl.DateTimeFormat('en',{timeZone:city.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(c.time));
  $('map-weather-observed').textContent=(c.localTime?'Updated ':'Observed ')+time+(c.localTime?' · '+city.timezone.replaceAll('_',' '):'');
  $('map-weather-next-icon').innerHTML=weather.weatherIcon(t.condition);$('map-weather-next-condition').textContent=t.condition;
  $('map-weather-next-date').textContent=new Intl.DateTimeFormat('en',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}).format(new Date(t.date+'T12:00:00Z'));
  $('map-weather-high').textContent=degrees(t.high);$('map-weather-low').textContent=degrees(t.low);
  $('map-weather-rain').textContent=Number.isFinite(t.rain)?`Precipitation chance ${Math.round(t.rain)}%`:'';
  $('map-weather-source').textContent=value.source;$('map-weather-source').href=value.sourceURL;
  $('map-weather-provider').hidden=false;body.hidden=false;status.textContent='';card.removeAttribute('aria-busy');
 }
 async function open(point){
  if(!window.GregleMaps.validPoint(point.lat,window.GregleMaps.wrapLongitude(point.lng)))return;
  cancel();lastPoint={lat:point.lat,lng:window.GregleMaps.wrapLongitude(point.lng)};const token=version;
  controller=new AbortController();const request=controller,signal=request.signal,timer=setTimeout(()=>request.abort(),35000);
  card.hidden=false;body.hidden=true;$('map-weather-provider').hidden=true;link.hidden=true;retry.hidden=true;$('map-weather-location').textContent='Weather';$('map-weather-nearby').textContent='Nearest city or town';card.setAttribute('aria-busy','true');
  status.textContent=navigator.onLine===false?'Weather needs an internet connection. Your downloaded maps are still available.':'Finding the nearest city…';drawer?.show('map-weather-card',true);$('map-weather-location').focus({preventScroll:true});
  try{
   if(navigator.onLine===false){retry.hidden=false;return;}
   const city=await cityAt(lastPoint,signal);signal.throwIfAborted();if(token!==version)return;
   let country=city.country;try{country=new Intl.DisplayNames(['en'],{type:'region'}).of(city.country);}catch{}
   $('map-weather-location').textContent=city.name;$('map-weather-nearby').textContent=[city.region,country].filter(Boolean).join(', ')+` · ${city.distance<1?'<1':Math.round(city.distance)} km from this point`;
   link.href=data.link(city);link.hidden=false;status.textContent='Loading current conditions and tomorrow’s forecast…';
   const value=await forecast(city,signal);if(token===version&&!card.hidden)render(city,value);
  }catch(error){if(token===version&&!card.hidden){status.textContent=navigator.onLine===false?'Weather needs an internet connection.':signal.aborted?'Weather took too long to load. Try again.':error.name==='TypeError'?'Weather is temporarily unavailable. Check your connection and try again.':error.message||'Weather is temporarily unavailable.';retry.hidden=false;}}
  finally{clearTimeout(timer);if(token===version)card.removeAttribute('aria-busy');}
 }
 retry.addEventListener('click',()=>lastPoint&&open(lastPoint));
 return {open,close};
};
