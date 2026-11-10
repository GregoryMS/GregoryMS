'use strict';
(() => {
  // Optional GPS diagnostics for Tesla and other browsers. No coordinates leave this page.
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'GPS';
  button.className = 'gregle-gps-button'; button.hidden = true;
  button.setAttribute('aria-label','Test live browser GPS');
  button.style.cssText = 'margin-left:6px;padding:6px 9px;border:1px solid currentColor;border-radius:9px;background:transparent;color:inherit;font:600 12px system-ui;cursor:pointer';
  const panel = document.createElement('section');
  panel.hidden = true; panel.setAttribute('aria-label','GPS diagnostics');
  panel.style.cssText = 'position:fixed;right:12px;top:90px;z-index:1501;width:min(340px,calc(100vw - 24px));padding:16px;border-radius:14px;background:#201c2b;color:white;box-shadow:0 4px 24px #0008;font:14px/1.5 system-ui';
  panel.innerHTML = '<strong>Live GPS diagnostics</strong><p id="gregle-gps-state" role="status">Ready. Tap Start GPS.</p><pre id="gregle-gps-data" style="white-space:pre-wrap;font:13px/1.6 monospace"></pre><button id="gregle-gps-start" type="button">Start GPS</button> <button id="gregle-gps-stop" type="button">Stop</button> <button id="gregle-gps-close" type="button">Close</button><p style="font-size:12px;opacity:.8">Updates are displayed locally only. GPS may be unavailable in some Tesla browser versions.</p>';
  const carButton = document.getElementById('map-car-layout');
  if (carButton?.parentNode) carButton.after(button); else document.querySelector('.top-actions')?.prepend(button);
  document.body.append(panel);
  function syncCarMode() {
    const enabled = document.body.classList.contains('vehicle-layout');
    button.hidden = !enabled;
    if (!enabled) { stop(); panel.hidden = true; }
  }
  new MutationObserver(syncCarMode).observe(document.body, {attributes:true,attributeFilter:['class']});
  const state=panel.querySelector('#gregle-gps-state'), data=panel.querySelector('#gregle-gps-data');
  let watch=null, count=0, last=0;
  syncCarMode();
  function stop(){ if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;} state.textContent='Stopped'; }
  button.addEventListener('click',()=>{panel.hidden=!panel.hidden;});
  panel.querySelector('#gregle-gps-close').addEventListener('click',()=>{stop();panel.hidden=true;});
  panel.querySelector('#gregle-gps-stop').addEventListener('click',stop);
  panel.querySelector('#gregle-gps-start').addEventListener('click',()=>{
    stop();count=0;last=0;data.textContent='';
    if(!window.isSecureContext || !navigator.geolocation?.watchPosition){state.textContent='Geolocation API unavailable (or insecure context).';return;}
    state.textContent='Requesting location permission…';
    try {
      watch=navigator.geolocation.watchPosition(p=>{
        const c=p.coords, now=Date.now(), gap=last?((now-last)/1000).toFixed(1)+' s':'first fix';
        last=now;count++;state.textContent='GPS active · '+count+' updates';
        data.textContent='Latitude: '+c.latitude.toFixed(6)+'\nLongitude: '+c.longitude.toFixed(6)+'\nAccuracy: '+Math.round(c.accuracy)+' m\nSpeed: '+(Number.isFinite(c.speed)?(c.speed*3.6).toFixed(1)+' km/h':'unavailable')+'\nHeading: '+(Number.isFinite(c.heading)?c.heading.toFixed(0)+'°':'unavailable')+'\nUpdate gap: '+gap+'\nFix age: '+(Number.isFinite(p.timestamp) && p.timestamp > 946684800000 && p.timestamp <= now + 60000 ? ((now-p.timestamp)/1000).toFixed(1)+' s' : 'unavailable (Tesla timestamp)' );
      },e=>{state.textContent='GPS error '+e.code+': '+e.message;}, {enableHighAccuracy:true,maximumAge:0,timeout:15000});
    } catch(e){state.textContent='GPS could not start: '+e.message;}
  });
  window.addEventListener('pagehide',stop);
})();
