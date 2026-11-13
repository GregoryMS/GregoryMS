(() => {
 'use strict';
 window.GregleMapRotation = ({map,onChange=()=>{}}) => {
  if (!map.setBearing) return;
  const toolbar=document.querySelector('.map-actions');
  if (!toolbar) return;
  const box=L.DomUtil.create('div','gregle-map-rotation');
   box.setAttribute('role','group');box.setAttribute('aria-label','Map rotation');
   const button=(label,html,action)=>{
    const el=L.DomUtil.create('button','map-icon-button',box);el.type='button';el.title=label;el.setAttribute('aria-label',label);el.innerHTML=html;
    L.DomEvent.on(el,'click',event=>{L.DomEvent.stop(event);action();});return el;
   };
   const left=button('Rotate map left','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 1 1 2 9M4 4v6h6"/></svg>',()=>map.setBearing(map.getBearing()-15));
   const compass=button('Compass: reset map north','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 5 10H7Z" fill="currentColor"/><path d="m12 22-5-10h10Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',()=>map.setBearing(0));
   button('Rotate map right','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10a8 8 0 1 0-2 9M20 4v6h-6"/></svg>',()=>map.setBearing(map.getBearing()+15));
   L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);
   const sync=()=>{const bearing=map.getBearing();compass.querySelector('svg').style.transform=`rotate(${bearing}deg)`;compass.title=`Compass · ${Math.round((360-bearing)%360)}° · tap to reset north`;onChange();};
   map.on('rotate',sync);sync();
   toolbar.append(box);return box;
 };
})();
