(() => {
  'use strict';
  window.GregleMapEmbed = ({ map }) => {
    const core = window.GregleMaps, $ = id => document.getElementById(id);
    const stage = document.querySelector('.map-stage'), host = $('embedded-frame'), status = $('embedded-status');
    const zoomHelp = $('embedded-zoom-help');
    const providers = {
      '3d': { name: '3D', title: 'OpenFreeMap 3D map', full: view => '/assets/maps-3d.html?v=20261113-aircraft-card' + core.makeHash(view), embed: view => '/assets/maps-3d.html?v=20261113-aircraft-card' + core.makeHash(view), allow: 'geolocation; fullscreen' },
      plugshare: { name: 'PlugShare', title: 'PlugShare EV charging stations', full: core.plugshareURL, embed: core.plugshareEmbedURL, allow: 'geolocation; fullscreen' },
      shademap: { name: 'ShadeMap', title: 'ShadeMap sunlight and shadow map', full: core.shadeMapURL, embed: core.shadeMapURL, allow: 'fullscreen' },
      adsbexchange: { name: 'ADS-B Exchange', title: 'ADS-B Exchange live aircraft map', full: core.adsbExchangeURL, embed: core.adsbExchangeEmbedURL, allow: 'fullscreen' }
    };
    let base = null, frame, timer, helpTimer, viewKey;
    const bridge = window.Gregle3DOverlayBridge?.({map, send: message => frame?.contentWindow?.postMessage(message, location.origin)});
    function remove() {
      bridge?.stop();
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
      active.addEventListener('load', () => { if (active === frame) { clearTimeout(timer); status.hidden = true; if (base === '3d') bridge?.start(); } });
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
    window.addEventListener('message', event => {
      if (base !== '3d' || event.source !== frame?.contentWindow || event.origin !== location.origin || !['gregle-3d-view','gregle-3d-select'].includes(event.data?.type)) return;
      if (event.data.type === 'gregle-3d-select') { bridge?.select(event.data); return; }
      const view = event.data.view;
      if (!core.validPoint(view?.lat, view?.lng) || !Number.isFinite(view?.zoom) || view.zoom < 2 || view.zoom > 19) return;
      viewKey = core.makeHash(view);
      map.setView([view.lat, view.lng], view.zoom, {animate:false});
    });
    map.on('moveend', load);
    window.addEventListener('pagehide', remove);
    window.addEventListener('pageshow', event => { if (event.persisted) load(); });
    return { setBase };
  };
})();
