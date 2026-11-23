(function(root) {
  'use strict';
  function embedURL(layer,location) {
    if(!['wind','clouds','fog','satellite'].includes(layer))throw Error('Unknown weather layer');
    if(!Number.isFinite(location?.latitude) || Math.abs(location.latitude)>90 || !Number.isFinite(location?.longitude) || Math.abs(location.longitude)>180)throw Error('Invalid location');
    if(layer==='satellite')return 'https://experience.arcgis.com/experience/8722bebcba3e42abbcc3aed13f935ab1?header=false&cover=false';
    return 'https://embed.windy.com/embed.html?'+new URLSearchParams({
      type:'map',location:'coordinates',metricRain:'mm',metricTemp:'°C',metricWind:'km/h',
      zoom:'7',overlay:layer,product:'ecmwf',level:'surface',
      lat:String(location.latitude),lon:String(location.longitude),message:'true'
    });
  }
  if(typeof module!=='undefined' && module.exports){module.exports={embedURL};return;}
  const $=id=>document.getElementById(id);
  const layerNames=['radar','ptype','satellite','wind','clouds','smoke','fog'];
  let selected='radar',location=null,frame=null,timer=null,version=0,ready=false;
  let placeTools=()=>{};
  function setupFullscreen() {
    const viewport=$('weatherMapViewport'), dialog=$('weatherMapFullscreenDialog');
    if(!viewport || !dialog || (!viewport.requestFullscreen && !dialog.showModal))return;
    const tools=$('weatherMapTools'), toggle=$('weatherMapFullscreenToggle');
    const picker=$('weatherMapPicker'), pickerToggle=$('weatherMapPickerToggle');
    const layerSwitches=$('weatherLayerSwitches'), overlaySwitches=$('radarOverlaySwitches');
    const inlineControls=[layerSwitches,overlaySwitches,$('radarHDControls')].map(element=>({
      element,parent:element.parentElement,next:element.nextElementSibling
    }));
    const icon=toggle.querySelector('path'), enterPath=icon.getAttribute('d');
    tools.hidden=false;
    placeTools=()=>{
      if(!viewport.classList.contains('is-fullscreen')){
        const panel=viewport.querySelector('.weather-map-layer:not([hidden]) > .radar-panel');
        if(tools.parentElement!==panel)panel.append(tools);
      }
    };
    let requesting=false;
    function setPickerOpen(open) {
      picker.hidden=!open;
      pickerToggle.setAttribute('aria-expanded',String(open));
    }
    function syncFullscreen() {
      const active=document.fullscreenElement===viewport || dialog.open;
      if(viewport.classList.contains('is-fullscreen')===active)return;
      viewport.classList.toggle('is-fullscreen',active);
      const label=active?'Exit full screen':'Full screen';
      toggle.title=label;
      toggle.setAttribute('aria-label',label);
      icon.setAttribute('d',active?'M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6':enterPath);
      pickerToggle.hidden=!active;
      if(active) {
        viewport.append(tools);
        for(const {element} of inlineControls)picker.append(element);
      } else {
        setPickerOpen(false);
        for(const {element,parent,next} of inlineControls)parent.insertBefore(element,next);
        placeTools();
      }
      toggle.focus({preventScroll:true});
    }
    pickerToggle.addEventListener('click',()=>setPickerOpen(picker.hidden));
    picker.addEventListener('change',event=>{
      if(!layerSwitches.contains(event.target) && selected!=='radar')select('radar');
    });
    document.addEventListener('pointerdown',event=>{
      if(!picker.hidden && !tools.contains(event.target))setPickerOpen(false);
    });
    tools.addEventListener('keydown',event=>{
      if(event.key!=='Escape' || picker.hidden)return;
      event.preventDefault();
      setPickerOpen(false);
      pickerToggle.focus({preventScroll:true});
    });
    document.addEventListener('fullscreenchange',syncFullscreen);
    dialog.addEventListener('close',()=>{
      dialog.before(viewport);
      syncFullscreen();
    });
    toggle.addEventListener('click',async ()=>{
      if(requesting)return;
      if(dialog.open){dialog.close();return;}
      if(document.fullscreenElement===viewport){
        await document.exitFullscreen();
        return;
      }
      if(document.fullscreenEnabled && viewport.requestFullscreen){
        requesting=true;
        try {await viewport.requestFullscreen();return;}
        catch(_) {} // Browsers without element fullscreen can use an in-page dialog.
        finally {requesting=false;}
      }
      if(!dialog.showModal)return;
      dialog.append(viewport);
      dialog.showModal();
      syncFullscreen();
    });
  }
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
    frame.title=`${layer==='satellite'?'NOAA live satellite imagery':`Windy ${layer} forecast`} for ${location.name || 'the selected location'}`;
    frame.className='radar-windy-frame';
    frame.referrerPolicy='strict-origin-when-cross-origin';
    // Cross-origin onload confirms only the document, not weather tile availability.
    frame.addEventListener('load',()=>{if(token===version){clearTimeout(timer);status.hidden=true;}});
    frame.addEventListener('error',()=>{if(token===version){clearTimeout(timer);status.hidden=false;status.textContent='Map could not load. Try Refresh or open the full map.';}});
    timer=setTimeout(()=>{if(token===version){status.hidden=false;status.textContent='Map taking a while? Try Refresh or open the full map.';}},20000);
    frame.src=embedURL(layer,location);
    $('radarWindyLink').previousElementSibling.textContent=layer==='satellite'?'Satellite · NOAA':'Forecast · Windy / ECMWF';
    $('radarForecastMap').replaceChildren(frame);
    $('radarWindyLink').href=frame.src;
  }
  function select(layer) {
    selected=layer;
    const radar=layer==='radar';
    for(const name of layerNames)$(`radarLayer-${name}`).checked=name===layer;
    $('radarObserved').hidden=!radar;
    $('radarForecast').hidden=radar || layer==='smoke' || layer==='ptype';
    $('radarSmoke').hidden=layer!=='smoke';
    $('radarPrecipType').hidden=layer!=='ptype';
    placeTools();
    root.GreglePrecipType?.setActive(layer==='ptype');
    root.GregleSmoke?.setActive(layer==='smoke');
    root.GregleLightning?.setActive(radar);
    $('radarMode').textContent=radar?'Observed precipitation':layer==='ptype'?'Surface precipitation type · Environment Canada':layer==='smoke'?'Wildfire smoke forecast · PM₂.₅':layer==='wind'?'Wind forecast · km/h':layer==='fog'?'Fog forecast':layer==='satellite'?'Satellite · NOAA':'Clouds & rain forecast';
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
    for(const name of layerNames) {
      const input=$(`radarLayer-${name}`);input.disabled=false;
      input.addEventListener('change',()=>{if(input.checked)select(name);});
    }
    $('radarForecastRefresh').addEventListener('click',load);
    $('radarForecastRecenter').addEventListener('click',load);
    setupFullscreen();
    // Reset restored form state to match the initial visible panel.
    select('radar');
  });
  root.addEventListener('pagehide',unload);
  root.addEventListener('pageshow',event=>{if(event.persisted && ready)load();});
})(globalThis);

