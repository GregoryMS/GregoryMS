/* Shortbread styles and a local-only MapLibre basemap inside the existing Leaflet UI. */
(() => {
  'use strict';
  let library,registered=false,current,layer,styleName,revision=0;
  const credit='Tiles: <a href="https://versatiles.org/">VersaTiles</a>';
  const templates=new Map();
  const loadScript=src=>new Promise((resolve,reject)=>{const node=document.createElement('script');node.src=src;node.onload=resolve;node.onerror=()=>{node.remove();reject(Error('The offline map library is unavailable. Reopen Maps online to finish setup.'));};document.head.append(node);});
  async function load(){
    if(!library)library=(async()=>{
      if(!window.maplibregl)await loadScript('/assets/vendor/maplibre/maplibre-gl.js');
      if(!window.MaplibreGLLeaflet)await loadScript('/assets/leaflet-maplibre-gl.js');
      if(maplibregl.supported&&!maplibregl.supported())throw Error('Detailed offline maps need WebGL. Try another browser or device.');
      if(!registered){
        // Use one worker and a small tile cache on phones as well as car browsers.
        maplibregl.setWorkerCount(1);maplibregl.setMaxParallelImageRequests(4);
        maplibregl.addProtocol('gregle-offline',async(request,controller)=>{
          const match=/^gregle-offline:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url),selected=current;
          if(!match||!selected||match[1]!==selected.pack.generation)throw new DOMException('Superseded','AbortError');
          const tile=await selected.archive.getZxy(Number(match[2]),Number(match[3]),Number(match[4]),controller.signal);
          return {data:tile?.data||new Uint8Array(0)};
        });registered=true;
      }
    })().catch(error=>{library=null;throw error;});
    return library;
  }
  function clear(map){revision++;if(layer){map.removeLayer(layer);layer=null;map.attributionControl?.removeAttribution(credit);}current=null;styleName=null;}
  async function show(map,pack,dark){
    const token=++revision;await load();if(token!==revision)return null;const theme=dark?'dark':'light';
    if(layer&&current?.pack.generation===pack.generation&&styleName===theme)return layer;
    if(!templates.has(theme)){const response=await fetch('/assets/maps-offline-style/'+theme+'.json');if(!response.ok)throw Error('The offline map style is unavailable.');templates.set(theme,await response.json());}
    if(token!==revision)return null;const style=structuredClone(templates.get(theme));
    style.glyphs=location.origin+style.glyphs;
    style.sprite=style.sprite.map(sprite=>({...sprite,url:new URL(sprite.url,location.origin).href}));
    style.sources['versatiles-shortbread']={type:'vector',tiles:[`gregle-offline://${pack.generation}/{z}/{x}/{y}`],bounds:pack.bounds,minzoom:0,maxzoom:14,attribution:'© OpenStreetMap contributors · VersaTiles'};
    clear(map);current={pack,archive:GregleOfflineArchive(pack)};styleName=theme;
    if(!map.getPane('offlineVector')){map.createPane('offlineVector').style.zIndex='220';}
    layer=MaplibreGLLeaflet.maplibreGL({style,interactive:false,pane:'offlineVector',padding:0,antialias:false,fadeDuration:0,renderWorldCopies:false,maxTileCacheSize:24,maxTileCacheZoomLevels:2,refreshExpiredTiles:false,pixelRatio:Math.min(2,devicePixelRatio||1),attributionControl:false});
    layer.addTo(map);map.attributionControl?.addAttribution(credit);layer.getMaplibreMap().getCanvas().setAttribute('aria-hidden','true');return layer;
  }
  window.GregleOfflineVector={show,clear,get map(){return layer?.getMaplibreMap();}};
})();
