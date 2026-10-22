(function(root) {
  'use strict';
  const core=root.GregleTides;
  function node(tag,className,text) { const n=document.createElement(tag); if(className)n.className=className; if(text!==undefined)n.textContent=text; return n; }
  const time=(value,zone,hourCycle)=>new Date(value).toLocaleTimeString('en-CA',{timeZone:zone,hour:hourCycle?'2-digit':'numeric',minute:'2-digit',...(hourCycle?{hourCycle}:{})});
  const height=value=>Number.isFinite(value)?value.toFixed(2)+' m':'—';
  function eventsList(events,data,hourCycle) {
    const list=node('div','tide-events');
    for(const e of events) {
      const item=node('div','tide-event');
      item.append(node('span','tide-direction',e.type==='High'?'↟':'↡'),node('span','tide-type',e.type+' tide'),node('strong','tide-time',(data.model?'≈ ':'')+time(e.time,data.timezone,hourCycle)),node('span','tide-height',height(e.height)));
      list.append(item);
    }
    if(!events.length) list.append(node('p','location-note','No high or low tide times are available for this day.'));
    return list;
  }
  function summary(host,data,now=Date.now(),hourCycle) {
    host.replaceChildren();
    if(!data) { host.append(node('p','location-note','No nearby tide data is available. Search for a coastal location.')); return; }
    host.append(node('p','location-note',data.station));
    host.append(eventsList(data.events.filter(e=>core.dayKey(e.time,data.timezone)===core.dayKey(now,data.timezone)),data,hourCycle));
    host.append(node('p','details',`${data.model?'Estimated tides':'Predicted tides'} · ${data.datum} · Times in ${data.timezone.replaceAll('_',' ')}`));
  }
  let previewController=null,previewVersion=0,previewLocation=null,previewUpdated=0;
  async function weatherPreview(location) {
    const link=document.getElementById('tidePreview'),host=document.getElementById('tidePreviewContent'),shortcut=document.getElementById('tideLink');
    if(!link || !host) return;
    previewLocation=location;previewUpdated=Date.now();
    const url=core.locationURL('https://tides.gregle.uk/',location);link.href=url;if(shortcut)shortcut.href=url;
    previewController?.abort(); const controller=new AbortController();previewController=controller;const version=++previewVersion;
    host.replaceChildren(node('p','location-note','Loading today’s tides…'));link.setAttribute('aria-busy','true');
    try { const data=await root.GregleTideData.load(location,controller.signal);if(version===previewVersion)summary(host,data,Date.now(),'h23'); }
    catch(_) { if(version===previewVersion)host.replaceChildren(node('p','location-note','Tide data is temporarily unavailable. Open the tide tracker to try again.')); }
    finally { if(version===previewVersion)link.setAttribute('aria-busy','false'); }
  }
  function refreshPreview() { if(previewLocation && !document.hidden && Date.now()-previewUpdated>=900000) weatherPreview(previewLocation); }
  document.addEventListener('visibilitychange',refreshPreview);
  setInterval(refreshPreview,60000);
  root.GregleTideUI={node,time,height,eventsList,summary,weatherPreview};
})(globalThis);
