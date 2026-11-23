(function(root) {
  'use strict';
  const ENDPOINT='https://api.rainviewer.com/public/weather-maps.json';
  function framesFrom(data) {
    const host=new URL(data?.host);
    if(host.protocol!=='https:' || !/(^|\.)rainviewer\.com$/.test(host.hostname) || host.port || host.username || host.password) throw Error('Invalid radar host');
    const frames=(Array.isArray(data?.radar?.past)?data.radar.past:[])
      .filter(f=>Number.isSafeInteger(f.time) && f.time>0 && /^\/v2\/radar\/[a-zA-Z0-9_-]+$/.test(f.path))
      .sort((a,b)=>a.time-b.time).filter((f,i,a)=>!i || f.time!==a[i-1].time).slice(-13);
    if(!frames.length) throw Error('No radar frames');
    return {host:host.origin,frames};
  }
  function tileURL(host,frame) { return `${host}${frame.path}/512/{z}/{x}/{y}/2/1_1.png`; }
  function stale(frame,now=Date.now()) { return !frame || now-frame.time*1000>30*60000; }
  const core={framesFrom,tileURL,stale};
  if(typeof module!=='undefined' && module.exports) { module.exports=core; return; }
  const $=id=>document.getElementById(id);
  let location=null,map=null,marker=null,frames=[],host='',layers=new Map(),current=-1,playing=false,fetching=false,lastFetch=0,started=false;
  let failed=false,baseFailed=false,imageFailed=false,buffering=false,playTimer=null,request=0;
  let hdEnabled=false,station='',displayedHD=false,displayedStation='',fetchVersion=0,refreshController=null,sourceFailed=false;
  let sites=[],siteRequest=null,stationsVisible=true;
  const validStation=id=>/^(?:[KP][A-Z0-9]{3}|CASAG|CASHP)$/.test(id);
  try {
    const saved=JSON.parse(root.localStorage?.getItem('gregle-weather-radar-hd') || 'null');
    if(root.GregleHighResRadar && saved?.enabled===true)hdEnabled=true;
    if(typeof saved?.station==='string' && validStation(saved.station))station=saved.station;
    if(saved?.stationsVisible===false)stationsVisible=false;
  } catch(_) {}
  function rememberMode() {
    try {root.localStorage?.setItem('gregle-weather-radar-hd',JSON.stringify({enabled:hdEnabled,station,stationsVisible}));}catch(_){}
  }
  function modeControls() {
    if(!$('radarHighResToggle'))return;
    $('radarHighResToggle').checked=hdEnabled;
    $('radarHDControls').hidden=!hdEnabled;
    $('radarStation').value=station;
    if($('radarStationsToggle'))$('radarStationsToggle').checked=stationsVisible;
    root.GregleRadarStations?.select(station);
    root.GregleRadarStations?.setVisible(hdEnabled && stationsVisible);
  }
  function sourceDetails() {
    if(!$('radarHDLegend'))return;
    $('radarStandardLegends').hidden=displayedHD;
    $('radarHDLegend').hidden=!displayedHD;
    $('radarStandardCredit').hidden=displayedHD;
    $('radarHDCredit').hidden=!displayedHD;
    if(displayedHD) {
      const source=root.GregleHighResRadar.sourceFor(displayedStation);
      const canadian=source.provider==='eccc';
      $('radarHDLegendImage').hidden=canadian;$('radarCanadaLegend').hidden=!canadian;
      $('radarHDLegendSummary').textContent=canadian?'Rainfall-rate colour key':'Reflectivity colour key';
      $('radarHDLegendTitle').textContent=canadian?'Rainfall rate · mm/h':'Reflectivity · dBZ';
      $('radarHDLegendDescription').textContent=canadian?' · Estimated precipitation from this Canadian station.':' · Stronger echoes generally indicate heavier precipitation.';
      if(!canadian)$('radarHDLegendImage').src=`${source.endpoint}?service=WMS&version=1.1.1&request=GetLegendGraphic&format=image/png&layer=${source.layer}`;
      $('radarHDCreditText').textContent=canadian?'Environment Canada station DPQPE rainfall-rate estimates at 1 km per source pixel, updated about every six minutes. Colours show a rain-equivalent estimate, including when precipitation may be snow. This is not Doppler velocity or raw super-resolution reflectivity. Range is up to 240 km; terrain, outages and source-image labels can leave gaps. Blank areas can mean dry weather or missing coverage.':'NOAA / NWS reflectivity observations. The MRMS mosaic combines US radar observations at 1 km resolution; individual US stations provide super-resolution base reflectivity. This mode does not classify rain and snow. The timeline uses published observation times from the past two hours. Coverage varies, especially outside the US and behind terrain; blank areas can mean no coverage or missing data. Standard radar remains available with High Res off.';
    }
    if(!root.GregleWeatherLayers?.active())$('radarMode').textContent=displayedHD?((displayedStation==='CASAG' || displayedStation==='CASHP')?`${displayedStation} · Rainfall rate · ECCC`:displayedStation?`${displayedStation} · High-resolution reflectivity`:'High-resolution reflectivity · NOAA MRMS'):'Observed precipitation';
  }
  async function loadStations() {
    if(sites.length || siteRequest || !hdEnabled)return;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    siteRequest=controller;
    try {
      const response=await fetch('assets/weather-radar-sites.json?v=20261119-canada1',{signal:controller.signal});
      if(!response.ok)throw Error('Station list unavailable');
      const data=await response.json();
      if(!Array.isArray(data))throw Error('Invalid stations');
      sites=data.filter(s=>validStation(s.id) && typeof s.name==='string' && Number.isFinite(s.lat) && Number.isFinite(s.lon));
      populateStations();
      root.GregleRadarStations?.setSites(sites);
      $('radarStationStatus').textContent='';
    } catch(_) {$('radarStationStatus').textContent='Station list unavailable. The US mosaic is still available; try Refresh.';}
    finally {clearTimeout(timeout);siteRequest=null;}
  }
  function populateStations() {
    if(!sites.length)return;
    const select=$('radarStation');
    while(select.options.length>1)select.remove(1);
    const sorted=[...sites].sort((a,b)=>location?root.GregleHighResRadar.distance(a,location)-root.GregleHighResRadar.distance(b,location):a.id.localeCompare(b.id));
    for(const site of sorted) {
      const option=document.createElement('option');option.value=site.id;
      option.textContent=`${site.id} · ${site.name}${location?' · '+Math.round(root.GregleHighResRadar.distance(site,location))+' km':''}`;
      select.append(option);
    }
    select.value=station;
  }
  function changeSource() {
    stop();lastFetch=0;sourceFailed=false;modeControls();rememberMode();loadStations();
    if(map)refresh(true);
  }
  function stop() {
    clearTimeout(playTimer);playTimer=null;playing=false;request++;buffering=false;
    $('radarPlay').textContent='▶ Play';$('radarPlay').setAttribute('aria-pressed','false');
  }
  function time(frame) {
    if(!frame)return '';
    let zone=location?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try { new Intl.DateTimeFormat('en',{timeZone:zone}); } catch(_) { zone='UTC'; }
    return new Date(frame.time*1000).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'2-digit',hourCycle:'h23',minute:'2-digit',timeZone:zone,timeZoneName:'short'});
  }
  function status() {
    $('radarStatus').textContent=sourceFailed?'The selected radar source is unavailable. Showing the previous source; try again.':
      failed?'Radar refresh failed. Showing the previous images; try Refresh.':
      baseFailed?'The background map could not fully load. Try Refresh.':
      imageFailed?'The next radar image could not load. Try Refresh.':
      buffering?'Loading radar image…':
      stale(frames.at(-1))?'Radar is delayed — the latest image is over 30 minutes old.':
      '';
  }
  function layerFor(frame) {
    let layer=layers.get(frame.path);
    if(layer)return layer;
    layer=frame.hd?root.GregleHighResRadar.createLayer(frame):root.L.tileLayer(tileURL(host,frame),{tileSize:512,zoomOffset:-1,maxNativeZoom:8,maxZoom:10,opacity:0,updateWhenIdle:true,keepBuffer:0,zIndex:300,attribution:'<a href="https://www.rainviewer.com/">RainViewer</a>'});
    // Load invisibly, then swap complete images in one turn. Prefetch only one
    // frame ahead during playback; cache viewed frames until the map moves.
    layer.radarReady=new Promise(resolve=>{
      let settled=false;
      const finish=ok=>{
        if(settled)return;
        settled=true;clearTimeout(timeout);resolve(ok);
      };
      const timeout=setTimeout(()=>finish(false),15000);
      layer.cancelRadar=()=>finish(false);
      layer.on('tileerror',()=>finish(false));
      layer.on('load',()=>finish(true));
    });
    layers.set(frame.path,layer);layer.addTo(map);
    return layer;
  }
  async function show(index) {
    if(!frames.length || !map)return false;
    const selected=Math.max(0,Math.min(frames.length-1,index)),token=++request;
    const frame=frames[selected],layer=layerFor(frame);
    buffering=true;imageFailed=false;status();
    if(current>=0)$('radarTime').value=String(current);
    const ready=await layer.radarReady;
    // Pause, scrubbing, refresh, or a map move can supersede a pending image.
    if(token!==request)return false;
    buffering=false;
    if(!ready) { imageFailed=true;stop();status();return false; }
    // Keep roads and place names visible through heavy precipitation.
    layer.setOpacity(root.GregleWeatherTransparency?.opacity() ?? 0.6);
    for(const other of layers.values())if(other!==layer)other.setOpacity(0);
    current=selected;
    $('radarTime').value=String(current);
    $('radarTime').setAttribute('aria-valuetext',time(frame));
    $('radarTimestamp').textContent=time(frame);
    root.GregleLightning?.setFrame(frame);
    $('radarStart').textContent=time(frames[0]);
    status();
    return true;
  }
  function clearLayers() {
    request++;buffering=false;imageFailed=false;
    for(const layer of layers.values()) { layer.cancelRadar();layer.off();map.removeLayer(layer); }
    layers.clear();
  }
  async function refresh(force=false) {
    if(root.GregleWeatherLayers?.active() || !map || (fetching && !force) || (!force && Date.now()-lastFetch<(hdEnabled?120000:300000)))return;
    refreshController?.abort();
    const version=++fetchVersion,wantedHD=hdEnabled,wantedStation=station;
    const changingSource=wantedHD!==displayedHD || (wantedHD && wantedStation!==displayedStation);
    const previousTime=frames[current]?.time,wasLatest=current===frames.length-1;
    stop();fetching=true;$('radarRefresh').disabled=true;
    $('radarPlay').disabled=true;$('radarTime').disabled=true;
    $('radarStatus').textContent='Checking for radar images…';
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    refreshController=controller;
    try {
      let data;
      if(wantedHD)data=await root.GregleHighResRadar.load(wantedStation,controller.signal);
      else {
        const response=await fetch(ENDPOINT,{signal:controller.signal,cache:'no-cache'});
        if(!response.ok)throw Error('Radar unavailable');
        data=framesFrom(await response.json());
      }
      if(version!==fetchVersion)return;
      clearLayers();current=-1;host=data.host;frames=data.frames;failed=false;sourceFailed=false;lastFetch=Date.now();
      displayedHD=wantedHD;displayedStation=wantedStation;sourceDetails();
      $('radarTimestamp').textContent='Loading…';root.GregleLightning?.setFrame(null);
      $('radarTime').max=String(frames.length-1);$('radarTime').disabled=false;$('radarPlay').disabled=frames.length<2;
      // Stay near the selected observation when changing feeds; latest follows latest.
      const selected=!changingSource || wasLatest || !previousTime?frames.length-1:frames.reduce((best,f,i)=>Math.abs(f.time-previousTime)<Math.abs(frames[best].time-previousTime)?i:best,0);
      show(selected);
    } catch(_) {
      if(version!==fetchVersion)return;
      failed=true;
      if(frames.length) {
        sourceFailed=wantedHD!==displayedHD || (wantedHD && wantedStation!==displayedStation);
        if(sourceFailed){hdEnabled=displayedHD;station=displayedStation;modeControls();rememberMode();}
        status();
      } else { $('radarTimestamp').textContent='Unavailable';$('radarStatus').textContent=hdEnabled?'High-resolution radar is unavailable. Try Refresh or switch High Res off for standard radar.':'Radar is unavailable right now. Try Refresh.'; }
    } finally {
      clearTimeout(timeout);
      if(version===fetchVersion){
        refreshController=null;fetching=false;$('radarRefresh').disabled=false;
        $('radarPlay').disabled=frames.length<2;$('radarTime').disabled=!frames.length;
      }
    }
  }
  function recenter() { if(map && location)map.setView([location.latitude,location.longitude],7); }
  function setupFullscreen() {
    const panel=$('radarPanel'), dialog=$('radarFullscreenDialog');
    if(!panel.requestFullscreen && !dialog.showModal)return;
    const button=document.createElement('button');
    button.type='button';
    button.className='radar-fullscreen-toggle';
    button.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path/></svg>';
    const icon=button.querySelector('path');
    let requesting=false;
    const updateButton=()=>{
      const active=document.fullscreenElement===panel || dialog.open;
      const label=active?'Exit full screen':'Full screen';
      button.title=label;
      button.setAttribute('aria-label',label);
      icon.setAttribute('d',active?'M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6':'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6');
    };
    updateButton();
    map.zoomControl.getContainer().prepend(button);
    document.addEventListener('fullscreenchange',updateButton);
    dialog.addEventListener('close',()=>{
      dialog.before(panel);
      updateButton();
      button.focus({preventScroll:true});
    });
    button.addEventListener('click',async ()=>{
      if(requesting)return;
      if(dialog.open){dialog.close();return;}
      if(document.fullscreenElement===panel){
        await document.exitFullscreen();
        return;
      }
      if(document.fullscreenEnabled && panel.requestFullscreen){
        requesting=true;
        try {await panel.requestFullscreen();return;}
        catch(_) {} // Use an in-page full-screen view where the browser blocks native fullscreen.
        finally {requesting=false;}
      }
      if(!dialog.showModal)return;
      dialog.append(panel);
      dialog.showModal();
      updateButton();
      button.focus({preventScroll:true});
    });
  }
  function setLocation(value) {
    if(!Number.isFinite(value?.latitude)||!Number.isFinite(value?.longitude))return;
    location=value;
    if(sites.length)populateStations();
    root.GregleLightning?.setLocation(value);
    root.GregleWeatherLayers?.setLocation(value);
    if(map) { stop();clearLayers();marker.setLatLng([value.latitude,value.longitude]);recenter();if(frames.length)show(frames.length-1); }
  }
  function start() {
    if(started || !location)return;
    started=true;
    if(!root.L) { $('radarStatus').textContent='The radar map could not load. Refresh this page to retry, or open RainViewer below.';return; }
    map=root.L.map('radarMap',{scrollWheelZoom:true,minZoom:2,maxZoom:10,fadeAnimation:false});
    setupFullscreen();
    root.GregleRadarStations?.attach(map,id=>{if(station===id)return;station=id;changeSource();});
    root.GregleRadarStations?.setSites(sites);
    modeControls();
    root.GregleLightning?.attach(map);
    root.GregleWeatherTransparency?.attach(map,opacity=>{
      const visible=layers.get(frames[current]?.path);
      if(visible)visible.setOpacity(opacity);
    });
    const base=root.GregleWeatherBasemap.addTo(map);
    base.on('tileerror',()=>{baseFailed=true;status();});
    marker=root.L.circleMarker([location.latitude,location.longitude],{radius:6,color:'#fff',weight:2,fillColor:'#233e58',fillOpacity:1}).addTo(map);
    recenter();
    // Dropping cached frames on a pan prevents hidden layers requesting many tiles.
    map.on('movestart',()=>{stop();clearLayers();});
    map.on('moveend',()=>{if(frames.length)show(current);});
    if('ResizeObserver' in root) {
      new ResizeObserver(([{contentRect}])=>{
        if(contentRect.width && contentRect.height)map.invalidateSize({debounceMoveend:true});
      }).observe($('radarMap'));
    }
    $('radarRefresh').addEventListener('click',()=>{baseFailed=false;base.redraw();refresh(true);loadStations();root.GregleLightning?.refresh();});
    refresh(true);
  }
  root.GregleRadar={setLocation,pause:stop,resumeView(){
    if(map){map.invalidateSize();sourceDetails();if(frames.length)show(current);refresh();}
  }};
  document.addEventListener('DOMContentLoaded',()=>{
    if(root.GregleHighResRadar && $('radarHighResToggle')) {
      modeControls();loadStations();
      $('radarHighResToggle').addEventListener('change',()=>{hdEnabled=$('radarHighResToggle').checked;changeSource();});
      $('radarStation').addEventListener('change',()=>{station=$('radarStation').value;changeSource();});
      $('radarStationsToggle')?.addEventListener('change',()=>{
        stationsVisible=$('radarStationsToggle').checked;modeControls();rememberMode();
      });
    }
    $('radarRecenter').addEventListener('click',recenter);
    $('radarTime').addEventListener('input',()=>{stop();show(Number($('radarTime').value));});
    $('radarPlay').addEventListener('click',()=>{
      if(playing){stop();status();return;}
      if(fetching || frames.length<2)return;
      playing=true;
      $('radarPlay').textContent='Ⅱ Pause';$('radarPlay').setAttribute('aria-pressed','true');
      async function tick() {
        if(!playing)return;
        if(!await show((current+1)%frames.length) || !playing)return;
        layerFor(frames[(current+1)%frames.length]);
        // Give each complete frame a consistent dwell and pause at the latest
        // observation so the jump back to the start reads as a loop.
        playTimer=setTimeout(tick,current===frames.length-1?1600:600);
      }
      tick();
    });
    if('IntersectionObserver' in root) {
      const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){start();observer.disconnect();}},{rootMargin:'200px'});
      observer.observe($('radarMap'));
    } else start();
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else if(map)refresh();});
    setInterval(()=>{if(!document.hidden && map)refresh();},60000);
    root.addEventListener('pagehide',stop);
  });
})(globalThis);

