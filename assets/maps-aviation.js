(() => {
  'use strict';
  window.GregleAviation = ({ map, config, notify }) => {
    const $ = id => document.getElementById(id);
    const opacityKey = 'gregle-maps-aviation-opacity';
    let opacity = 0.85;
    let enabled = false, layer, paused = false, retryAt = 0, hidden = false;
    let queue = [], active = 0, timer, nextTile = 0;
    const pending = new Set();
    // Remove credentials saved by the previous direct-to-provider integration.
    try { localStorage.removeItem('gregle-maps-openaip-key'); } catch {}
    try {
      const saved = localStorage.getItem(opacityKey), value = Number(saved);
      if (saved && Number.isFinite(value) && value >= 0.2 && value <= 1) opacity = value;
    } catch {}
    function updateReference() {
      const center = map.getCenter(), longitude = ((center.lng + 180) % 360 + 360) % 360 - 180;
      $('aviation-full-map').href = `https://www.openaip.net/map#${map.getZoom().toFixed(2)}/${center.lat.toFixed(5)}/${longitude.toFixed(5)}`;
    }
    const report = (message, error = false) => { $('aviation-layer-status').textContent = message; $('aviation-layer-status').dataset.state = error ? 'error' : 'ready'; };
    function render() {
      $('aviation-layer-status').hidden = !enabled;
      $('aviation-options').hidden = !enabled;
      $('aviation-retry').hidden = !enabled || !paused;
      $('aviation-opacity').value = String(opacity);
      $('aviation-percentage').textContent = `${Math.round(opacity * 100)}%`;
    }
    function cancelTile(tile) {
      tile.removed = true; tile.controller?.abort(); tile.cleanup?.();
      pending.delete(tile);
    }
    function remove() {
      clearTimeout(timer); timer = null; queue = [];
      const old = layer; layer = null;
      if (old) map.removeLayer(old);
      for (const tile of pending) cancelTile(tile);
    }
    function fail(message, response) {
      if (paused) return;
      paused = true;
      const retry = response?.headers.get('Retry-After');
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      retryAt = Math.max(retryAt, Date.now() + Math.max(response?.status === 429 ? 60000 : 15000, Number.isFinite(delay) ? delay : 0));
      clearTimeout(timer); timer = null; queue = [];
      for (const tile of pending) cancelTile(tile);
      report(message, true); render();
      // Leaflet reads the layer again after its tile callbacks return.
      setTimeout(() => { if (paused) remove(); }, 0);
      notify('Aviation charts are unavailable. Open Layers to retry.', 'aviation');
    }
    function pump() {
      clearTimeout(timer); timer = null;
      queue = queue.filter(job => !job.tile.removed && job.owner === layer);
      if (!queue.length || active >= 3 || !enabled || paused || document.hidden || hidden) return;
      if (Date.now() < nextTile) { timer = setTimeout(pump, nextTile - Date.now()); return; }
      const job = queue.shift(), { tile, done, owner, coords } = job;
      active++; nextTile = Date.now() + 200;
      const controller = new AbortController(); tile.controller = controller;
      let objectURL, completed = false;
      const timeout = setTimeout(() => controller.abort(), 12000);
      const cleanup = () => { clearTimeout(timeout); if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; } };
      tile.cleanup = cleanup;
      const finish = error => {
        cleanup(); pending.delete(tile);
        if (completed || tile.removed || owner !== layer) return;
        completed = true; done(error, tile);
      };
      tile.onload = () => finish(null);
      tile.onerror = () => { if (tile.removed || owner !== layer) return; finish(new Error('Aviation tile unavailable')); fail('An aviation chart image could not load. Retry the layer.'); };
      fetch(owner.getTileUrl(coords), { credentials: 'omit', signal: controller.signal }).then(response => {
        if (tile.removed || owner !== layer) return null;
        if (!response.ok) {
          fail(response.status === 401 || response.status === 403 ? 'Aviation charts are temporarily unavailable. Try again later.' : response.status === 429 ? 'OpenAIP rate limit reached. Charts are paused; wait at least a minute before retrying.' : 'OpenAIP charts could not load. Try again later.', response);
          return null;
        }
        // The API returns 204 for empty/out-of-range tiles, not a PNG body.
        if (response.status === 204) {
          tile.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          return null;
        }
        return response.blob();
      }).then(blob => {
        if (!blob || controller.signal.aborted || tile.removed || owner !== layer) return;
        if (blob.type.split(';')[0] !== 'image/png') throw new Error('Invalid aviation chart tile');
        objectURL = URL.createObjectURL(blob); tile.src = objectURL;
      }).catch(() => {
        if (!tile.removed && owner === layer) fail('Aviation charts could not load. Check your connection, then retry.');
      }).finally(() => { active--; pump(); });
      pump();
    }
    const AviationTiles = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('img'); tile.alt = ''; tile.setAttribute('role', 'presentation');
        pending.add(tile); queue.push({ tile, coords, done, owner: this });
        if (!timer) timer = setTimeout(pump, 0);
        return tile;
      }
    });
    function load() {
      remove(); render();
      if (!enabled) return;
      if (document.hidden || hidden) return;
      if (Date.now() < retryAt) { paused = true; report(`Please wait ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before retrying aviation charts.`, true); render(); return; }
      let endpoint;
      try { endpoint = new URL(config.aviationURL); } catch {}
      if (!endpoint || endpoint.origin !== 'https://gregle-aviation.square-rain-5ded.workers.dev' || endpoint.username || endpoint.password || endpoint.pathname !== '/tiles/%7Bz%7D/%7Bx%7D/%7By%7D.png' || endpoint.search || endpoint.hash) {
        paused = true; report('Aviation charts need the Gregle aviation service.', true); render(); return;
      }
      report(map.getZoom() < 2 ? 'Zoom in to see aviation charts.' : 'Loading OpenAIP aviation charts…');
      const current = new AviationTiles(config.aviationURL, {
        // OpenAIP's current PNG endpoint uses XYZ rows (north to south).
        // Flipping Y requests a different hemisphere's chart at this location.
        minZoom: 2, maxZoom: 19, maxNativeZoom: 14, tms: false, opacity,
        updateWhenIdle: true, keepBuffer: 0, zIndex: 6, className: 'gregle-aviation-layer',
        attribution: '<a href="https://www.openaip.net/" target="_blank" rel="noopener">OpenAIP</a> (<a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener">CC BY-NC 4.0</a>)'
      });
      layer = current;
      current.on('tileunload', event => cancelTile(event.tile));
      current.on('loading', () => { if (current === layer && !paused) report('Loading OpenAIP aviation charts…'); });
      current.on('load', () => { if (current === layer && !paused) report('OpenAIP · airports, airspace and navigation aids where available. For reference only.'); });
      current.addTo(map);
    }
    function retry() {
      if (Date.now() < retryAt) { report(`Please wait ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before retrying aviation charts.`, true); return; }
      paused = false; load();
    }
    $('aviation-retry').addEventListener('click', retry);
    $('aviation-opacity').addEventListener('input', () => {
      const value = Number($('aviation-opacity').value);
      if (!Number.isFinite(value) || value < 0.2 || value > 1) return;
      opacity = value; layer?.setOpacity(opacity);
      try { localStorage.setItem(opacityKey, String(opacity)); } catch {}
      render();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) remove(); else if (enabled && !paused) load(); });
    window.addEventListener('pagehide', () => { hidden = true; remove(); });
    window.addEventListener('pageshow', event => { hidden = false; if (event.persisted && enabled && !paused) load(); });
    map.on('zoomend', () => { if (enabled && !paused && map.getZoom() < 2) report('Zoom in to see aviation charts.'); });
    map.on('moveend', updateReference);
    updateReference(); render();
    return { setEnabled(value) { enabled = value === true; if (enabled && paused) { render(); return; } load(); } };
  };
})();
