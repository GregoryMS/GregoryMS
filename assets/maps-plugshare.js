(() => {
  'use strict';
  window.GreglePlugShare = ({ map }) => {
    const core = window.GregleMaps, $ = id => document.getElementById(id);
    const stage = document.querySelector('.map-stage'), host = $('plugshare-frame'), status = $('plugshare-status');
    const zoomHelp = $('plugshare-zoom-help');
    let enabled = false, frame, timer, helpTimer, viewKey;
    function remove() { clearTimeout(timer); clearTimeout(helpTimer); frame?.remove(); frame = null; viewKey = null; status.hidden = true; zoomHelp.hidden = true; }
    function preventPageZoom(event) {
      // Chromium routes trackpad pinches to the iframe element as Ctrl+wheel.
      // Only cancel gestures delivered to Gregle; ordinary scrolling and gestures
      // handled inside PlugShare remain with the provider.
      if (!enabled || !frame || event.target !== frame || (event.type === 'wheel' && !event.ctrlKey)) return;
      if (!event.cancelable) return;
      event.preventDefault();
      zoomHelp.hidden = false; clearTimeout(helpTimer);
      helpTimer = setTimeout(() => { zoomHelp.hidden = true; }, 6500);
    }
    host.addEventListener('wheel', preventPageZoom, { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) host.addEventListener(type, preventPageZoom, { passive: false });
    function load() {
      if (!enabled) return;
      const center = map.getCenter(), bounds = map.getBounds();
      const view = { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
      const key = core.makeHash(view);
      // Resizing the iframe must not reset a map the visitor has already moved inside PlugShare.
      if (frame && key === viewKey) return;
      remove(); viewKey = key;
      const visible = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
      $('plugshare-full-map').href = core.plugshareURL(view, visible);
      status.textContent = 'Loading PlugShare…'; status.hidden = false;
      const active = document.createElement('iframe');
      active.title = 'PlugShare EV charging stations'; active.allow = 'geolocation';
      active.referrerPolicy = 'strict-origin-when-cross-origin';
      active.addEventListener('load', () => { if (active === frame) { clearTimeout(timer); status.hidden = true; } });
      active.addEventListener('error', () => { if (active === frame) { clearTimeout(timer); status.textContent = 'PlugShare could not load. Try Open full map above or Change map.'; status.hidden = false; } });
      active.src = core.plugshareEmbedURL(view, visible); frame = active; host.append(active);
      timer = setTimeout(() => { if (active === frame) { status.textContent = 'PlugShare is taking longer to load. You can use Open full map above or Change map.'; status.hidden = false; } }, 20000);
    }
    function setEnabled(value) {
      const next = value === true;
      if (next === enabled) return;
      enabled = next; stage.classList.toggle('plugshare-active', enabled);
      $('plugshare-map').hidden = !enabled; $('gregle-map').inert = enabled;
      if (enabled) load(); else remove();
    }
    map.on('moveend', load);
    window.addEventListener('pagehide', remove);
    window.addEventListener('pageshow', event => { if (event.persisted) load(); });
    return { setEnabled };
  };
})();
