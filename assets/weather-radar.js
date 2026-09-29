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
  function tileURL(host,frame) { return `${host}${frame.path}/512/{z}/{x}/{y}/2/1_0.png`; }
  function stale(frame,now=Date.now()) { return !frame || now-frame.time*1000>30*60000; }
  const core={framesFrom,tileURL,stale};
  if(typeof module!=='undefined' && module.exports) { module.exports=core; return; }
  const $=id=>document.getElementById(id);
  let location=null,map=null,marker=null,frames=[],host='',layers=new Map(),current=-1,playing=null,fetching=false,lastFetch=0,started=false;
  let failed=false,baseFailed=false,tileTimer=null;
  function stop() { clearTimeout(playing); playing=null; $('radarPlay').textContent='▶ Play'; $('radarPlay').setAttribute('aria-pressed','false'); }
  function time(frame) {
    if(!frame)return '';
    let zone=location?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try { new Intl.DateTimeFormat('en',{timeZone:zone}); } catch(_) { zone='UTC'; }
    return new Date(frame.time*1000).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone,timeZoneName:'short'});
  }
  function status() {
    const layer=layers.get(frames[current]?.path);
    $('radarStatus').textContent=failed?'Radar refresh failed. Showing the previous images; try Refresh.':
      baseFailed?'The background map could not fully load. Try Refresh.':
      layer?.radarError?'Some radar tiles could not load. Try Refresh; blank areas may have missing data.':
      stale(frames.at(-1))?'Radar is delayed — the latest image is over 30 minutes old.':
      'Drag to explore · Use + / − to zoom · Play or drag the timeline to see recent rain movement.';
  }
  function show(index) {
    if(!frames.length || !map)return;
    clearTimeout(tileTimer);
    current=Math.max(0,Math.min(frames.length-1,index));
    const frame=frames[current];
    let layer=layers.get(frame.path);
    // Keep previously viewed frames cached, but never preload the whole timeline.
    for(const other of layers.values()) other.setOpacity(0);
    if(!layer) {
      layer=root.L.tileLayer(tileURL(host,frame),{tileSize:512,zoomOffset:-1,maxNativeZoom:8,maxZoom:10,opacity:0.7,updateWhenIdle:true,keepBuffer:0,attribution:'<a href="https://www.rainviewer.com/">RainViewer</a>'});
      layer.on('tileerror',()=>{ layer.radarError=true; if(layers.get(frames[current]?.path)===layer){stop();status();} });
      layer.on('load',()=>{ if(layers.get(frames[current]?.path)===layer){clearTimeout(tileTimer);status();} });
      layers.set(frame.path,layer); layer.addTo(map);
    } else layer.setOpacity(0.7);
    $('radarTime').value=String(current);
    $('radarTime').setAttribute('aria-valuetext',time(frame));
    $('radarTimestamp').textContent=time(frame);
    $('radarStart').textContent=time(frames[0]);
    status();
    if(layer.isLoading()) {
      $('radarStatus').textContent='Loading radar image…';
      tileTimer=setTimeout(()=>{layer.radarError=true;stop();status();},15000);
    }
  }
  function clearLayers() { clearTimeout(tileTimer); for(const layer of layers.values())map.removeLayer(layer);layers.clear(); }
  async function refresh(force=false) {
    if(!map || fetching || (!force && Date.now()-lastFetch<300000))return;
    stop();fetching=true;$('radarRefresh').disabled=true;
    $('radarStatus').textContent='Checking for radar images…';
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(ENDPOINT,{signal:controller.signal,cache:'no-cache'});
      if(!response.ok)throw Error('Radar unavailable');
      const data=framesFrom(await response.json());
      clearLayers();host=data.host;frames=data.frames;failed=false;lastFetch=Date.now();
      $('radarTime').max=String(frames.length-1);$('radarTime').disabled=false;$('radarPlay').disabled=frames.length<2;
      show(frames.length-1);
    } catch(_) {
      failed=true;
      if(frames.length)status();
      else { $('radarTimestamp').textContent='Unavailable';$('radarStatus').textContent='Radar is unavailable right now. Try Refresh, or open RainViewer below.'; }
    } finally { clearTimeout(timeout);fetching=false;$('radarRefresh').disabled=false; }
  }
  function recenter() { if(map && location)map.setView([location.latitude,location.longitude],7); }
  function setLocation(value) {
    if(!Number.isFinite(value?.latitude)||!Number.isFinite(value?.longitude))return;
    location=value;
    $('radarLocation').textContent=`Recent rain around ${value.name}`;
    if(map) { stop();clearLayers();marker.setLatLng([value.latitude,value.longitude]);recenter();if(frames.length)show(frames.length-1); }
  }
  function start() {
    if(started || !location)return;
    started=true;
    if(!root.L) { $('radarStatus').textContent='The radar map could not load. Refresh this page to retry, or open RainViewer below.';return; }
    map=root.L.map('radarMap',{scrollWheelZoom:false,minZoom:2,maxZoom:10});
    const base=root.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    base.on('tileerror',()=>{baseFailed=true;status();});
    marker=root.L.circleMarker([location.latitude,location.longitude],{radius:6,color:'#fff',weight:2,fillColor:'#233e58',fillOpacity:1}).addTo(map);
    recenter();
    // Dropping cached frames on a pan prevents hidden layers requesting many tiles.
    map.on('movestart',()=>{stop();clearLayers();});
    map.on('moveend',()=>{if(frames.length)show(current);});
    $('radarRefresh').addEventListener('click',()=>{baseFailed=false;base.redraw();refresh(true);});
    refresh(true);
  }
  root.GregleRadar={setLocation};
  document.addEventListener('DOMContentLoaded',()=>{
    $('radarRecenter').addEventListener('click',recenter);
    $('radarTime').addEventListener('input',()=>{stop();show(Number($('radarTime').value));});
    $('radarPlay').addEventListener('click',()=>{
      if(playing){stop();return;}
      $('radarPlay').textContent='Ⅱ Pause';$('radarPlay').setAttribute('aria-pressed','true');
      function tick(){
        const active=layers.get(frames[current]?.path);
        if(active?.radarError){stop();return;}
        if(!active?.isLoading())show((current+1)%frames.length);
        playing=setTimeout(tick,1200);
      }
      playing=setTimeout(tick,0);
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
