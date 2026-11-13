(async () => {
  'use strict';
  const status = document.getElementById('status');
  let map, timeout;
  const fail = () => { status.textContent = '3D could not load. Use Change map to return to another base map, or reload to retry.'; status.hidden = false; };
  try {
    if (!window.mapboxgl?.supported()) throw Error('WebGL unavailable');
    const response = await fetch('https://gregle-mapbox.square-rain-5ded.workers.dev/config', {cache:'no-store', credentials:'omit', signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw Error('Configuration unavailable');
    const config = await response.json();
    if (typeof config.publicToken !== 'string' || !config.publicToken.startsWith('pk.')) throw Error('Token unavailable');
    const view = window.GregleMaps.readHash(location.hash).view;
    map = new window.mapboxgl.Map({container:'map', accessToken:config.publicToken, style:'mapbox://styles/mapbox/standard', center:[view.lng,view.lat], zoom:view.zoom, minZoom:2,maxZoom:19,pitch:55, antialias:false,
      config:{basemap:{show3dObjects:true}}, attributionControl:true});
    timeout = setTimeout(fail,20000);
    map.once('load', () => { clearTimeout(timeout); status.hidden = true; });
    map.on('error', fail);
    map.on('webglcontextlost', fail);
    map.addControl(new window.mapboxgl.NavigationControl({visualizePitch:true}),'top-right');
    map.addControl(new window.mapboxgl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true,showUserHeading:true}),'top-right');
    map.on('moveend', () => {
      const center = map.getCenter(), view = {lat:center.lat,lng:window.GregleMaps.wrapLongitude(center.lng),zoom:map.getZoom()};
      history.replaceState(null,'',window.GregleMaps.makeHash(view));
      if (window.parent !== window) window.parent.postMessage({type:'gregle-3d-view',view},location.origin);
    });
    window.addEventListener('pagehide',()=>{clearTimeout(timeout);map.remove();});
  } catch (_) { clearTimeout(timeout); fail(); }
})();
