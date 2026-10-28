(function(root) {
  'use strict';
  function embedURL(layer,location) {
    if(!['wind','clouds','fog','satellite'].includes(layer))throw Error('Unknown weather layer');
    if(!Number.isFinite(location?.latitude) || Math.abs(location.latitude)>90 || !Number.isFinite(location?.longitude) || Math.abs(location.longitude)>180)throw Error('Invalid location');
    if(layer==='satellite')return `https://zoom.earth/maps/satellite/#view=${location.latitude},${location.longitude},7z`;
    return 'https://embed.windy.com/embed.html?'+new URLSearchParams({
      type:'map',location:'coordinates',metricRain:'mm',metricTemp:'°C',metricWind:'km/h',
      zoom:'7',overlay:layer,product:'ecmwf',level:'surface',
      lat:String(location.latitude),lon:String(location.longitude),message:'true'
    });
  }
  if(typeof module!=='undefined' && module.exports){module.exports={embedURL};return;}
  const $=id=>document.getElementById(id);
  let selected='radar',location=null,frame=null,timer=null,version=0,ready=false;
  function unload() {
    version++;clearTimeout(timer);timer=null;
    if(frame){frame.remove();frame=null;}
  }
  function load() {
    unload();
    if(selected==='radar' || selected==='smoke' || selected==='ptype' || !location)return;
    const token=version,layer=selected;
    const status=$('radarLayerStatus');
    status.hidden=false;status.textContent=`Loading ${layer} map…`;
    frame=document.createElement('iframe');
    frame.title=`${layer==='satellite'?'Zoom Earth satellite imagery':`Windy ${layer} forecast`} for ${location.name || 'the selected location'}`;
    frame.className='radar-windy-frame';
    frame.referrerPolicy='strict-origin-when-cross-origin';
    // Cross-origin onload confirms only the document, not weather tile availability.
    frame.addEventListener('load',()=>{if(token===version){clearTimeout(timer);status.hidden=true;}});
    frame.addEventListener('error',()=>{if(token===version){clearTimeout(timer);status.hidden=false;status.textContent='Map could not load. Try Refresh or open the full map.';}});
    timer=setTimeout(()=>{if(token===version){status.hidden=false;status.textContent='Map taking a while? Try Refresh or open the full map.';}},20000);
    frame.src=embedURL(layer,location);
    $('radarWindyLink').previousElementSibling.textContent=layer==='satellite'?'Satellite · Zoom Earth':'Forecast · Windy / ECMWF';
    $('radarForecastMap').replaceChildren(frame);
    $('radarWindyLink').href=frame.src;
  }
  function select(layer) {
    selected=layer;
    const radar=layer==='radar';
    for(const name of ['radar','ptype','wind','clouds','smoke','fog','satellite'])$(`radarLayer-${name}`).checked=name===layer;
    $('radarObserved').hidden=!radar;
    $('radarForecast').hidden=radar || layer==='smoke' || layer==='ptype';
    $('radarSmoke').hidden=layer!=='smoke';
    $('radarPrecipType').hidden=layer!=='ptype';
    root.GreglePrecipType?.setActive(layer==='ptype');
    root.GregleSmoke?.setActive(layer==='smoke');
    root.GregleLightning?.setActive(radar);
    $('radarMode').textContent=radar?'Observed precipitation':layer==='ptype'?'Surface precipitation type · Environment Canada':layer==='smoke'?'Wildfire smoke forecast · PM₂.₅':layer==='wind'?'Wind forecast · km/h':layer==='fog'?'Fog forecast':layer==='satellite'?'Satellite · Zoom Earth':'Clouds & rain forecast';
    if(!radar)root.GregleRadar?.pause();
    else root.GregleRadar?.resumeView();
    load();
  }
  root.GregleWeatherLayers={
    active:()=>selected!=='radar',
    refresh:()=>{if(ready)load();},
    setLocation(value){
      const changed=location?.latitude!==value.latitude || location?.longitude!==value.longitude || location?.name!==value.name;
      location=value;root.GreglePrecipType?.setLocation(value);root.GregleSmoke?.setLocation(value);if(ready && changed)load();
    }
  };
  document.addEventListener('DOMContentLoaded',()=>{
    ready=true;
    for(const name of ['radar','ptype','wind','clouds','smoke','fog','satellite']) {
      const input=$(`radarLayer-${name}`);input.disabled=false;
      input.addEventListener('change',()=>{if(input.checked)select(name);});
    }
    $('radarForecastRefresh').addEventListener('click',load);
    $('radarForecastRecenter').addEventListener('click',load);
    // Reset restored form state to match the initial visible panel.
    select('radar');
  });
  root.addEventListener('pagehide',unload);
  root.addEventListener('pageshow',event=>{if(event.persisted && ready)load();});
})(globalThis);

