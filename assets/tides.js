(function() {
  'use strict';
  const core=globalThis.GregleTides, ui=globalThis.GregleTideUI, weather=globalThis.GregleWeather, $=id=>document.getElementById(id);
  const cities={victoria:{name:'Victoria',latitude:48.43,longitude:-123.36},vancouver:{name:'Vancouver',latitude:49.24,longitude:-123.12},tofino:{name:'Tofino',latitude:49.15,longitude:-125.91}};
  let location=null,data=null,selectedDay=null,controller=null,version=0,lookupVersion=0,lookupController=null,loadedAt=0;
  function cancelLookup() { lookupVersion++;lookupController?.abort();$('tideSearchButton').disabled=false;$('locateTides').disabled=false; }
  function dayLabel(day) { return new Date(day+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}); }
  function svgNode(tag,attributes,text) { const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))n.setAttribute(key,value);if(text!==undefined)n.textContent=text;return n; }
  function renderChart(day) {
    const host=$('tideChart');host.replaceChildren();
    const points=data.points.filter(p=>core.dayKey(p.time,data.timezone)===day),valid=points.filter(p=>Number.isFinite(p.height));
    if(valid.length<2) {host.append(ui.node('p','location-note','The tide curve is unavailable for this day.'));return;}
    const first=points[0].time,last=points.at(-1).time;
    const min=Math.floor((Math.min(...valid.map(p=>p.height))-.15)*2)/2,max=Math.ceil((Math.max(...valid.map(p=>p.height))+.15)*2)/2;
    const width=Math.max(320,host.clientWidth || 900),right=width-32;
    const x=t=>58+(t-first)/(last-first)*(right-58),y=h=>220-(h-min)/(max-min)*180;
    const svg=svgNode('svg',{viewBox:`0 0 ${width} 268`,role:'img','aria-labelledby':'chartTitle chartDescription'});
    svg.append(svgNode('title',{id:'chartTitle'},'Tide curve for '+dayLabel(day)),svgNode('desc',{id:'chartDescription'},`${data.datum}. ${data.model?'Hourly model estimates.':'Station predictions.'} High and low tide times are listed below.`));
    for(let i=0;i<=3;i++) {const h=min+(max-min)*i/3;svg.append(svgNode('line',{x1:58,x2:right,y1:y(h),y2:y(h),class:'chart-grid'}),svgNode('text',{x:46,y:y(h)+4,'text-anchor':'end'},h.toFixed(1)+' m'));}
    let segments=[],segment=[];
    for(const p of points) {if(!Number.isFinite(p.height) || (segment.length && p.time-segment.at(-1).time>3600000)) {if(segment.length)segments.push(segment);segment=[];}if(Number.isFinite(p.height))segment.push(p);}
    if(segment.length)segments.push(segment);
    for(const s of segments) svg.append(svgNode('polyline',{points:s.map(p=>x(p.time)+','+y(p.height)).join(' '),class:'tide-curve'}));
    for(const p of points) {const clock=new Date(p.time).toLocaleTimeString('en-GB',{timeZone:data.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});if(/^(00|06|12|18):00$/.test(clock))svg.append(svgNode('text',{x:x(p.time),y:251,'text-anchor':'middle'},ui.time(p.time,data.timezone)));}
    const now=Date.now();if(now>=first && now<=last)svg.append(svgNode('line',{x1:x(now),x2:x(now),y1:28,y2:220,class:'chart-now'}),svgNode('text',{x:x(now),y:18,'text-anchor':'middle'},'Now'));
    host.append(svg);
  }
  function renderDay(day) {
    selectedDay=day;
    document.querySelectorAll('[data-tide-day]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tideDay===day)));
    $('tideDayTitle').textContent=dayLabel(day)+' · '+(data.model?'estimated tides':'highs & lows');
    $('tideDayEvents').replaceChildren(ui.eventsList(data.events.filter(e=>core.dayKey(e.time,data.timezone)===day),data));
    renderChart(day);
  }
  function render() {
    const now=Date.now(),reading=core.current(data.points,now),next=data.events.find(e=>e.time>now);
    $('tideContent').hidden=false;$('tideProvider').textContent=data.source;$('tideStation').textContent=data.station;
    $('tideModelLabel').textContent=data.model?'Model estimate':'Station predictions';
    $('tideLevel').textContent=reading?ui.height(reading.height):'—';$('tideTrend').textContent=reading?reading.trend:'Current prediction unavailable';
    $('tideNext').textContent=next?next.type+' · '+ui.time(next.time,data.timezone):'No upcoming tide available';
    $('tideNextHeight').textContent=next?dayLabel(core.dayKey(next.time,data.timezone))+' · '+ui.height(next.height):'';
    $('tideDatum').textContent=data.datum;$('tideZone').textContent='Times in '+data.timezone.replaceAll('_',' ');
    $('tideNote').textContent=data.note;$('tideSource').href=data.sourceURL;
    const days=core.dayKeys(now,data.timezone);
    $('tideDays').replaceChildren(...days.map((day,i)=>{const b=ui.node('button','tide-day');b.type='button';b.dataset.tideDay=day;b.setAttribute('aria-pressed','false');
      b.append(ui.node('strong','',i===0?'Today':new Date(day+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',weekday:'short'})),ui.node('span','',new Date(day+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',month:'short',day:'numeric'})));
      b.addEventListener('click',()=>renderDay(day));return b;}));
    renderDay(days.includes(selectedDay)?selectedDay:days[0]);
  }
  async function refresh() {
    controller?.abort();controller=new AbortController();const currentController=controller,id=++version;
    data=null;$('tideContent').hidden=true;$('tideContent').setAttribute('aria-busy','true');$('refreshTides').disabled=true;$('tideNote').textContent='';
    $('tideSource').href='https://www.tides.gc.ca/';$('tideStatus').textContent='Loading tides for '+location.name+'…';
    try {
      const result=await globalThis.GregleTideData.load(location,currentController.signal);
      if(id!==version)return;
      if(!result) {$('tideStatus').textContent='No nearby tide data for '+location.name+'. Search for a coastal city.';return;}
      data=result;loadedAt=Date.now();render();$('tideStatus').textContent='Updated '+ui.time(loadedAt,data.timezone)+' · '+(data.model?'Approximate model forecast':'Official station predictions');
    } catch(_) {if(id===version)$('tideStatus').textContent='Tide data is temporarily unavailable for '+location.name+'. Try Refresh or choose another location.';}
    finally {if(id===version){$('refreshTides').disabled=false;$('tideContent').setAttribute('aria-busy','false');}}
  }
  function select(value,key=null) {
    if(!weather.coordinates(value.latitude,value.longitude))return;
    cancelLookup();location=value;selectedDay=null;
    $('tideCity').textContent=value.name;$('tideRegion').textContent=value.region || 'Coastal tide forecast';document.title=value.name+' tides · Gregle';
    $('weatherLink').href=core.locationURL('weather.html',value);
    if(window.history?.replaceState) window.history.replaceState(null,'',core.locationURL('tides.html',value));
    $('tideResults').replaceChildren();$('tideLocationStatus').textContent='Showing tides for '+value.name+'.';
    document.querySelectorAll('[data-tide-city]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tideCity===key)));
    return refresh();
  }
  async function search(event) {
    event.preventDefault();const query=$('tideQuery').value.trim();if(query.length<2)return;
    cancelLookup();const id=lookupVersion;lookupController=new AbortController();const c=lookupController,timeout=setTimeout(()=>c.abort(),10000);
    $('tideSearchButton').disabled=true;$('tideResults').replaceChildren();$('tideLocationStatus').textContent='Finding matching locations…';
    try {
      const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(query)+'&count=8&language=en&format=json',{signal:c.signal});if(!r.ok)throw Error('Search unavailable');
      const results=weather.searchLocations(await r.json());if(id!==lookupVersion)return;
      $('tideLocationStatus').textContent=results.length?'Choose a location:':'No locations found. Try a nearby city or a different spelling.';
      $('tideResults').replaceChildren(...results.map(value=>{const b=ui.node('button','pill',[value.name,value.region].filter(Boolean).join(' · '));b.type='button';b.addEventListener('click',()=>select(value));return b;}));
    } catch(_) {if(id===lookupVersion)$('tideLocationStatus').textContent='Location search is unavailable. Try again or use a shortcut.';}
    finally {clearTimeout(timeout);if(id===lookupVersion)$('tideSearchButton').disabled=false;}
  }
  function locate() {
    cancelLookup();const id=lookupVersion;
    if(!navigator.geolocation){$('tideLocationStatus').textContent='Location is unavailable. Search for a coastal city.';return;}
    $('locateTides').disabled=true;$('tideLocationStatus').textContent='Finding your location…';
    const failed=()=>{if(id===lookupVersion){$('locateTides').disabled=false;$('tideLocationStatus').textContent='Location access is unavailable. Search for a city or choose a shortcut.';}};
    try {navigator.geolocation.getCurrentPosition(async p=>{
      if(id!==lookupVersion)return;
      if(!weather.coordinates(p.coords.latitude,p.coords.longitude)){failed();return;}
      const latitude=Number(p.coords.latitude.toFixed(2)),longitude=Number(p.coords.longitude.toFixed(2));
      let value={latitude,longitude,name:'Your location',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
      lookupController=new AbortController();const c=lookupController,timeout=setTimeout(()=>c.abort(),8000);
      try {const r=await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,{signal:c.signal});if(r.ok){const j=await r.json();value={...value,name:String(j.city||j.locality||'Your location'),country:j.countryCode,region:[j.principalSubdivision,j.countryName].filter(Boolean).join(', ')};}}catch(_){}finally{clearTimeout(timeout);}
      if(id===lookupVersion)select(value);
    },failed,{enableHighAccuracy:false,timeout:12000,maximumAge:300000});}catch(_){failed();}
  }
  document.querySelectorAll('[data-tide-city]').forEach(b=>b.addEventListener('click',()=>select({...cities[b.dataset.tideCity],country:'CA',region:'British Columbia, Canada',timezone:'America/Vancouver'},b.dataset.tideCity)));
  $('tideSearch').addEventListener('submit',search);$('locateTides').addEventListener('click',locate);$('refreshTides').addEventListener('click',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && Date.now()-loadedAt>900000)refresh();});
  setInterval(()=>{if(!document.hidden && data){if(Date.now()-loadedAt>900000)refresh();else render();}},60000);
  window.addEventListener?.('resize',()=>{if(data && selectedDay)renderChart(selectedDay);});
  const linked=core.locationFromURL(window.location?.href);
  select(linked || {...cities.vancouver,country:'CA',region:'British Columbia, Canada',timezone:'America/Vancouver'},linked?Object.keys(cities).find(key=>cities[key].latitude===linked.latitude && cities[key].longitude===linked.longitude):'vancouver');
})();
