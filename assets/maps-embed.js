(() => {
  'use strict';
  window.GregleMapEmbed = ({ map }) => {
    const core = window.GregleMaps, $ = id => document.getElementById(id);
    const stage = document.querySelector('.map-stage'), host = $('embedded-frame'), status = $('embedded-status');
    const zoomHelp = $('embedded-zoom-help');
    const providers = {
      plugshare: { name: 'PlugShare', title: 'PlugShare EV charging stations', full: core.plugshareURL, embed: core.plugshareEmbedURL, allow: 'geolocation; fullscreen' },
      adsbexchange: { name: 'ADS-B Exchange', title: 'ADS-B Exchange live aircraft map', full: core.adsbExchangeURL, embed: core.adsbExchangeEmbedURL, allow: 'fullscreen' }
    };
    let base = null, frame, timer, helpTimer, viewKey;
    function remove() {
      clearTimeout(timer); clearTimeout(helpTimer); frame?.remove(); frame = null; viewKey = null;
      status.hidden = true; zoomHelp.hidden = true;
    }
    function preventPageZoom(event) {
      // Only cancel pinches routed to Gregle's frame element; provider map gestures stay inside the frame.
      if (!base || !frame || event.target !== frame || event.type === 'wheel' && !event.ctrlKey || !event.cancelable) return;
      event.preventDefault(); zoomHelp.hidden = false; clearTimeout(helpTimer);
      helpTimer = setTimeout(() => { zoomHelp.hidden = true; }, 6500);
    }
    host.addEventListener('wheel', preventPageZoom, { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) host.addEventListener(type, preventPageZoom, { passive: false });
    function load() {
      if (!base) return;
      const provider = providers[base], center = map.getCenter(), bounds = map.getBounds();
      const view = { lat: center.lat, lng: center.lng, zoom: map.getZoom() }, key = core.makeHash(view);
      // Keep the provider's independent pan/zoom when Gregle's container is resized.
      if (frame && key === viewKey) return;
      remove(); viewKey = key;
      const visible = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
      $('embedded-full-map').href = provider.full(view, visible);
      status.textContent = `Loading ${provider.name}…`; status.hidden = false;
      const active = document.createElement('iframe');
      active.title = provider.title; active.allow = provider.allow;
      active.referrerPolicy = 'strict-origin-when-cross-origin';
      active.addEventListener('load', () => { if (active === frame) { clearTimeout(timer); status.hidden = true; } });
      active.addEventListener('error', () => {
        if (active !== frame) return;
        clearTimeout(timer); status.textContent = `${provider.name} could not load. Try Open full map above or Change map.`; status.hidden = false;
      });
      active.src = provider.embed(view, visible); frame = active; host.append(active);
      timer = setTimeout(() => {
        if (active === frame) { status.textContent = `${provider.name} is taking longer to load. You can use Open full map above or Change map.`; status.hidden = false; }
      }, 20000);
    }
    function setBase(value) {
      const next = core.isEmbeddedBase(value) ? value : null;
      if (next === base) return;
      remove(); base = next;
      stage.classList.toggle('embedded-active', !!base);
      $('embedded-map').hidden = !base; $('gregle-map').inert = !!base;
      if (!base) return;
      $('embedded-title').textContent = providers[base].name;
      $('embedded-map').setAttribute('aria-label', providers[base].title);
      zoomHelp.textContent = `Use two-finger scrolling or the map’s zoom controls to zoom ${providers[base].name}.`;
      load();
    }
    map.on('moveend', load);
    window.addEventListener('pagehide', remove);
    window.addEventListener('pageshow', event => { if (event.persisted) load(); });
    return { setBase };
  };
})();
