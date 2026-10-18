(() => {
  'use strict';
  window.GregleAviation = ({ map, config, notify, onForget }) => {
    const $ = id => document.getElementById(id), storageKey = 'gregle-maps-openaip-key';
    let key = '', enabled = false, layer, paused = false, retryAt = 0, hidden = false;
    let queue = [], active = 0, timer, nextTile = 0;
    const pending = new Set();
    try { key = localStorage.getItem(storageKey) || ''; } catch {}
    const report = (message, error = false) => { $('aviation-layer-status').textContent = message; $('aviation-layer-status').dataset.state = error ? 'error' : 'ready'; };
    function render() {
      $('aviation-layer-status').hidden = !enabled;
      $('aviation-options').hidden = !enabled;
      $('aviation-connect').textContent = key ? 'Manage OpenAIP key' : 'Connect OpenAIP';
      $('aviation-forget').hidden = !key;
      $('aviation-retry').hidden = !enabled || !key || !paused;
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
      notify('Aviation charts are unavailable. Open Layers to check the OpenAIP key or retry.', 'aviation');
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
      fetch(owner.getTileUrl(coords), { credentials: 'omit', headers: { 'x-openaip-api-key': key }, signal: controller.signal }).then(response => {
        if (tile.removed || owner !== layer) return null;
        if (!response.ok) {
          fail(response.status === 401 || response.status === 403 ? 'OpenAIP declined this key. Check the key and its Tiles API access.' : response.status === 429 ? 'OpenAIP rate limit reached. Charts are paused; wait at least a minute before retrying.' : 'OpenAIP charts could not load. Try again later.', response);
          return null;
        }
        return response.blob();
      }).then(blob => {
        if (!blob || controller.signal.aborted || tile.removed || owner !== layer) return;
        if (blob.type.split(';')[0] !== 'image/png') throw new Error('Invalid aviation chart tile');
        objectURL = URL.createObjectURL(blob); tile.src = objectURL;
      }).catch(() => {
        if (!tile.removed && owner === layer) fail('Aviation charts could not load. Check your connection and OpenAIP key, then retry.');
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
      if (!key) { report('Add your OpenAIP API key to display aviation charts.'); return; }
      if (document.hidden || hidden) return;
      if (Date.now() < retryAt) { paused = true; report(`Please wait ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before retrying aviation charts.`, true); render(); return; }
      let endpoint;
      try { endpoint = new URL(config.aviationURL); } catch {}
      if (!endpoint || endpoint.origin !== 'https://api.tiles.openaip.net' || endpoint.username || endpoint.password || !endpoint.pathname.startsWith('/api/data/openaip/') || endpoint.search || endpoint.hash) {
        paused = true; report('Aviation charts need the official OpenAIP Tiles API endpoint.', true); render(); return;
      }
      report(map.getZoom() < 4 ? 'Zoom in to see aviation charts.' : 'Loading OpenAIP aviation charts…');
      const current = new AviationTiles(config.aviationURL, {
        minZoom: 4, maxZoom: 19, maxNativeZoom: 14, tms: true,
        updateWhenIdle: true, keepBuffer: 0, zIndex: 6, className: 'gregle-aviation-layer',
        attribution: '<a href="https://www.openaip.net/" target="_blank" rel="noopener">OpenAIP</a> (<a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener">CC BY-NC 4.0</a>)'
      });
      layer = current;
      current.on('tileunload', event => cancelTile(event.tile));
      current.on('loading', () => { if (current === layer && !paused) report('Loading OpenAIP aviation charts…'); });
      current.on('load', () => { if (current === layer && !paused) report('OpenAIP · airports, airspace and navigation aids where available. For reference only.'); });
      current.addTo(map);
    }
    function openKey() {
      $('aviation-key-form').hidden = false;
      $('aviation-api-key').focus({ preventScroll: true });
      $('aviation-key-form').scrollIntoView({ block: 'nearest' });
    }
    function retry() {
      if (Date.now() < retryAt) { report(`Please wait ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before retrying aviation charts.`, true); return; }
      paused = false; load();
    }
    $('aviation-connect').addEventListener('click', openKey);
    $('aviation-retry').addEventListener('click', retry);
    $('aviation-key-form').addEventListener('submit', event => {
      event.preventDefault(); const next = $('aviation-api-key').value.trim();
      if (next.length < 16 || next.length > 2048 || /\s/.test(next)) { report('Enter a valid OpenAIP API key without spaces.', true); return; }
      const changed = next !== key; key = next;
      try { localStorage.setItem(storageKey, key); } catch {}
      $('aviation-api-key').value = ''; $('aviation-key-form').hidden = true;
      if (changed && Date.now() >= retryAt) paused = false;
      if (!paused) load(); else retry();
      render();
    });
    $('aviation-forget').addEventListener('click', () => {
      key = ''; try { localStorage.removeItem(storageKey); } catch {}
      $('aviation-api-key').value = ''; $('aviation-key-form').hidden = true;
      paused = false; enabled = false; remove(); render(); onForget();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) remove(); else if (enabled && key && !paused) load(); });
    window.addEventListener('pagehide', () => { hidden = true; remove(); });
    window.addEventListener('pageshow', event => { hidden = false; if (event.persisted && enabled && key && !paused) load(); });
    map.on('zoomend', () => { if (enabled && key && !paused && map.getZoom() < 4) report('Zoom in to see aviation charts.'); });
    render();
    return { setEnabled(value) { enabled = value === true; if (enabled && paused) { render(); return; } load(); }, hasKey: () => !!key, openKey };
  };
})();
