(async () => {
  'use strict';
  const status = document.getElementById('status');
  let map, timeout, popup;
  const fail = () => { status.textContent = '3D could not load. Use Change map to return to another base map, or reload to retry.'; status.hidden = false; };
  try {
    if (!window.maplibregl?.Map) throw Error('WebGL unavailable');
    const view = window.GregleMaps.readHash(location.hash).view;
    map = new window.maplibregl.Map({container:'map', style:'https://tiles.openfreemap.org/styles/liberty', center:[view.lng,view.lat], zoom:view.zoom, minZoom:2,maxZoom:19,pitch:55, antialias:false,
      attributionControl:true});
    timeout = setTimeout(fail,20000);
    let overlays = {type:'FeatureCollection',features:[]};
    const draw = () => {
      if (!map.isStyleLoaded()) return;
      if (map.getSource('gregle-overlays')) { map.getSource('gregle-overlays').setData(overlays); return; }
      map.addSource('gregle-overlays',{type:'geojson',data:overlays});
      map.addLayer({id:'gregle-areas',type:'fill',source:'gregle-overlays',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['get','colour'],'fill-opacity':0.15}});
      map.addLayer({id:'gregle-lines',type:'line',source:'gregle-overlays',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['get','colour'],'line-width':['get','weight']}});
      map.addLayer({id:'gregle-points',type:'circle',source:'gregle-overlays',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['get','colour'],'circle-radius':7,'circle-stroke-color':'#fff','circle-stroke-width':2}});
      map.on('click','gregle-points',event=>{
        const item=event.features?.[0]; if (!item) return;
        const title=item.properties.title || 'Map feature';
        popup?.remove(); popup = new window.maplibregl.Popup().setLngLat(event.lngLat).setText(title).addTo(map);
        window.parent.postMessage({type:'gregle-3d-select',id:item.id,point:{lng:event.lngLat.lng,lat:event.lngLat.lat}},location.origin);
      });
    };
    window.addEventListener('message',event=>{
      if (event.source !== window.parent || event.origin !== location.origin) return;
      if (event.data?.type === 'gregle-3d-overlays' && event.data.data?.type === 'FeatureCollection') { overlays=event.data.data; draw(); }
      if (event.data?.type === 'gregle-3d-details' && typeof event.data.text === 'string' && event.data.point) { popup?.remove(); popup = new window.maplibregl.Popup().setLngLat(event.data.point).setText(event.data.text).addTo(map); }
    });
    map.once('load', () => { clearTimeout(timeout); status.hidden = true; draw(); });
    map.on('error', fail);
    map.on('webglcontextlost', fail);
    map.addControl(new window.maplibregl.NavigationControl({visualizePitch:true}),'top-right');
    map.addControl(new window.maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true,showUserHeading:true}),'top-right');
    map.on('moveend', () => {
      const center = map.getCenter(), view = {lat:center.lat,lng:window.GregleMaps.wrapLongitude(center.lng),zoom:map.getZoom()};
      history.replaceState(null,'',window.GregleMaps.makeHash(view));
      if (window.parent !== window) window.parent.postMessage({type:'gregle-3d-view',view},location.origin);
    });
    window.addEventListener('pagehide',()=>{clearTimeout(timeout);map.remove();});
  } catch (_) { clearTimeout(timeout); fail(); }
})();
