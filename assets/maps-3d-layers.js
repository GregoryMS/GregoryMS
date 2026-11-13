(() => {
  'use strict';
  window.Gregle3DOverlayBridge = ({map,send}) => {
    let timer, layers = new Map();
    function snapshot() {
      if (document.hidden) return;
      const features = []; layers = new Map();
      map.eachLayer(layer => {
        if (features.length >= 3000 || layer.getLayers || !layer.toGeoJSON) return;
        let feature;
        try { feature = layer.toGeoJSON(); } catch { return; }
        if (feature?.type !== 'Feature' || !feature.geometry) return;
        const options = layer.options || {}, id = L.stamp(layer);
        feature.id = id;
        feature.properties = {colour:options.color || '#7637cc',weight:Math.max(1,Math.min(10,options.weight || 3)),title:String(options.title || options.alt || 'Map feature').slice(0,240)};
        layers.set(id,layer); features.push(feature);
      });
      send({type:'gregle-3d-overlays',data:{type:'FeatureCollection',features}});
    }
    function stop() { clearInterval(timer); timer = null; layers.clear(); }
    function start() { stop(); snapshot(); timer=setInterval(snapshot,1500); }
    function select({id,point}) {
      const layer=layers.get(Number(id)); if (!layer) return;
      try {
        const popup=layer.getPopup?.();
        if(popup?.options?.className==='aircraft-map-popup'){layer.openPopup();send({type:'gregle-3d-close-details'});return;}
        let content=popup?.getContent();
        if (typeof content === 'function') content=content(layer);
        let text=content?.textContent;
        if (typeof content === 'string') { const node=document.createElement('div'); node.innerHTML=content; text=node.textContent; }
        if (text) send({type:'gregle-3d-details',text:text.slice(0,6000),point});
      } catch { /* The marker title remains available if detailed content cannot be built. */ }
    }
    return {start,stop,select,snapshot};
  };
})();
