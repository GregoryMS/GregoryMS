(() => {
 'use strict';
 window.GregleMapRotation = ({map,zoomControl,on3D=()=>{},onChange=()=>{}}) => {
  if (!map.setBearing) return;
  const stage=document.querySelector('.map-stage');
  if (!stage) return;
  const box=L.DomUtil.create('div','map-navigation-controls');
  box.setAttribute('role','group');box.setAttribute('aria-label','Map navigation');
  const dial=L.DomUtil.create('div','gregle-compass-dial',box);
  const button=(parent,label,html,action,className='map-icon-button')=>{
   const el=L.DomUtil.create('button',className,parent);el.type='button';el.title=label;el.setAttribute('aria-label',label);el.innerHTML=html;
   L.DomEvent.on(el,'click',event=>{L.DomEvent.stop(event);action();});return el;
  };
  button(dial,'Rotate map left','<svg viewBox="0 0 24 40" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M16 4C7 13 7 24 12 33"/><path d="m5 29 8 7 3-10" fill="currentColor" stroke="none"/></svg>',()=>map.setBearing(map.getBearing()-15),'compass-turn compass-turn-left');
  const compass=button(dial,'Compass: reset map north','<svg viewBox="0 0 24 48" aria-hidden="true"><path d="m12 2 8 22H4Z" fill="var(--map-accent)"/><path d="m12 46-8-22h16Z" fill="currentColor" opacity=".5"/></svg>',()=>map.setBearing(0),'compass-north');
  button(dial,'Rotate map right','<svg viewBox="0 0 24 40" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M8 4c9 9 9 20 4 29"/><path d="m19 29-8 7-3-10" fill="currentColor" stroke="none"/></svg>',()=>map.setBearing(map.getBearing()+15),'compass-turn compass-turn-right');
  button(box,'Open 3D map','<span aria-hidden="true">3D</span>',on3D,'map-icon-button map-3d-shortcut');
  const locate=document.getElementById?.('map-locate');if(locate)box.append(locate);
  const zoom=zoomControl?.getContainer();if(zoom)box.append(zoom);
  L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);
  const sync=()=>{const bearing=map.getBearing();compass.querySelector('svg').style.transform=`rotate(${bearing}deg)`;compass.title=`Compass · ${Math.round((360-bearing)%360)}° · tap to reset north`;onChange();};
  map.on('rotate',sync);sync();
  stage.append(box);return box;
 };
})();
