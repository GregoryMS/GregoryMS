(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.GregleWeatherTransparency=api.create(root);
})(globalThis,function() {
  'use strict';
  function create(win) {
    const key='gregle-weather-transparency';
    let transparency=40;
    try {
      const saved=win.localStorage.getItem(key);
      if(saved!==null && saved.trim()!=='' && Number.isFinite(Number(saved)))transparency=Math.max(0,Math.min(100,Number(saved)));
    } catch(_) {}
    const listeners=new Set();
    const opacity=()=>1-transparency/100;
    function attach(map,onChange) {
      const control=win.L.control({position:'topleft'});
      control.onAdd=()=>{
        const doc=win.document,container=doc.createElement('div');
        container.className='leaflet-control weather-transparency';
        const button=doc.createElement('button');
        button.type='button';button.className='weather-transparency-button';
        button.title='Precipitation transparency';
        button.setAttribute('aria-label','Precipitation transparency');
        button.setAttribute('aria-expanded','false');
        button.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/></svg>';
        const panel=doc.createElement('div');panel.className='weather-transparency-panel';
        panel.id=map.getContainer().id+'-transparency';
        button.setAttribute('aria-controls',panel.id);
        const inner=doc.createElement('div');inner.className='weather-transparency-inner';
        const label=doc.createElement('label');label.className='weather-transparency-label';
        const text=doc.createElement('span');text.textContent='Transparency';
        const output=doc.createElement('output');
        const input=doc.createElement('input');
        input.type='range';input.min='0';input.max='100';input.step='1';
        input.id=panel.id+'-range';label.htmlFor=input.id;output.htmlFor=input.id;
        label.append(text,output);inner.append(label,input);panel.append(inner);container.append(button,panel);
        let pinned=false,hovered=false,focused=false;
        function open(value) {
          container.classList.toggle('is-open',value);
          button.setAttribute('aria-expanded',String(value));
          panel.inert=!value;
        }
        function sync() {
          input.value=String(transparency);output.textContent=transparency+'%';
          input.setAttribute('aria-valuetext',transparency+'% transparent');
          onChange(opacity());
        }
        const update=()=>open(pinned || hovered || focused);
        container.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'){hovered=true;update();}});
        container.addEventListener('pointerleave',()=>{hovered=false;update();});
        // Keyboard users can tab from the button straight into the revealed slider.
        container.addEventListener('focusin',event=>{if(event.target!==button || button.matches(':focus-visible')){focused=true;update();}});
        container.addEventListener('focusout',event=>{if(!container.contains(event.relatedTarget)){focused=false;update();}});
        button.addEventListener('click',()=>{pinned=!pinned;focused=false;open(pinned);});
        input.addEventListener('input',()=>{
          transparency=Number(input.value);
          try {win.localStorage.setItem(key,String(transparency));} catch(_) {}
          for(const listener of listeners)listener();
        });
        container.addEventListener('keydown',event=>{
          event.stopPropagation();
          if(event.key==='Escape') {pinned=false;hovered=false;focused=false;button.focus();open(false);}
        });
        const outside=event=>{
          if(!container.contains(event.target)){pinned=false;focused=false;hovered=false;open(false);}
        };
        doc.addEventListener('pointerdown',outside);
        win.L.DomEvent.disableClickPropagation(container);
        win.L.DomEvent.disableScrollPropagation(container);
        listeners.add(sync);sync();open(false);
        control.onRemove=()=>{listeners.delete(sync);doc.removeEventListener('pointerdown',outside);};
        return container;
      };
      control.addTo(map);
      // Leaflet removes controls and their listeners with the map.
      return control;
    }
    return {attach,opacity};
  }
  return {create};
});
