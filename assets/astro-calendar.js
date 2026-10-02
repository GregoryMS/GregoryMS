(() => {
  'use strict';
  const C = window.GregleAstroEvents, $ = id => document.getElementById(id);
  if (!$('astro-calendar') || !C) return;
  let zone = 'America/Vancouver', month = C.dateKey(Date.now(), zone).slice(0,7), selectedDay = null;
  let events = [], version = 0, downloadURL, dialogURL;
  const cache = new Map();
  const fallback = fetch('data/astro-events.json').then(r => { if (!r.ok) throw Error(); return r.json(); }).catch(() => null);
  function el(tag, text, className) {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
    if (className) node.className = className; return node;
  }
  const dateLabel = key => new Intl.DateTimeFormat('en', {dateStyle:'long',timeZone:'UTC'}).format(new Date(key + 'T12:00:00Z'));
  function eventLabel(event) {
    if (event.allDay) return dateLabel(event.start) + '–' + dateLabel(new Date(new Date(event.end+'T00:00:00Z').getTime()-C.DAY).toISOString().slice(0,10)) + ' · approximate peak night';
    return new Intl.DateTimeFormat('en', {timeZone:zone,year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(event.start));
  }
  async function remote(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try { const response = await fetch(url, {signal:controller.signal}); if (!response.ok) throw Error(); return await response.json(); }
    finally { clearTimeout(timer); }
  }
  async function yearEvents(year) {
    if (!cache.has(year)) cache.set(year, (async () => {
      try {
        const [moon, seasons] = await Promise.all([remote('https://aa.usno.navy.mil/api/moon/phases/year?year='+year),remote('https://aa.usno.navy.mil/api/seasons?year='+year+'&tz=0')]);
        return {events:C.parseYear(moon,seasons,year), saved:false};
      } catch (_) {
        const saved = (await fallback)?.years?.[year];
        if (saved) return {events:C.parseYear(saved.moon,saved.seasons,year), saved:true};
        cache.delete(year); return {events:[],missing:true};
      }
    })());
    return cache.get(year);
  }
  function monthlyEvents() { return events.filter(e => C.eventDate(e,zone).startsWith(month)); }
  function makeDownload(link, items, filename, previous) {
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(new Blob([C.ical(items)], {type:'text/calendar;charset=utf-8'}));
    link.href = url; link.download = filename; return url;
  }
  function showEvent(event) {
    $('event-kind').textContent = event.kind;
    $('event-title').textContent = event.title;
    $('event-time').textContent = eventLabel(event);
    $('event-description').textContent = event.description;
    $('event-timing').textContent = event.timing;
    $('event-source').textContent = event.sourceName; $('event-source').href = event.source;
    $('event-google').href = C.googleURL(event);
    dialogURL = makeDownload($('event-ical'),[event],event.id+'.ics',dialogURL);
    $('event-dialog').showModal();
  }
  function renderList() {
    const list = $('calendar-events'), monthly = monthlyEvents();
    const shown = selectedDay ? monthly.filter(e => C.eventDate(e,zone) === selectedDay) : monthly;
    $('calendar-list-heading').textContent = selectedDay ? dateLabel(selectedDay) : 'This month';
    $('calendar-show-all').hidden = !selectedDay;
    list.replaceChildren();
    if (!shown.length) list.append(el('li','No listed events for this date. Choose another day or show the whole month.','calendar-empty'));
    for (const event of shown) {
      const li = el('li'), button = el('button', undefined, 'calendar-event'); button.type = 'button';
      const time = el('time', C.eventDate(event,zone).slice(8)); time.dateTime = C.eventDate(event,zone);
      const copy = el('span'), title = el('strong',event.title), meta = el('span',event.allDay ? 'Meteors · approximate peak night' : event.kind + ' · ' + new Intl.DateTimeFormat('en',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(event.start)), 'calendar-meta');
      copy.append(title, meta); button.append(time,copy,el('span','Details','calendar-detail-label'));
      button.addEventListener('click',() => showEvent(event)); li.append(button); list.append(li);
    }
  }
  function render() {
    const [year,m] = month.split('-').map(Number), start = new Date(Date.UTC(year,m-1,1));
    $('calendar-month').textContent = new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(start);
    $('calendar-zone').textContent = 'Times in ' + zone + '. Select a marked date or an event for details.';
    $('calendar-prev').disabled = month === '1700-01'; $('calendar-next').disabled = month === '2100-12';
    const grid = $('calendar-grid'); grid.replaceChildren();
    for (const weekday of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']) grid.append(el('div',weekday,'calendar-weekday'));
    for (let i=0;i<start.getUTCDay();i++) { const blank=el('div'); blank.setAttribute('aria-hidden','true'); grid.append(blank); }
    const monthly = monthlyEvents(), today = C.dateKey(Date.now(),zone);
    for (let day=1;day<=new Date(Date.UTC(year,m,0)).getUTCDate();day++) {
      const key = month+'-'+String(day).padStart(2,'0'), daily=monthly.filter(e=>C.eventDate(e,zone)===key);
      const button=el('button',undefined,'calendar-day'); button.type='button';
      button.append(el('span',String(day)));
      button.setAttribute('aria-label',dateLabel(key)+(daily.length ? ': '+daily.map(e=>e.title).join(', ') : ': no listed events'));
      button.setAttribute('aria-pressed',String(selectedDay===key));
      if (key===today) button.setAttribute('aria-current','date');
      if (daily.length) { const mark=el('span',daily.length+' '+(daily.length===1?'event':'events'),'calendar-count'); mark.setAttribute('aria-hidden','true'); button.append(mark); button.classList.add('has-events'); }
      button.addEventListener('click',()=>{selectedDay=key; for(const b of grid.querySelectorAll('button')) b.setAttribute('aria-pressed',String(b===button)); renderList();});
      grid.append(button);
    }
    renderList();
    $('calendar-export').hidden = !monthly.length;
    downloadURL = makeDownload($('calendar-export'),monthly,'gregle-astronomy-'+month+'.ics',downloadURL);
  }
  async function loadMonth() {
    const current = ++version, year=Number(month.slice(0,4)), m=Number(month.slice(5)), years=[year];
    if (m===1 && year>1700) years.push(year-1);
    if (m===12 && year<2100) years.push(year+1);
    selectedDay=null; events=C.meteorEvents(year); render();
    $('calendar-status').textContent='Loading Moon phases and seasons… Meteor peak nights are approximate annual dates.';
    $('calendar-retry').hidden=true;
    const results=await Promise.all(years.map(yearEvents));
    if(current!==version) return;
    events=[...C.meteorEvents(year),...results.flatMap(r=>r.events)].sort((a,b)=>a.start.localeCompare(b.start));
    const missing=results.some(r=>r.missing), saved=results.some(r=>r.saved);
    $('calendar-status').textContent=(missing?'Some Moon or seasonal dates are unavailable. Showing available events.':saved?'Moon phases and seasons: saved USNO dates (checked 2 Oct 2026).':'Moon phases and seasons: US Naval Observatory.')+' Meteor peak nights are approximate annual dates; check the source for year-specific predictions. Visibility depends on location and conditions.';
    $('calendar-retry').hidden=!missing; render();
  }
  function changeMonth(offset) {
    const [y,m]=month.split('-').map(Number); month=new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7); loadMonth();
  }
  $('calendar-prev').addEventListener('click',()=>changeMonth(-1));
  $('calendar-next').addEventListener('click',()=>changeMonth(1));
  $('calendar-today').addEventListener('click',()=>{month=C.dateKey(Date.now(),zone).slice(0,7);loadMonth();});
  $('calendar-show-all').addEventListener('click',()=>{selectedDay=null;render();});
  $('calendar-retry').addEventListener('click',()=>{cache.clear();loadMonth();});
  $('event-close').addEventListener('click',()=>$('event-dialog').close());
  $('event-dialog').addEventListener('close',()=>{if(dialogURL) URL.revokeObjectURL(dialogURL);dialogURL=null;});
  window.GregleAstroCalendar={setTimezone(next){
    try {new Intl.DateTimeFormat('en',{timeZone:next});} catch(_){return;}
    if(next!==zone){zone=next;selectedDay=null;render();}
  }};
  loadMonth();
})();
