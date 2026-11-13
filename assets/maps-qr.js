'use strict';
// Generate QR codes locally; the selected coordinates never go to a QR service.
window.GregleMapQR = () => {
  const $ = id => document.getElementById(id), dialog = $('map-qr-dialog'), core = window.GregleMaps;
  let library, generation = 0;
  function loadEncoder() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!library) library = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'assets/qrcode-generator.js?v=1.4.4';
      const timer = setTimeout(() => { script.remove(); library = null; reject(Error('QR encoder unavailable')); }, 10000);
      script.onload = () => { clearTimeout(timer); if (window.qrcode) resolve(window.qrcode); else { library = null; reject(Error('QR encoder unavailable')); } };
      script.onerror = () => { clearTimeout(timer); script.remove(); library = null; reject(Error('QR encoder unavailable')); };
      document.head.append(script);
    });
    return library;
  }
  $('map-qr-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; $('gregle-map').focus({preventScroll:true}); });
  return async point => {
    const lng = core.wrapLongitude(point.lng), lat = point.lat;
    if (!core.validPoint(lat, lng)) return;
    const token = ++generation, url = new URL('https://maps.gregle.uk/');
    url.hash = core.makeHash({lat, lng, zoom:16}, {lat, lng, name:'Dropped pin'});
    $('map-qr-link').href = url.href; $('map-qr-link').textContent = 'Open this location ↗';
    $('map-qr-coordinates').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    $('map-qr-code').replaceChildren(); $('map-qr-status').textContent = 'Generating QR code…';
    if (!dialog.open) dialog.showModal(); $('map-qr-heading').focus({preventScroll:true});
    try {
      const encode = await loadEncoder(); if (token !== generation || !dialog.open) return;
      const qr = encode(0, 'M'); qr.addData(url.href, 'Byte'); qr.make();
      const n = qr.getModuleCount(), ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns,'svg'); svg.setAttribute('viewBox',`-4 -4 ${n+8} ${n+8}`);
      svg.setAttribute('role','img'); svg.setAttribute('aria-label','QR code for the selected map location');
      const background = document.createElementNS(ns,'rect');
      for (const [key,value] of Object.entries({x:-4,y:-4,width:n+8,height:n+8,fill:'#fff'})) background.setAttribute(key,String(value));
      let data = ''; for(let y=0;y<n;y++) for(let x=0;x<n;x++) if(qr.isDark(y,x)) data+=`M${x},${y}h1v1h-1z`;
      const path = document.createElementNS(ns,'path'); path.setAttribute('d',data); path.setAttribute('fill','#000');
      svg.append(background,path); $('map-qr-code').append(svg); $('map-qr-status').textContent = 'Scan to open this location in Gregle Maps.';
    } catch { if (token === generation && dialog.open) $('map-qr-status').textContent = 'QR code could not load. Close and reopen to retry, or use the location link below.'; }
  };
};
