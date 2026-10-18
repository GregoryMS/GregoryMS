(() => {
  'use strict';
  window.GregleMapLayers = ({ map, config, initial, notify, onChange }) => {
    const core = window.GregleMaps, $ = id => document.getElementById(id);
    const panel = $('map-layers-panel'), toggle = $('map-layers-toggle');
    const preferenceKey = 'gregle-maps-layers', credentialKey = 'gregle-maps-tomtom-key';
    let saved, apiKey = '';
    try { saved = JSON.parse(localStorage.getItem(preferenceKey)); apiKey = localStorage.getItem(credentialKey) || ''; } catch {}
    let state = core.normalizeLayers(initial || saved);
    const drivebc = window.GregleDriveBC({ map, notify });
    const cameras = window.GregleDriveBCCameras({ map, config, notify });
    const signs = window.GregleDriveBCSigns({ map, config, notify });
    const ferries = window.GregleDriveBCFerries({ map, config, notify });
    const googleTraffic = window.GregleGoogleTraffic({ map, config, notify });
    const aviation = window.GregleAviation({ map, config, notify, onForget: () => setState({ ...state, aviation: false }, true) });
    let baseLayer, maritimeLayer, trafficLayer, trafficTimer, lastTrafficRequest = 0, trafficPaused = false, trafficGood = false;
    const osmCredit = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
    const layerOptions = { maxZoom: 19, updateWhenIdle: true, keepBuffer: 1 };
    const persist = () => { try { localStorage.setItem(preferenceKey, JSON.stringify(state)); } catch {} };
    const status = (id, message, error = false) => {
      $(id).textContent = message;
      $(id).dataset.state = error ? 'error' : 'ready';
    };
    const openPanel = (keyForm = false) => {
      panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
      if (keyForm) {
        $('traffic-key-form').hidden = false;
        $('traffic-api-key').focus({ preventScroll: true });
      } else panel.querySelector('input:checked')?.focus({ preventScroll: true });
    };
    const closePanel = (restoreFocus = false) => {
      panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
      if (restoreFocus) toggle.focus();
    };
    const render = () => {
      panel.querySelectorAll('input[name="map-base"]').forEach(input => { input.checked = input.value === state.base; });
      $('map-maritime').checked = state.maritime;
      $('map-aviation').checked = state.aviation;
      $('map-drivebc').checked = state.drivebc;
      $('map-drivebc-cameras').checked = state.webcams;
      $('map-drivebc-future').checked = state.future;
      $('map-drivebc-future').disabled = !state.drivebc;
      $('map-drivebc-speed').checked = state.speed;
      $('map-drivebc-messages').checked = state.messages;
      $('map-drivebc-ferries').checked = state.ferries;
      $('map-traffic').checked = state.traffic;
      $('map-google-traffic').checked = state.google;
      $('maritime-layer-status').hidden = !state.maritime;
      $('drivebc-layer-status').hidden = !state.drivebc;
      $('drivebc-cameras-status').hidden = !state.webcams;
      $('drivebc-speed-status').hidden = !state.speed;
      $('drivebc-messages-status').hidden = !state.messages;
      $('drivebc-ferries-status').hidden = !state.ferries;
      $('traffic-connect').textContent = apiKey ? 'Manage key' : 'Connect TomTom';
      $('traffic-forget').hidden = !apiKey;
      $('traffic-refresh').hidden = !state.traffic || !apiKey;
      $('traffic-legend').hidden = !state.traffic || !trafficGood;
      if (!apiKey) status('traffic-layer-status', 'TomTom offers a free allowance; add your API key to connect.');
      else if (!state.traffic) status('traffic-layer-status', 'Connected in this browser. Turn on Traffic to display it.');
    };
    function changeBase() {
      if (baseLayer) map.removeLayer(baseLayer);
      const topographic = state.base === 'topographic';
      const layer = L.tileLayer(topographic ? config.topographicURL : config.tileURL, {
        ...layerOptions, maxNativeZoom: topographic ? 17 : 19,
        attribution: topographic ? `${osmCredit}, SRTM | &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA</a>)` : osmCredit
      });
      baseLayer = layer;
      let failed = 0, loaded = 0;
      layer.on('loading', () => {
        failed = 0; loaded = 0;
        if (layer === baseLayer) status('base-layer-status', `Loading ${topographic ? 'topographic' : 'street'} map…`);
      });
      layer.on('tileerror', () => { failed++; });
      layer.on('tileload', () => { loaded++; });
      layer.on('load', () => {
        if (layer !== baseLayer) return;
        if (failed && topographic && !loaded) {
          setTimeout(() => {
            if (layer !== baseLayer) return;
            state.base = 'street'; changeBase(); render(); persist(); onChange();
            notify('Topographic tiles are unavailable. Showing the street map instead.', 'layer');
          }, 0);
        } else if (failed) {
          status('base-layer-status', 'Some map tiles could not load. Try moving the map or switching layers.', true);
          notify('Some map tiles could not load. Try moving or zooming the map, or open OpenStreetMap.', 'map', true);
        } else {
          status('base-layer-status', topographic ? 'OpenTopoMap · contours and terrain' : 'OpenStreetMap · street map');
          if ($('map-notice').dataset.kind === 'map') $('map-notice').hidden = true;
        }
      });
      layer.setZIndex(1).addTo(map);
    }
    function changeMaritime() {
      if (maritimeLayer) { map.removeLayer(maritimeLayer); maritimeLayer = null; }
      if (!state.maritime) return;
      const layer = L.tileLayer(config.maritimeURL, {
        ...layerOptions, maxNativeZoom: 18, zIndex: 3,
        attribution: '&copy; <a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a> contributors'
      });
      maritimeLayer = layer;
      let failed = 0;
      layer.on('loading', () => { failed = 0; if (layer === maritimeLayer) status('maritime-layer-status', 'Loading maritime marks…'); });
      layer.on('tileerror', () => { failed++; });
      layer.on('load', () => {
        if (layer !== maritimeLayer) return;
        status('maritime-layer-status', failed ? 'Some maritime marks could not load. Try toggling this layer again.' : 'Buoys, lights and harbour marks where mapped. Depth charts are not included.', failed > 0);
        if (failed) notify('Some OpenSeaMap tiles could not load. Maritime coverage may be incomplete.', 'maritime');
      });
      layer.addTo(map);
    }
    // Fetch authenticated traffic tiles with a header so keys stay out of tile URLs and shared links.
    const TrafficTiles = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('img'); tile.alt = ''; tile.setAttribute('role', 'presentation');
        const controller = new AbortController(); tile.gregleAbort = controller;
        const timeout = setTimeout(() => controller.abort(), 12000);
        const key = this.options.trafficKey;
        let objectURL;
        const clean = () => { clearTimeout(timeout); if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; } };
        tile.gregleClean = clean;
        tile.onload = () => { clean(); done(null, tile); };
        tile.onerror = () => { clean(); done(new Error('Traffic tile unavailable'), tile); };
        const url = L.Util.template(this._url, coords);
        fetch(url, { headers: { 'TomTom-Api-Key': key }, credentials: 'omit', signal: controller.signal }).then(response => {
          if (!response.ok) { const error = new Error('Traffic request failed'); error.status = response.status; throw error; }
          return response.blob();
        }).then(blob => {
          if (controller.signal.aborted) return;
          if (blob.type !== 'image/png') throw new Error('Traffic returned an invalid tile');
          objectURL = URL.createObjectURL(blob); tile.src = objectURL;
        }).catch(error => {
          clean();
          // Leaflet has already discarded tiles removed by a pan, refresh or layer toggle.
          if (tile.gregleRemoved) return;
          done(error, tile);
        });
        return tile;
      }
    });
    function removeTraffic() {
      if (trafficLayer) { const old = trafficLayer; trafficLayer = null; map.removeLayer(old); }
      trafficGood = false;
    }
    function scheduleTraffic() {
      clearInterval(trafficTimer); trafficTimer = null;
      if (state.traffic && apiKey && !document.hidden && !trafficPaused) {
        trafficTimer = setInterval(() => { if (Date.now() - lastTrafficRequest >= 60000) loadTraffic(); }, 60000);
      }
    }
    function loadTraffic() {
      removeTraffic();
      if (!state.traffic || !apiKey || document.hidden) { render(); scheduleTraffic(); return; }
      const endpoint = new URL(config.trafficURL);
      if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.tomtom.com' || !endpoint.pathname.startsWith('/maps/orbis/traffic/flow/raster/tile/')) {
        trafficPaused = true; status('traffic-layer-status', 'Traffic is not configured for a TomTom endpoint.', true); scheduleTraffic(); return;
      }
      lastTrafficRequest = Date.now(); trafficPaused = false;
      status('traffic-layer-status', 'Loading TomTom traffic…');
      const layer = new TrafficTiles(config.trafficURL, {
        ...layerOptions, trafficKey: apiKey, zIndex: 4,
        attribution: '&copy; <a href="https://www.tomtom.com" target="_blank" rel="noopener">TomTom</a>'
      });
      trafficLayer = layer;
      let failed = 0, code = 0;
      layer.on('tileunload', event => { event.tile.gregleRemoved = true; event.tile.gregleAbort?.abort(); event.tile.gregleClean?.(); });
      layer.on('loading', () => {
        failed = 0; code = 0;
        if (layer === trafficLayer) { trafficGood = false; status('traffic-layer-status', 'Loading TomTom traffic…'); render(); }
      });
      layer.on('tileerror', event => { failed++; if (event.error?.status === 403 || event.error?.status === 429) code = event.error.status; });
      layer.on('load', () => {
        if (layer !== trafficLayer) return;
        if (failed) {
          trafficPaused = true; trafficGood = false;
          // Leaflet still reads this layer after dispatching load; detach on the next task.
          setTimeout(() => { if (layer === trafficLayer) { removeTraffic(); render(); } }, 0);
          status('traffic-layer-status', code === 403 ? 'TomTom declined this key. Check Traffic access and the allowed domain.' : code === 429 ? 'TomTom usage limit reached. Traffic is paused; try again later.' : 'Traffic could not load. Check your connection, key and allowed domain.', true);
          notify('TomTom traffic is unavailable. Open Layers to check the key or retry.', 'traffic');
        } else {
          trafficGood = true;
          const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          status('traffic-layer-status', `Tiles loaded ${time} · refreshes every minute while visible. Blank roads may have no coverage.`);
          if ($('map-notice').dataset.kind === 'traffic') $('map-notice').hidden = true;
        }
        render(); scheduleTraffic();
      });
      layer.addTo(map); scheduleTraffic(); render();
    }
    function setState(next, changed = false) {
      const previous = state; state = core.normalizeLayers(next);
      if (!baseLayer || previous.base !== state.base) changeBase();
      if (previous.maritime !== state.maritime || (state.maritime && !maritimeLayer)) changeMaritime();
      if (previous.aviation !== state.aviation) aviation.setEnabled(state.aviation);
      if (previous.drivebc !== state.drivebc) drivebc.setEnabled(state.drivebc);
      if (previous.future !== state.future) drivebc.setIncludeFuture(state.future);
      if (previous.speed !== state.speed) signs.setEnabled('speed', state.speed);
      if (previous.messages !== state.messages) signs.setEnabled('messages', state.messages);
      if (previous.ferries !== state.ferries) ferries.setEnabled(state.ferries);
      if (previous.webcams !== state.webcams) cameras.setEnabled(state.webcams);
      if (previous.google !== state.google) googleTraffic.setEnabled(state.google);
      if (previous.traffic !== state.traffic || (state.traffic && apiKey && !trafficLayer && !trafficPaused)) {
        if (state.traffic) loadTraffic(); else { removeTraffic(); trafficPaused = false; scheduleTraffic(); }
      }
      render();
      if (changed) { persist(); onChange(); }
    }
    toggle.addEventListener('click', () => { if (panel.hidden) openPanel(); else closePanel(); });
    $('close-map-layers').addEventListener('click', () => closePanel(true));
    document.addEventListener('click', event => { if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) closePanel(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); closePanel(true); }
    });
    panel.querySelectorAll('input[name="map-base"]').forEach(input => input.addEventListener('change', () => { if (input.checked) setState({ ...state, base: input.value }, true); }));
    $('map-maritime').addEventListener('change', () => setState({ ...state, maritime: $('map-maritime').checked }, true));
    $('map-aviation').addEventListener('change', () => {
      setState({ ...state, aviation: $('map-aviation').checked }, true);
      if (state.aviation && !aviation.hasKey()) aviation.openKey();
    });
    $('map-drivebc').addEventListener('change', () => setState({ ...state, drivebc: $('map-drivebc').checked }, true));
    $('map-drivebc-cameras').addEventListener('change', () => setState({ ...state, webcams: $('map-drivebc-cameras').checked }, true));
    $('map-drivebc-future').addEventListener('change', () => setState({ ...state, future: $('map-drivebc-future').checked }, true));
    $('map-drivebc-speed').addEventListener('change', () => setState({ ...state, speed: $('map-drivebc-speed').checked }, true));
    $('map-drivebc-messages').addEventListener('change', () => setState({ ...state, messages: $('map-drivebc-messages').checked }, true));
    $('map-drivebc-ferries').addEventListener('change', () => setState({ ...state, ferries: $('map-drivebc-ferries').checked }, true));
    $('map-google-traffic').addEventListener('change', () => setState({ ...state, google: $('map-google-traffic').checked }, true));
    $('map-traffic').addEventListener('change', () => {
      setState({ ...state, traffic: $('map-traffic').checked }, true);
      if (state.traffic && !apiKey) openPanel(true);
    });
    $('traffic-connect').addEventListener('click', () => openPanel(true));
    $('traffic-key-form').addEventListener('submit', event => {
      event.preventDefault();
      const key = $('traffic-api-key').value.trim();
      if (key.length < 16 || key.length > 256 || /\s/.test(key)) { status('traffic-layer-status', 'Enter a valid TomTom API key without spaces.', true); return; }
      apiKey = key; try { localStorage.setItem(credentialKey, key); } catch {}
      $('traffic-api-key').value = ''; $('traffic-key-form').hidden = true;
      state.traffic = true; trafficPaused = false; loadTraffic(); render(); persist(); onChange();
    });
    $('traffic-forget').addEventListener('click', () => {
      apiKey = ''; try { localStorage.removeItem(credentialKey); } catch {}
      $('traffic-api-key').value = ''; state.traffic = false;
      removeTraffic(); scheduleTraffic(); render(); persist(); onChange();
    });
    $('traffic-refresh').addEventListener('click', () => {
      if (Date.now() - lastTrafficRequest < 60000) { status('traffic-layer-status', 'Please wait a minute between traffic refreshes.'); return; }
      trafficPaused = false; loadTraffic();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (!trafficGood) removeTraffic();
        scheduleTraffic(); render();
      } else if (state.traffic && apiKey && !trafficPaused) {
        if (!trafficLayer || Date.now() - lastTrafficRequest >= 60000) loadTraffic();
        else scheduleTraffic();
      }
    });
    window.addEventListener('pagehide', () => { clearInterval(trafficTimer); removeTraffic(); });
    window.addEventListener('pageshow', event => { if (event.persisted && state.traffic && apiKey && !trafficPaused) loadTraffic(); });
    drivebc.setIncludeFuture(state.future);
    changeBase(); changeMaritime(); aviation.setEnabled(state.aviation); drivebc.setEnabled(state.drivebc); googleTraffic.setEnabled(state.google);
    cameras.setEnabled(state.webcams);
    signs.setEnabled('speed', state.speed); signs.setEnabled('messages', state.messages);
    ferries.setEnabled(state.ferries);
    if (state.traffic && apiKey) loadTraffic();
    render();
    if (state.traffic && !apiKey) openPanel(true);
    else if (state.aviation && !aviation.hasKey()) { openPanel(); aviation.openKey(); }
    return { getState: () => ({ ...state }), setState: next => setState(next, false) };
  };
})();
