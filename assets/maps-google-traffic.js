(() => {
  'use strict';
  window.GregleGoogleTraffic = ({ map, config, notify }) => {
    const $ = id => document.getElementById(id);
    const output = $('google-traffic-status');
    const slider = $('google-traffic-opacity'), percentage = $('google-traffic-percentage');
    const refreshButton = $('google-traffic-refresh');
    const refreshEvery = 300000, opacityKey = 'gregle-maps-google-opacity';
    let enabled = false, layer = null, timer, timeout, paused = false, lastRequest = 0, opacity = .75;
    try {
      const saved = localStorage.getItem(opacityKey), value = Number(saved);
      if (saved !== null && Number.isFinite(value) && value >= .2 && value <= 1) opacity = value;
    } catch {}
    const report = (message, error = false) => {
      output.textContent = message; output.dataset.state = error ? 'error' : 'ready';
    };
    const renderOpacity = () => { slider.value = String(opacity); percentage.value = `${Math.round(opacity * 100)}%`; };
    function remove() {
      clearTimeout(timeout); timeout = null;
      if (layer) { const old = layer; layer = null; map.removeLayer(old); }
    }
    function schedule() {
      clearInterval(timer); timer = null;
      if (enabled && !document.hidden && !paused) {
        timer = setInterval(() => { if (Date.now() - lastRequest >= refreshEvery) load(); }, refreshEvery);
      }
    }
    function fail(active) {
      if (active !== layer) return;
      paused = true; clearTimeout(timeout); schedule();
      report('Google traffic is unavailable. This experimental source may change. Retry or use another traffic layer.', true);
      refreshButton.textContent = 'Retry Google traffic';
      // Leaflet still reads its map after dispatching load; detach on the next task.
      setTimeout(() => { if (active === layer) remove(); }, 0);
      notify('Google traffic is unavailable. Open Layers to retry or choose another source.', 'google-traffic');
    }
    function load() {
      remove();
      if (!enabled || document.hidden) { schedule(); return; }
      paused = false; lastRequest = Date.now();
      refreshButton.textContent = 'Refresh Google traffic';
      report('Loading Google traffic…');
      // Experimental image-tile source described at anselms.net/blog/osmand+-and-traffic-data.html.
      // Images load directly; no API key, proxy, cross-origin fetch or routing service is involved.
      const active = L.tileLayer(`${config.googleTrafficURL}&t=${Math.floor(lastRequest / refreshEvery)}`, {
        maxZoom: 19, maxNativeZoom: 19, updateWhenIdle: true, keepBuffer: 1, opacity, zIndex: 5,
        className: 'google-traffic-layer',
        attribution: 'Traffic &copy; <a href="https://maps.google.com/" target="_blank" rel="noopener">Google</a> (experimental)'
      });
      layer = active;
      let failed = 0;
      active.on('loading', () => {
        if (active !== layer) return;
        failed = 0; report('Loading Google traffic…'); clearTimeout(timeout);
        timeout = setTimeout(() => fail(active), 15000);
      });
      active.on('tileerror', () => { failed++; });
      active.on('load', () => {
        if (active !== layer || paused) return;
        clearTimeout(timeout); timeout = null;
        if (failed) { fail(active); return; }
        const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        report(`Tiles loaded ${time} · refreshes every five minutes while visible. Blank roads may have no coverage.`);
        if ($('map-notice').dataset.kind === 'google-traffic') $('map-notice').hidden = true;
        schedule();
      });
      active.addTo(map); schedule();
    }
    function setEnabled(value) {
      const next = value === true;
      if (next === enabled) return;
      enabled = next; refreshButton.hidden = !enabled;
      if (enabled) {
        paused = false;
        if (document.hidden) report('Traffic will load when this page is visible.');
        load();
      } else {
        remove(); paused = false; schedule();
        report('Turn on Google traffic to display it.');
        refreshButton.textContent = 'Refresh Google traffic';
        if ($('map-notice').dataset.kind === 'google-traffic') $('map-notice').hidden = true;
      }
    }
    slider.addEventListener('input', () => {
      const value = Number(slider.value);
      if (!Number.isFinite(value)) return;
      opacity = Math.max(.2, Math.min(1, value)); renderOpacity(); layer?.setOpacity(opacity);
      try { localStorage.setItem(opacityKey, String(opacity)); } catch {}
    });
    refreshButton.addEventListener('click', () => {
      if (!enabled) return;
      if (!paused && Date.now() - lastRequest < refreshEvery) { report('Please wait five minutes between traffic refreshes.'); return; }
      load();
    });
    document.addEventListener('visibilitychange', () => {
      if (!enabled) return;
      if (document.hidden) { remove(); schedule(); }
      else if (!paused) load();
    });
    window.addEventListener('pagehide', () => { clearInterval(timer); remove(); });
    window.addEventListener('pageshow', event => { if (event.persisted && enabled && !paused) load(); });
    renderOpacity();
    return { setEnabled };
  };
})();
