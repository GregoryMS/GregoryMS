(function() {
  'use strict';
  const core=globalThis.GregleTides, ui=globalThis.GregleTideUI, weather=globalThis.GregleWeather, $=id=>document.getElementById(id);
  const weatherApp=core.isWeatherTides(window.location.href) || document.body?.hasAttribute?.('data-weather-app-tides');
  let location=null,data=null,selectedDay=null,controller=null,version=0,lookupVersion=0,lookupController=null,loadedAt=0,chartSelection=null,chartDragging=false;
  function cancelLookup() { lookupVersion++;lookupController?.abort();$('tideSearchButton').disabled=false;$('locateTides').disabled=false; }
  function dayLabel(day) { return new Date(day+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}); }
  function svgNode(tag,attributes,text) { const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))n.setAttribute(key,value);if(text!==undefined)n.textContent=text;return n; }
  function metric(label,value,detail) {
    const item=ui.node('div','tide-metric');
    item.append(ui.node('dt','range-label',label),ui.node('dd','range-value',value),ui.node('dd','tide-metric-detail',detail));return item;
  }
  function summaryMetrics(day) {
    const d=core.daySummary(data,day);
    return [metric('Highest tide',d.high?ui.height(d.high.height):'—',d.high?ui.time(d.high.time,data.timezone):'No high tide supplied'),
      metric('Lowest tide',d.low?ui.height(d.low.height):'—',d.low?ui.time(d.low.time,data.timezone):'No low tide supplied'),
      metric('Daily range',ui.height(d.range),d.range===null?'High and low needed':'Highest high to lowest low')];
  }
  function renderDetails(now,reading,next) {
    const today=core.dayKey(now,data.timezone),rate=core.rate(data.points,now);
    $('tideTodayMetrics').replaceChildren(...summaryMetrics(today),metric('Predicted change',rate===null?'—':(rate>0?'+':'')+rate.toFixed(2)+' m/h','Level change, not current speed'));
    $('tideCountdown').textContent=next?'In '+core.countdown(next.time,now):'';
    const previous=data.events.filter(e=>e.time<=now).at(-1);
    const cycle=reading && previous && next && next.time>previous.time;
    $('tideCycle').hidden=!cycle;
    if(cycle) {
      const percent=Math.max(0,Math.min(100,(now-previous.time)/(next.time-previous.time)*100));
      $('tidePrevious').textContent=previous.type+' · '+ui.time(previous.time,data.timezone);
      $('tideCycleNext').textContent=next.type+' · '+ui.time(next.time,data.timezone);
      $('tideCycleFill').style.width=percent+'%';
      $('tideCycleBar').setAttribute('aria-valuenow',String(Math.round(percent)));
      $('tideCycleBar').setAttribute('aria-valuetext',Math.round(percent)+'% of the time to the next '+next.type.toLowerCase()+' tide');
    }
    $('tideAbout').replaceChildren(ui.node('p','location-note',data.station),
      ui.node('p','location-note',data.model?'Hourly sea-level model. High and low times are approximate turning points in the forecast.':'Official station predictions. The current level is interpolated between forecast samples; it is not a live gauge observation.'),
      ui.node('p','location-note',data.datum+' · '+data.timezone.replaceAll('_',' ')),
      ui.node('p','location-note',data.note));
    const days=core.dayKeys(now,data.timezone);
    $('tideWeek').replaceChildren(...days.map((day,i)=>{
      const d=core.daySummary(data,day),card=ui.node('button','forecast-card tide-week-card');card.type='button';card.dataset.tideDay=day;card.setAttribute('aria-pressed',String(day===selectedDay));
      card.append(ui.node('strong','period',i===0?'Today':new Date(day+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',weekday:'short',day:'numeric'})));
      for(const [label,event] of [['High',d.high],['Low',d.low]]) {const row=ui.node('span','tide-week-row');row.append(ui.node('span','range-label',label),ui.node('strong','',event?ui.height(event.height):'—'),ui.node('small','',event?ui.time(event.time,data.timezone):'Unavailable'));card.append(row);}
      card.append(ui.node('span','tide-week-range',d.range===null?'Range unavailable':ui.height(d.range)+' range'));
      card.addEventListener('click',()=>{renderDay(day);$('curveHeading').scrollIntoView?.({behavior:'smooth',block:'start'});});return card;
    }));
  }
  function renderChart(day) {
    const host=$('tideChart');host.replaceChildren();chartDragging=false;
    const points=data.points.filter(p=>core.dayKey(p.time,data.timezone)===day),valid=points.filter(p=>Number.isFinite(p.height));
    if(valid.length<2) {host.append(ui.node('p','location-note','The tide curve is unavailable for this day.'));return;}
    const first=points[0].time,last=points.at(-1).time;
    const min=Math.floor((Math.min(...valid.map(p=>p.height))-.15)*2)/2,max=Math.ceil((Math.max(...valid.map(p=>p.height))+.15)*2)/2;
    const width=Math.max(320,host.clientWidth || 900),right=width-32;
    const x=t=>58+(t-first)/(last-first)*(right-58),y=h=>220-(h-min)/(max-min)*180;
    const svg=svgNode('svg',{viewBox:`0 0 ${width} 268`,role:'slider',tabindex:'0','aria-labelledby':'chartTitle','aria-describedby':'chartDescription','aria-orientation':'horizontal','aria-valuemin':first,'aria-valuemax':last});
    svg.append(svgNode('title',{id:'chartTitle'},'Tide curve for '+dayLabel(day)),svgNode('desc',{id:'chartDescription'},`${data.datum}. ${data.model?'Hourly model estimates.':'Station predictions.'} Tap or drag to explore the curve. Use arrow keys to move one minute, Page Up or Page Down for one hour, and Home or End for the start or end. High and low tide times are listed below.`));
    for(let i=0;i<=3;i++) {const h=min+(max-min)*i/3;svg.append(svgNode('line',{x1:58,x2:right,y1:y(h),y2:y(h),class:'chart-grid'}),svgNode('text',{x:46,y:y(h)+4,'text-anchor':'end'},h.toFixed(1)+' m'));}
    let segments=[],segment=[];
    for(const p of points) {if(!Number.isFinite(p.height) || (segment.length && p.time-segment.at(-1).time>3600000)) {if(segment.length)segments.push(segment);segment=[];}if(Number.isFinite(p.height))segment.push(p);}
    if(segment.length)segments.push(segment);
    for(const s of segments) {
      svg.append(svgNode('polygon',{points:x(s[0].time)+',220 '+s.map(p=>x(p.time)+','+y(p.height)).join(' ')+' '+x(s.at(-1).time)+',220',class:'tide-area'}),svgNode('polyline',{points:s.map(p=>x(p.time)+','+y(p.height)).join(' '),class:'tide-curve'}));
    }
    for(const event of core.daySummary(data,day).events) {
      if(event.time<first||event.time>last)continue;
      const marker=svgNode('circle',{cx:x(event.time),cy:y(event.height),r:5,class:'tide-extreme'});
      marker.append(svgNode('title',{},event.type+' · '+ui.time(event.time,data.timezone)+' · '+ui.height(event.height)));svg.append(marker);
    }
    // Short 24-hour ticks with enough separation at narrow chart widths.
    let previousTick=-Infinity;
    for(const p of points) {
      const clock=ui.time(p.time,data.timezone,'h23'),tickX=x(p.time);
      if(/^(00|06|12|18):00$/.test(clock) && tickX-previousTick>=56) {
        svg.append(svgNode('text',{x:tickX,y:251,'text-anchor':'middle',class:'tide-axis-time'},clock));
        previousTick=tickX;
      }
    }
    const now=Date.now();if(now>=first && now<=last)svg.append(svgNode('line',{x1:x(now),x2:x(now),y1:28,y2:220,class:'chart-now'}),svgNode('text',{x:x(now),y:18,'text-anchor':'middle'},'Now'));
    const cursor=svgNode('line',{y1:28,y2:220,class:'tide-cursor'}),dot=svgNode('circle',{r:5,class:'tide-cursor-dot'});
    const label=svgNode('g',{class:'tide-chart-reading','aria-hidden':'true'});
    const box=svgNode('rect',{height:40,rx:8});
    const clock=svgNode('text',{x:9,y:16,class:'tide-chart-time'}),level=svgNode('text',{x:9,y:31,class:'tide-chart-height'});
    label.append(box,clock,level);svg.append(cursor,dot,label);host.append(svg);
    const inspect=time=>{
      chartSelection=Math.max(first,Math.min(last,time));
      const exact=points.find(p=>p.time===chartSelection);
      const height=exact?exact.height:core.current(points,chartSelection)?.height;
      const valid=Number.isFinite(height),cx=x(chartSelection),cy=valid?y(height):220;
      const timeText=ui.time(chartSelection,data.timezone),heightText=valid?(data.model?'≈ ':'')+ui.height(height):'Level unavailable';
      clock.textContent=timeText;level.textContent=heightText;
      const textWidth=Math.max(clock.getComputedTextLength?.() || timeText.length*7,level.getComputedTextLength?.() || heightText.length*6);
      const boxWidth=Math.min(right-58,Math.ceil(textWidth)+18);box.setAttribute('width',boxWidth);
      svg.setAttribute('aria-valuenow',String(chartSelection));svg.setAttribute('aria-valuetext',timeText+' · '+heightText);
      cursor.setAttribute('x1',cx);cursor.setAttribute('x2',cx);
      dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);dot.setAttribute('visibility',valid?'visible':'hidden');
      label.setAttribute('transform',`translate(${Math.max(58,Math.min(right-boxWidth,cx-boxWidth/2))},${cy<76?cy+12:cy-52})`);
    };
    inspect(chartSelection!==null&&chartSelection>=first&&chartSelection<=last?chartSelection:now>=first&&now<=last?now:(first+last)/2);
    const atPointer=event=>{
      const rect=svg.getBoundingClientRect();if(!rect.width)return;
      const position=Math.max(0,Math.min(1,((event.clientX-rect.left)/rect.width*width-58)/(right-58)));
      inspect(Math.round((first+position*(last-first))/60000)*60000);
    };
    let pointer=null;
    svg.addEventListener('pointerdown',event=>{
      if(event.isPrimary===false || (event.button!==undefined && event.button!==0))return;
      event.preventDefault();pointer=event.pointerId;chartDragging=true;
      svg.focus?.({preventScroll:true});svg.setPointerCapture?.(pointer);atPointer(event);
    });
    svg.addEventListener('pointermove',event=>{if(pointer===event.pointerId){event.preventDefault();atPointer(event);}});
    svg.addEventListener('pointerup',event=>{
      if(pointer!==event.pointerId)return;
      atPointer(event);pointer=null;chartDragging=false;
      if(svg.hasPointerCapture?.(event.pointerId))svg.releasePointerCapture(event.pointerId);
    });
    const cancel=()=>{pointer=null;chartDragging=false;};
    svg.addEventListener('pointercancel',cancel);svg.addEventListener('lostpointercapture',cancel);
    svg.addEventListener('click',atPointer);
    svg.addEventListener('keydown',event=>{
      const steps={ArrowLeft:-60000,ArrowDown:-60000,ArrowRight:60000,ArrowUp:60000,PageDown:-3600000,PageUp:3600000};
      if(event.key!=='Home'&&event.key!=='End'&&!Object.hasOwn(steps,event.key))return;
      event.preventDefault();inspect(event.key==='Home'?first:event.key==='End'?last:chartSelection+steps[event.key]);
    });
  }
  function renderDay(day) {
    if(selectedDay!==day)chartSelection=null;
    selectedDay=day;
    document.querySelectorAll('[data-tide-day]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tideDay===day)));
    $('tideDayTitle').textContent=dayLabel(day)+' · '+(data.model?'estimated tides':'highs & lows');
    $('tideDayEvents').replaceChildren(ui.eventsList(data.events.filter(e=>core.dayKey(e.time,data.timezone)===day),data));
    $('tideSelectedSummary').replaceChildren(...summaryMetrics(day));
    renderChart(day);
    globalThis.GregleSurfUI?.setDay(day,data.timezone);
  }
  function render() {
    const now=Date.now(),reading=core.current(data.points,now),next=data.events.find(e=>e.time>now);
    renderDetails(now,reading,next);
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
    globalThis.GregleSurfWaves?.setLocation(location);
    void globalThis.GregleSurfUI?.load(location,currentController.signal,selectedDay);
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
  function select(value) {
    if(!weather.coordinates(value.latitude,value.longitude))return;
    cancelLookup();location=value;selectedDay=null;
    $('tideCity').textContent=value.name;$('tideRegion').textContent=value.region || 'Coastal tide forecast';document.title=value.name+' tides · Gregle';
    $('weatherLink').href=core.locationURL(weatherApp?new URL('/',window.location.href).href:'https://weather.gregle.uk/',value);
    if(window.history?.replaceState) window.history.replaceState(null,'',core.locationURL(weatherApp?'/tides/':new URL(window.location.href).hostname === 'tides.gregle.uk' ? '/' : 'tides.html',value));
    $('tideResults').replaceChildren();$('tideLocationStatus').textContent='Showing tides for '+value.name+'.';
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
    } catch(_) {if(id===lookupVersion)$('tideLocationStatus').textContent='Location search is unavailable. Try again or use My location.';}
    finally {clearTimeout(timeout);if(id===lookupVersion)$('tideSearchButton').disabled=false;}
  }
  function locate() {
    cancelLookup();const id=lookupVersion;
    if(!navigator.geolocation){$('tideLocationStatus').textContent='Location is unavailable. Search for a coastal city.';return;}
    $('locateTides').disabled=true;$('tideLocationStatus').textContent='Finding your location…';
    const failed=()=>{if(id===lookupVersion){$('locateTides').disabled=false;$('tideLocationStatus').textContent='Location access is unavailable. Search for a coastal city.';}};
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
  $('tideSearch').addEventListener('submit',search);$('locateTides').addEventListener('click',locate);$('refreshTides').addEventListener('click',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && Date.now()-loadedAt>900000)refresh();});
  setInterval(()=>{if(!document.hidden && data){if(Date.now()-loadedAt>900000)refresh();else if(!chartDragging)render();}},60000);
  window.addEventListener?.('resize',()=>{if(data && selectedDay && !chartDragging)renderChart(selectedDay);});
  const linked=core.locationFromURL(window.location?.href);
  select(linked || {name:'Victoria',latitude:48.43,longitude:-123.36,country:'CA',region:'British Columbia, Canada',timezone:'America/Vancouver'});
})();

