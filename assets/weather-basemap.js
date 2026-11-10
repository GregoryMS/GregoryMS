(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.GregleWeatherBasemap=api.create(root);
})(globalThis,function() {
  'use strict';
  const attribution='&copy; <a href="https://stadiamaps.com/attribution/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const tileURL=dark=>'https://tiles.stadiamaps.com/tiles/'+(dark?'alidade_smooth_dark':'alidade_smooth')+'/{z}/{x}/{y}{r}.png';
  function create(win) {
    return {addTo(map,{credit=''}={}) {
      const html=win.document.documentElement;
      let dark=html?.classList.contains('dark-mode')===true;
      const layer=win.L.tileLayer(tileURL(dark),{maxZoom:20,attribution:attribution+(credit?' · '+credit:''),updateWhenIdle:true,keepBuffer:1}).addTo(map);
      // Change only the background tiles, leaving weather colours and playback intact.
      if(win.MutationObserver && html) {
        const observer=new win.MutationObserver(()=>{
          const next=html.classList.contains('dark-mode');
          if(next===dark)return;
          dark=next;layer.setUrl(tileURL(dark));
        });
        observer.observe(html,{attributes:true,attributeFilter:['class']});
        map.on('unload',()=>observer.disconnect());
      }
      return layer;
    }};
  }
  return {create,tileURL,attribution};
});
