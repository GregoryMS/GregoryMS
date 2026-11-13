(() => {
 'use strict';
 window.GregleMapRotation = ({map,onChange=()=>{}}) => {
  if (!map.setBearing) return;
  const control=L.control({position:'topright'});
  control.onAdd=()=>{
   const box=L.DomUtil.create('div','leaflet-bar gregle-map-rotation');
   box.setAttribute('role','group');box.setAttribute('aria-label','Map rotation');
   const button=(label,html,action)=>{
    const el=L.DomUtil.create('button','',box);el.type='button';el.title=label;el.setAttribute('aria-label',label);el.innerHTML=html;
    L.DomEvent.on(el,'click',event=>{L.DomEvent.stop(event);action();});return el;
   };
   const left=button('Rotate map left','<span aria-hidden="true">↶</span>',()=>map.setBearing(map.getBearing()-15));
   const compass=button('Compass: reset map north','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 5 10H7Z" fill="currentColor"/><path d="m12 22-5-10h10Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',()=>map.setBearing(0));
   button('Rotate map right','<span aria-hidden="true">↷</span>',()=>map.setBearing(map.getBearing()+15));
   L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);
   const sync=()=>{const bearing=map.getBearing();compass.querySelector('svg').style.transform=`rotate(${bearing}deg)`;compass.title=`Compass · ${Math.round((360-bearing)%360)}° · tap to reset north`;onChange();};
   map.on('rotate',sync);sync();
   return box;
  };
  control.addTo(map);return control;
 };
})();
