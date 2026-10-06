(function (root) {
  'use strict';
  const C = root.GregleSatelliteCore, $ = id => document.getElementById(id);
  const section = $('satellite-tracker');
  if (!section || !C) return;
  let selected = C.satellites[0], place, map, marker, observerMarker, trail, projection;
  let data, loadedAt=0, dataController, requestVersion=0, lastPosition, orbit, positions=[];
  let inView=false, stopped=false, timer, tileFailed=false;
  const active = () => inView && !document.hidden && !stopped;
  const timeText = time => new Date(time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function setLocation(next) {
    place=next;
    $('satellite-passes').href=C.passesURL(next,selected.id);
    $('satellite-passes').textContent=selected.short+' passes for '+(next.name || 'your location')+' (UTC) ↗';
    if (map) {
      const pair=[next.latitude,next.longitude];
      if (!observerMarker) observerMarker=root.L.circleMarker(pair,{radius:7,color:'#5e35b1',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map);
      observerMarker.setLatLng(pair).bindTooltip(next.name || 'Observing location');
    }
    if (active() && orbit) tick();
  }
  root.GregleSatellite={setLocation};
  function initMap() {
    if (map || !root.L) return;
    $('satellite-map').replaceChildren();
    map=root.L.map('satellite-map',{scrollWheelZoom:false,worldCopyJump:true,minZoom:1,maxZoom:8}).setView([20,0],2);
    const tiles=root.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19
    }).addTo(map);
    tiles.on('tileerror',()=>{tileFailed=true; $('satellite-status').textContent='Some map tiles could not load. Position details remain available below.';});
    projection=root.L.polyline([],{color:'#c76e15',weight:3,dashArray:'7 7',opacity:0.9}).addTo(map).bindTooltip('Projected path · next 90 minutes');
    trail=root.L.polyline([],{color:'#7452c8',weight:3,opacity:0.8}).addTo(map);
    map.on('dragstart',()=>{$('satellite-follow').checked=false;});
    if (place) setLocation(place);
  }
  function clearReadings() {
    lastPosition=null; orbit=null; positions=[];
    for (const id of ['satellite-position','satellite-altitude','satellite-speed','satellite-elevation']) $(id).textContent='—';
    $('satellite-orbit-date').textContent='Loading orbit data…';
    marker?.remove(); marker=null; trail?.setLatLngs([]); projection?.setLatLngs([]);
  }
  function tick() {
    root.clearTimeout(timer);
    if (!active()) return;
    try {
      const now=Date.now();
      orbit=C.record(data?.satellites?.find(row=>row.NORAD_CAT_ID===selected.id),selected.id,now);
      const p=C.position(orbit,now,place);
      // Build the recent track from positions displayed during this session.
      if (!lastPosition || now-lastPosition.timestamp*1000>=9000) positions.push(p);
      positions=positions.filter(point=>now-point.timestamp*1000<=1800000);
      lastPosition=p;
      $('satellite-position').textContent=p.latitude.toFixed(2)+'°, '+p.longitude.toFixed(2)+'°';
      $('satellite-altitude').textContent=p.altitude.toFixed(0)+' km';
      $('satellite-speed').textContent=Math.round(p.velocity).toLocaleString()+' km/h';
      $('satellite-elevation').textContent=p.elevation===null ? 'Choose a location' :
        p.elevation.toFixed(1)+'° · '+(p.elevation>0 ? 'above horizon' : 'below horizon');
      $('satellite-orbit-date').textContent='Orbit epoch: '+new Date(orbit.epoch).toLocaleString()+
        ' · '+((now-orbit.epoch)/86400000).toFixed(1)+' days old.';
      $('satellite-status').textContent='Estimated position at '+timeText(now)+' · updates every 10 seconds.'+
        (now-orbit.epoch>2*86400000 ? ' Orbit data is over two days old; predictions may be less accurate.' : '')+
        (!map ? ' Map unavailable.' : tileFailed ? ' Some map tiles could not load.' : '');
      if (map) {
        const pair=[p.latitude,p.longitude];
        if (!marker) marker=root.L.circleMarker(pair,{radius:9,color:'#fff',weight:2,fillColor:'#7452c8',fillOpacity:1})
          .addTo(map).bindTooltip(selected.name,{permanent:true,direction:'top'});
        marker.setLatLng(pair); trail.setLatLngs(C.segments(positions));
        projection.setLatLngs($('satellite-path').checked ? C.projectedPath(orbit,now) : []);
        if ($('satellite-follow').checked) map.panTo(pair,{animate:false});
      }
    } catch (_) {
      clearReadings();
      $('satellite-orbit-date').textContent='Current orbit data unavailable for '+selected.short+'.';
      $('satellite-status').textContent='Orbit data missing, invalid or older than seven days. Try Reload orbit data or the provider links.';
    }
    timer=root.setTimeout(()=>{if (Date.now()-loadedAt>3600000) loadData(); else tick();},10000);
  }
  async function loadData(force=false) {
    if (!active()) return;
    if (!force && data && Date.now()-loadedAt<3600000) {tick();return;}
    dataController?.abort();
    const version=++requestVersion, controller=new AbortController(); dataController=controller;
    const timeout=root.setTimeout(()=>controller.abort(),8000);
    $('satellite-refresh').disabled=true;
    try {
      const response=await root.fetch('data/satellite-orbits.json',{signal:controller.signal,cache:'no-cache',credentials:'omit'});
      if (!response.ok) throw Error('Orbit data unavailable');
      const next=await response.json();
      if (!Array.isArray(next?.satellites)) throw Error('Invalid orbit feed');
      if (version!==requestVersion || controller.signal.aborted) return;
      data=next; loadedAt=Date.now();
      if (active()) tick();
    } catch (_) {
      if (version===requestVersion && active()) {
        if (data) {
          tick();
          $('satellite-status').textContent+=' Orbit refresh failed; using the displayed orbit epoch.';
        } else {
          $('satellite-status').textContent='Orbit data unavailable. Try Reload orbit data or the provider links.';
        }
      }
    } finally {
      root.clearTimeout(timeout);
      if (version===requestVersion) {dataController=null; $('satellite-refresh').disabled=false;}
    }
  }
  function sync() {
    root.clearTimeout(timer);
    if (active()) {initMap();map?.invalidateSize();loadData();}
    else {
      ++requestVersion; dataController?.abort(); dataController=null; $('satellite-refresh').disabled=false;
      if (lastPosition) $('satellite-status').textContent='Updates paused · last estimated position at '+timeText(lastPosition.timestamp*1000)+'.';
    }
  }
  $('satellite-select').addEventListener('change',()=>{
    selected=C.satellites.find(s=>String(s.id)===$('satellite-select').value) || C.satellites[0];
    clearReadings();
    $('satellite-name').textContent=selected.name+' · NORAD '+selected.id;
    $('satellite-map').setAttribute('aria-label','Position and projected path of '+selected.name);
    $('satellite-details').href='https://www.n2yo.com/?s='+selected.id;
    if (place) setLocation(place);
    if (active()) loadData();
  });
  $('satellite-refresh').addEventListener('click',()=>loadData(true));
  $('satellite-follow').addEventListener('change',()=>{if (active() && data) tick();});
  $('satellite-path').addEventListener('change',()=>{if (active() && data) tick();});
  if (root.IntersectionObserver) {
    new root.IntersectionObserver(entries=>{inView=entries[0].isIntersecting;sync();}).observe(section);
  } else {inView=true;sync();}
  document.addEventListener('visibilitychange',sync);
  root.addEventListener('pagehide',()=>{stopped=true;sync();});
  root.addEventListener('pageshow',()=>{stopped=false;sync();});
})(window);
