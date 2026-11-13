'use strict';
// OpenFreeMap is a renderer in the Gregle page; Leaflet remains the shared UI model.
window.GregleNative3D = ({map,onError,onStatus=()=>{}}) => {
  const host=document.getElementById('gregle-map-3d'),stage=document.querySelector('.map-stage');
  const core=window.GregleMaps, lightweight=/Tesla/i.test(navigator.userAgent);
  let wanted=false,view=null,version=0,library,frame,timer,recovery,syncing=false,ready=false,pin,pinLayer;
  function loadLibrary(){
    if(window.maplibregl)return Promise.resolve();
    if(!library)library=new Promise((resolve,reject)=>{
      const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css';document.head.append(css);
      const script=document.createElement('script');script.src='https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js';
      const timeout=setTimeout(()=>{script.remove();library=null;reject(Error('3D library timed out'));},20000);
      script.onload=()=>{clearTimeout(timeout);resolve();};
      script.onerror=()=>{clearTimeout(timeout);script.remove();library=null;reject(Error('3D library unavailable'));};
      document.head.append(script);
    });
    return library;
  }
  function syncFromLeaflet(){
    if(!view||syncing)return;
    syncing=true;
    try{const p=map.getCenter();view.jumpTo({center:[p.lng,p.lat],zoom:map.getZoom(),bearing:-(map.getBearing?.()||0)});}
    finally{syncing=false;}
  }
  function syncFrom3D(){
    if(!view||syncing)return;
    const p=view.getCenter();if(!core.validPoint(p.lat,core.wrapLongitude(p.lng)))return;
    syncing=true;
    try{map.setView([p.lat,core.wrapLongitude(p.lng)],view.getZoom(),{animate:false});map.setBearing?.(-view.getBearing());}
    finally{syncing=false;}
  }
  function draw(){
    frame=null;if(!view||!ready||document.hidden)return;
    const features=[];let selected;
    map.eachLayer(layer=>{
      if(features.length>=3000||layer.getLayers||!layer.toGeoJSON)return;
      if(layer.options?.alt==='Map pin'){selected=layer;return;}
      // Accuracy circles are measured in metres; the position dot is sufficient in 3D.
      if(L.Circle&&layer instanceof L.Circle)return;
      try{
        const feature=layer.toGeoJSON();if(feature?.type!=='Feature'||!feature.geometry)return;
        const o=layer.options||{};feature.properties={colour:o.fillColor||o.color||'#7637cc',radius:Math.min(10,o.radius||6),weight:Math.max(1,Math.min(10,o.weight||3))};features.push(feature);
      }catch{}
    });
    const data={type:'FeatureCollection',features};
    if(view.getSource('gregle-ui'))view.getSource('gregle-ui').setData(data);
    else{
      view.addSource('gregle-ui',{type:'geojson',data});
      view.addLayer({id:'gregle-ui-areas',type:'fill',source:'gregle-ui',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['get','colour'],'fill-opacity':.15}});
      view.addLayer({id:'gregle-ui-lines',type:'line',source:'gregle-ui',filter:['==',['geometry-type'],'LineString'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','colour'],'line-width':['get','weight']}});
      view.addLayer({id:'gregle-ui-points',type:'circle',source:'gregle-ui',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['get','colour'],'circle-radius':['get','radius'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
    }
    if(selected!==pinLayer){
      pin?.remove();pin=null;pinLayer=selected;
      if(selected){
        const element=document.createElement('button');element.type='button';element.className='gregle-map-pin native-3d-pin';element.setAttribute('aria-label','Map pin');
        element.innerHTML=selected.getElement()?.innerHTML||'<span aria-hidden="true">📍</span>';
        element.addEventListener('click',event=>{event.stopPropagation();selected.fire('click',{originalEvent:event});});
        pin=new window.maplibregl.Marker({element,anchor:'bottom'}).setLngLat([selected.getLatLng().lng,selected.getLatLng().lat]).addTo(view);
      }
    }
  }
  const scheduleDraw=()=>{if(view&&!frame)frame=requestAnimationFrame(draw);};
  function close(){
    version++;clearTimeout(timer);clearTimeout(recovery);cancelAnimationFrame(frame);frame=null;
    pin?.remove();pin=pinLayer=null;view?.remove();view=null;ready=false;
    host.hidden=true;stage.classList.remove('native-3d-active');
    window.dispatchEvent(new CustomEvent('gregle-regular-3d',{detail:false}));
  }
      const gestures=window.GregleMapPinGestures?.({container:host,onPin:touch=>{
        if(!view)return;const rect=host.getBoundingClientRect(),p=view.unproject([touch.clientX-rect.left,touch.clientY-rect.top]);
        map.fire('dblclick',{latlng:L.latLng(p.lat,p.lng),originalEvent:{pointerType:'touch',target:touch.target}});
      }});
  async function open(){
    const token=++version;host.hidden=false;stage.classList.add('native-3d-active');
    window.dispatchEvent(new CustomEvent('gregle-regular-3d',{detail:true}));onStatus('Loading OpenFreeMap 3D…');
    try{
      await loadLibrary();if(!wanted||token!==version)return;
      if(window.maplibregl.supported&&!window.maplibregl.supported())throw Error('WebGL unavailable');
      if(lightweight){window.maplibregl.setWorkerCount?.(1);window.maplibregl.setMaxParallelImageRequests?.(4);}
      const p=map.getCenter();
      view=new window.maplibregl.Map({container:host,style:'https://tiles.openfreemap.org/styles/liberty',center:[p.lng,p.lat],zoom:map.getZoom(),bearing:-(map.getBearing?.()||0),pitch:lightweight?40:55,minZoom:2,maxZoom:19,maxPitch:60,antialias:false,fadeDuration:0,renderWorldCopies:false,attributionControl:true,...(lightweight?{maxTileCacheSize:24}:{} )});
      view.doubleClickZoom.disable();
      view.addControl(new window.maplibregl.ScaleControl({unit:'metric',maxWidth:110}),'bottom-right');
      const current=view;
      timer=setTimeout(()=>{if(token===version&&!ready)fail();},20000);
      function fail(){if(token!==version)return;close();onError('OpenFreeMap 3D could not load. Returned to the street map.');}
      current.once('load',()=>{if(token!==version)return;clearTimeout(timer);ready=true;draw();onStatus('OpenFreeMap 3D · Gregle controls are available. Extra layers resume in 2D.');});
      current.on('moveend',syncFrom3D);
      current.on('movestart',()=>map.fire('movestart'));
      current.on('dragstart',()=>map.fire('dragstart'));
      current.on('zoomstart',()=>map.fire('zoomstart'));
      for(const name of ['click','dblclick','contextmenu'])current.on(name,event=>{
        if(name!=='click'&&gestures?.ignoreDoubleClick(event.originalEvent))return;
        if(name==='contextmenu')event.originalEvent?.preventDefault();
        map.fire(name,{latlng:L.latLng(event.lngLat.lat,event.lngLat.lng),containerPoint:event.point,originalEvent:event.originalEvent});
      });
      current.on('webglcontextlost',event=>{event.originalEvent?.preventDefault?.();onStatus('3D graphics paused. Waiting for recovery…');clearTimeout(recovery);recovery=setTimeout(fail,10000);});
      current.on('webglcontextrestored',()=>{if(token!==version)return;clearTimeout(recovery);current.resize();syncFromLeaflet();onStatus('OpenFreeMap 3D restored.');});
      // Individual tile errors can recover; the startup timeout bounds a failed map.
      current.on('error',()=>{if(ready&&token===version)onStatus('Some 3D tiles are unavailable. Gregle controls remain available.');});
    }catch{if(token===version){close();onError('OpenFreeMap 3D is unavailable in this browser. Returned to the street map.');}}
  }
  map.on('moveend rotate',syncFromLeaflet);
  map.on('layeradd layerremove moveend',scheduleDraw);
  const resize=()=>{if(view){view.resize();syncFromLeaflet();}};
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize',resize);
  window.addEventListener('pagehide',close);
  window.addEventListener('pageshow',event=>{if(event.persisted&&wanted&&!view)open();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){resize();scheduleDraw();}});
  const originalFit=map.fitBounds;
  if(originalFit)map.fitBounds=function(bounds,options={}){
    if(!view)return originalFit.call(map,bounds,options);
    const b=L.latLngBounds(bounds),a=options.paddingTopLeft||options.padding||[0,0],z=options.paddingBottomRight||options.padding||[0,0];
    view.fitBounds([[b.getWest(),b.getSouth()],[b.getEast(),b.getNorth()]],{maxZoom:options.maxZoom||19,duration:0,pitch:view.getPitch(),bearing:view.getBearing(),padding:{left:a[0],top:a[1],right:z[0],bottom:z[1]}});return map;
  };
  const api={setEnabled(value){if(wanted===value)return;wanted=value;if(value)open();else close();},get active(){return wanted&&!!view;},focus(){view?.getCanvas().focus({preventScroll:true});},project(point){return view.project([point.lng,point.lat]);},revealPoint(point,options){
    if(!view)return;const p=view.project([point.lng,point.lat]),a=options.paddingTopLeft||[0,0],b=options.paddingBottomRight||[0,0],size=map.getSize();
    const x=Math.max(a[0],Math.min(p.x,size.x-b[0])),y=Math.max(a[1],Math.min(p.y,size.y-b[1]));if(x!==p.x||y!==p.y)view.panBy([p.x-x,p.y-y],{duration:0});
  }};
  map.native3D=api;return api;
};
