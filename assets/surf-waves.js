(function(root) {
  'use strict';
  function embedURL(location) {
    if(!Number.isFinite(location?.latitude) || Math.abs(location.latitude)>90 || !Number.isFinite(location?.longitude) || Math.abs(location.longitude)>180)throw Error('Invalid location');
    return 'https://embed.windy.com/embed.html?'+new URLSearchParams({
      type:'map',location:'coordinates',metricRain:'mm',metricTemp:'°C',metricWind:'km/h',metricWaves:'m',
      zoom:'7',overlay:'waves',product:'ecmwfWaves',level:'surface',
      lat:String(location.latitude),lon:String(location.longitude),message:'true'
    });
  }
  if(typeof module!=='undefined' && module.exports){module.exports={embedURL};return;}
  const $=id=>document.getElementById(id),status=$('surfWavesStatus');
  let location=null,frame=null,timer=null,version=0,visible=false;
  function unload() {
    version++;clearTimeout(timer);timer=null;
    if(frame){frame.remove();frame=null;}
  }
  function load() {
    unload();
    if(!location || !visible)return;
    const token=version;
    status.hidden=false;status.textContent='Loading waves forecast…';
    frame=document.createElement('iframe');
    frame.title=`Windy waves forecast for ${location.name || 'the selected location'}`;
    frame.className='radar-windy-frame';
    frame.referrerPolicy='strict-origin-when-cross-origin';
    // A cross-origin load confirms the document, not the availability of wave tiles.
    frame.addEventListener('load',()=>{if(token===version){clearTimeout(timer);status.hidden=true;}});
    frame.addEventListener('error',()=>{if(token===version){clearTimeout(timer);status.hidden=false;status.textContent='Map could not load. Try Refresh or open the full map.';}});
    timer=setTimeout(()=>{if(token===version){status.hidden=false;status.textContent='Map taking a while? Try Refresh or open the full map.';}},20000);
    frame.src=embedURL(location);
    $('surfWavesMap').replaceChildren(frame);
  }
  root.GregleSurfWaves={setLocation(value){
    const url=embedURL(value);
    const changed=location?.latitude!==value.latitude || location?.longitude!==value.longitude || location?.name!==value.name;
    location=value;
    $('surfWavesLocation').textContent='Wave forecasts around '+(value.name || 'your selected location');
    $('surfWavesLink').href=url;
    $('surfWavesRecenter').disabled=false;$('surfWavesRefresh').disabled=false;
    if(changed)load();
  }};
  for(const id of ['surfWavesRecenter','surfWavesRefresh'])$(id).addEventListener('click',()=>{visible=true;load();});
  if(typeof IntersectionObserver==='function') {
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){visible=true;observer.disconnect();load();}
    },{rootMargin:'200px'});
    observer.observe($('surfWavesSection'));
  } else visible=true;
  root.addEventListener('pagehide',unload);
  root.addEventListener('pageshow',event=>{if(event.persisted)load();});
})(globalThis);
