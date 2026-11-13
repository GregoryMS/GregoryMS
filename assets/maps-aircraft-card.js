'use strict';
window.GregleAircraftCard = ({onClose}) => {
  const $ = id => document.getElementById(id), stage = document.querySelector('.map-stage');
  const card = $('aircraft-info-card'), content = $('aircraft-info-content'), handle = $('aircraft-info-drag');
  let position = null, gesture;
  function layout() {
    if (card.hidden) return;
    const area = stage.getBoundingClientRect(), box = card.getBoundingClientRect();
    const controls = stage.querySelector('.map-navigation-controls')?.getBoundingClientRect();
    const beside = controls?.width && controls.left > area.left + area.width / 2 ? controls.left - area.left - box.width - 12 : area.width - box.width - 18;
    const point = position || {x:beside,y:area.height-box.height-60};
    const x = Math.max(8,Math.min(point.x,area.width-box.width-8)), y = Math.max(8,Math.min(point.y,area.height-box.height-8));
    card.style.left = x+'px'; card.style.top = y+'px';
    if (position) position = {x,y};
  }
  function hide() { card.hidden=true; gesture=null; }
  function close() { hide(); onClose(); }
  $('aircraft-info-close').addEventListener('click',close);
  handle.addEventListener('pointerdown',event=>{
    if (!event.isPrimary || event.button!==0) return;
    const area=stage.getBoundingClientRect(), box=card.getBoundingClientRect();
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left-area.left,top:box.top-area.top};
    handle.setPointerCapture(event.pointerId); event.preventDefault();
  });
  handle.addEventListener('pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    position={x:gesture.left+event.clientX-gesture.x,y:gesture.top+event.clientY-gesture.y};layout();
  });
  const finish=()=>{gesture=null;};
  for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,finish);
  handle.addEventListener('keydown',event=>{
    if(event.key==='Home'){position=null;layout();event.preventDefault();return;}
    const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];
    if(!delta)return;
    const area=stage.getBoundingClientRect(),box=card.getBoundingClientRect();
    position={x:box.left-area.left+delta[0],y:box.top-area.top+delta[1]};layout();event.preventDefault();
  });
  card.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
  if(typeof ResizeObserver!=='undefined'){
    const observer=new ResizeObserver(layout);observer.observe(stage);observer.observe(card);
  }
  window.addEventListener('resize',layout);
  return {hide,show(node){const scroll=content.scrollTop;content.replaceChildren(node);content.scrollTop=scroll;card.hidden=false;layout();}};
};
