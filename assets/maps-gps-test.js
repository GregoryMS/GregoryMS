'use strict';
(() => {
  // Optional GPS diagnostics for Tesla and other browsers. No coordinates leave this page.
  const settings = document.createElement('details');
  settings.className = 'gregle-car-settings'; settings.hidden = true;
  settings.innerHTML = '<summary aria-label="Car settings" title="Car settings"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-.6 2.2-1.8 1L4.4 6l-2 3.4L4 11v2l-1.6 1.6 2 3.4 2.2-.2 1.8 1L9 21h4l.6-2.2 1.8-1 2.2.2 2-3.4L18 13v-2l1.6-1.6-2-3.4-2.2.2-1.8-1L13 3Z"/><circle cx="11" cy="12" r="3"/></svg></summary><div class="gregle-car-settings-menu"><span id="gps-debug-label">GPS Debug</span><button type="button" id="gps-debug-toggle" role="switch" aria-checked="false" aria-labelledby="gps-debug-label"><span aria-hidden="true"></span></button></div>';
  const toggle = settings.querySelector('#gps-debug-toggle');
  const panel = document.createElement('section');
  panel.className = 'gregle-gps-panel';
  panel.hidden = true; panel.setAttribute('aria-label','GPS diagnostics');
  panel.style.cssText = 'position:fixed;right:12px;top:90px;z-index:1501;width:min(340px,calc(100vw - 24px));padding:16px;border-radius:14px;background:#201c2b;color:white;box-shadow:0 4px 24px #0008;font:14px/1.5 system-ui';
  panel.innerHTML = '<strong>Live GPS diagnostics</strong><p id="gregle-gps-state" role="status">Ready.</p><pre id="gregle-gps-data" style="white-space:pre-wrap;font:13px/1.6 monospace"></pre><button id="gregle-gps-close" type="button">Close</button><p style="font-size:12px;opacity:.8">Updates are displayed locally only. GPS may be unavailable in some Tesla browser versions.</p>';
  const carButton = document.getElementById('map-car-layout');
  if (carButton?.parentNode) {
    const controls = document.createElement('span'); controls.className = 'map-car-controls';
    carButton.before(controls); controls.append(carButton,settings);
  } else document.querySelector('.top-actions')?.prepend(settings);
  document.body.append(panel);
  function syncCarMode() {
    const enabled = document.body.classList.contains('vehicle-layout');
    settings.hidden = !enabled;
    if (!enabled) { settings.open = false; setDebug(false); }
  }
  new MutationObserver(syncCarMode).observe(document.body, {attributes:true,attributeFilter:['class']});
  const state=panel.querySelector('#gregle-gps-state'), data=panel.querySelector('#gregle-gps-data');
  let watch=null, count=0, last=0, generation=0;
  syncCarMode();
  function stop(){ generation++; if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;} state.textContent='Stopped'; }
  function setDebug(enabled) {
    toggle.setAttribute('aria-checked',String(enabled));
    panel.hidden = !enabled;
    if (enabled) start(); else stop();
  }
  toggle.addEventListener('click',()=>setDebug(toggle.getAttribute('aria-checked') !== 'true'));
  panel.querySelector('#gregle-gps-close').addEventListener('click',()=>setDebug(false));
  document.addEventListener('click',event=>{if(!settings.contains(event.target))settings.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && settings.open){settings.open=false;settings.querySelector('summary').focus();}});
  function start(){
    stop();count=0;last=0;data.textContent='';
    if(!window.isSecureContext || !navigator.geolocation?.watchPosition){state.textContent='Geolocation API unavailable (or insecure context).';return;}
    const token=generation;
    state.textContent='Requesting location permission…';
    try {
      watch=navigator.geolocation.watchPosition(p=>{
        if(token!==generation)return;
        const c=p.coords, now=Date.now(), gap=last?((now-last)/1000).toFixed(1)+' s':'first fix';
        last=now;count++;state.textContent='GPS active · '+count+' updates';
        data.textContent='Latitude: '+c.latitude.toFixed(6)+'\nLongitude: '+c.longitude.toFixed(6)+'\nAccuracy: '+Math.round(c.accuracy)+' m\nSpeed: '+(Number.isFinite(c.speed)?(c.speed*3.6).toFixed(1)+' km/h':'unavailable')+'\nHeading: '+(Number.isFinite(c.heading)?c.heading.toFixed(0)+'°':'unavailable')+'\nUpdate gap: '+gap+'\nFix age: '+(Number.isFinite(p.timestamp) && p.timestamp > 946684800000 && p.timestamp <= now + 60000 ? ((now-p.timestamp)/1000).toFixed(1)+' s' : 'unavailable (Tesla timestamp)' );
      },e=>{if(token!==generation)return;state.textContent='GPS error '+e.code+': '+e.message;}, {enableHighAccuracy:true,maximumAge:0,timeout:15000});
    } catch(e){state.textContent='GPS could not start: '+e.message;}
  }
  window.addEventListener('pagehide',()=>setDebug(false));
})();
