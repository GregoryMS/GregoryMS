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
  function zonedTime(key,timezone,hour=0) {
    const target=Date.parse(key+'T'+String(hour).padStart(2,'0')+':00:00Z');let value=target;
    const format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    for(let i=0;i<2;i++) {
      const parts=Object.fromEntries(format.formatToParts(value).map(p=>[p.type,p.value]));
      value+=target-Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    }
    return new Date(value);
  }
  function zonedNoon(key,timezone) {return zonedTime(key,timezone,12);}
  const lightKinds=[['night','Night'],['twilight','Twilight'],['blue','Blue hour'],['golden','Golden hour'],['daylight','Daylight']];
  function solarTimeline(sun,place,key,timezone) {
    const start=zonedTime(key,timezone).getTime(),end=zonedTime(addDay(key,1),timezone).getTime();
    const classify=timestamp=>{
      const altitude=sun.getPosition(new Date(timestamp),place.latitude,place.longitude).altitude*180/Math.PI;
      if(!Number.isFinite(altitude)) throw Error('Sun position unavailable');
      return altitude < -18?0:altitude < -6?1:altitude < -4?2:altitude < 6?3:4;
    };
    const boundaries=new Set([start,end]),segments=[];
    // Include neighbouring solar days for places whose light windows cross local midnight.
    for(const offset of [-1,0,1]) {
      const {times}=lightWindows(sun,place,addDay(key,offset),timezone);
      for(const name of ['nightEnd','dawn','photoMorningStart','goldenHourEnd','goldenHour','photoEveningEnd','dusk','night']) {
        const value=times[name]?.getTime();
        if(Number.isFinite(value)&&value>start&&value<end)boundaries.add(value);
      }
    }
    const ordered=[...boundaries].sort((a,b)=>a-b);
    for(let i=0;i<ordered.length-1;i++) {
      const from=ordered[i],until=ordered[i+1],[kind,label]=lightKinds[classify((from+until)/2)];
      const previous=segments.at(-1);
      if(previous?.kind===kind) {previous.end=until;previous.width=(until-previous.start)/(end-start)*100;}
      else segments.push({kind,label,start:from,end:until,left:(from-start)/(end-start)*100,width:(until-from)/(end-start)*100});
    }
    const ticks=[0,6,12,18].map(hour=>({timestamp:zonedTime(key,timezone,hour).getTime(),label:hour===0?'12 am':hour===6?'6 am':hour===12?'12 pm':'6 pm'}));
    ticks.push({timestamp:end,label:'12 am'});
    return {start,end,segments,ticks};
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
    const $=id=>win.document.getElementById(id);let place=null,forecast=null,timezone=null,selected=null,today=null,timelineView=null;
    function node(tag,cls,text) {const el=win.document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;}
    function renderTimeline(times,windows,now,next,time) {
      const key=[place.latitude,place.longitude,selected,timezone].join('|');
      if(timelineView?.key!==key) {
        const timeline=solarTimeline(win.SunCalc,place,selected,timezone),span=timeline.end-timeline.start;
        const panel=node('div','photo-timeline-panel');
        const heading=node('div','photo-timeline-heading');heading.append(node('h3','','Light through the day'),node('span','',`${span/3600000} hours · local time`));
        const legend=node('div','photo-legend');
        for(const [kind,label] of [...lightKinds].reverse()) {const item=node('span','');item.append(node('i','photo-swatch photo-light--'+kind),node('span','',label));legend.append(item);}
        const chart=node('div','photo-timeline-chart'),track=node('div','photo-timeline-track');track.setAttribute('role','group');track.setAttribute('aria-label','Light phases from midnight to midnight; choose a phase for its times');
        const selection=node('div','photo-timeline-selection');selection.setAttribute('aria-live','polite');
        const marker=node('div','photo-now');marker.append(node('span','','Now'));marker.setAttribute('aria-hidden','true');
        const phaseButtons=[],windowButtons=[];
        let chosen=null,manual=false;
        function selectPhase(segment,byUser=false) {
          if(!segment)return;
          chosen=segment;manual=byUser;
          const midpoint=(segment.start+segment.end)/2;
          const window=windows.find(w=>w.start!==null&&w.end!==null&&midpoint>=w.start&&midpoint<w.end);
          selection.replaceChildren(node('span','photo-selection-kind photo-light--'+segment.kind,window?.label || segment.label),node('strong','',`${time(segment.start)} – ${time(segment.end)}`),node('span','photo-selection-duration',`${Math.round((segment.end-segment.start)/60000)} min`));
          phaseButtons.forEach(({button,value})=>button.setAttribute('aria-pressed',String(value===segment)));
          windowButtons.forEach(({button,value})=>button.setAttribute('aria-pressed',String(value===window)));
        }
        for(const segment of timeline.segments) {
          const button=node('button','photo-phase photo-light--'+segment.kind);button.type='button';
          button.style.left=segment.left+'%';button.style.width=segment.width+'%';
          const label=`${segment.label}: ${time(segment.start)} to ${segment.end===timeline.end?'midnight':time(segment.end)}`;
          button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed','false');
          button.addEventListener('click',()=>selectPhase(segment,true));
          button.addEventListener('focus',()=>selectPhase(segment,true));
          phaseButtons.push({button,value:segment});track.append(button);
        }
        const axis=node('div','photo-timeline-axis');
        for(const tick of timeline.ticks) {const label=node('span','',tick.label);label.style.left=(tick.timestamp-timeline.start)/span*100+'%';axis.append(label);}
        chart.append(track,marker,axis);
        const labels=node('div','photo-window-labels');labels.setAttribute('role','group');labels.setAttribute('aria-label','Photography windows; select to highlight on the timeline');
        for(const [kind,title] of [['blue','Blue hours'],['golden','Golden hours']]) {
          const group=node('div','photo-window-group');group.setAttribute('role','group');group.setAttribute('aria-label',title);
          group.append(node('h4','photo-window-group-title photo-light--'+kind,title));
          for(const window of windows.filter(window=>window.kind===kind)) {
            const button=node('button','photo-window-label');button.type='button';button.setAttribute('aria-pressed','false');
            const valid=window.start!==null&&window.end!==null;
            button.disabled=!valid;
            button.append(node('i','photo-swatch photo-light--'+window.kind),node('span','photo-window-name',window.id.startsWith('morning-')?'Morning':'Evening'),node('span','photo-window-time',valid?`${time(window.start)} – ${time(window.end)}`:'No window on this day'));
            button.addEventListener('click',()=>selectPhase(timeline.segments.find(s=>s.kind===window.kind&&(s.start+s.end)/2>=window.start&&(s.start+s.end)/2<window.end),true));
            windowButtons.push({button,value:window});group.append(button);
          }
          labels.append(group);
        }
        panel.append(heading,legend,chart,selection,labels);$('photoWindows').replaceChildren(panel);
        timelineView={key,update(current,upcoming){
          marker.hidden=current<timeline.start||current>=timeline.end;
          marker.style.left=(current-timeline.start)/span*100+'%';
          if(!manual) {
            const target=upcoming?timeline.segments.find(s=>s.kind===upcoming.kind&&(s.start+s.end)/2>=upcoming.start&&(s.start+s.end)/2<upcoming.end):timeline.segments.find(s=>current>=s.start&&current<s.end);
            selectPhase(target || chosen || timeline.segments[0]);
          }
        }};
      }
      timelineView.update(now,next);
    }
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
        renderTimeline(times,windows,now,next,time);
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
    return {setLocation(value){place=value;forecast=null;timezone=value.timezone || null;today=null;timelineView=null;$('photoWindows').replaceChildren();$('photoSun').replaceChildren();$('photoWeather').replaceChildren();render();},
      setForecast(data){forecast=data;if(data?.timezone)timezone=data.timezone;render();}};
  }
  return {dateKey,addDay,zonedNoon,solarTimeline,lightWindows,nearbyWeather,createController};
});
