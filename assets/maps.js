(async () => {
  'use strict';
  const core = window.GregleMaps;
  const $ = id => document.getElementById(id);
  const defaults = {
    tileURL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', searchURL: 'https://photon.komoot.io/api/',
    topographicURL: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png', maritimeURL: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    trafficURL: 'https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=light&tileSize=256'
  };
  const searchContent = $('map-search-content'), resultsList = $('map-results'), query = $('map-query');
  let map, layerControl, marker, accuracy, selected = null, searchController, searchVersion = 0, intent = 0, nextSearch = 0, noticeTimer;
  const cache = new Map();
  const notify = (message, kind = 'action', persistent = false) => {
    clearTimeout(noticeTimer);
    $('map-notice').textContent = message;
    $('map-notice').dataset.kind = kind;
    $('map-notice').hidden = false;
    if (!persistent) noticeTimer = setTimeout(() => { $('map-notice').hidden = true; }, 6500);
  };
  const view = () => {
    const center = map.getCenter();
    return { lat: center.lat, lng: core.wrapLongitude(center.lng), zoom: map.getZoom() };
  };
  const updateURL = () => {
    const current = view();
    try { history.replaceState(null, '', core.makeHash(current, selected, layerControl?.getState())); } catch {}
    $('osm-link').href = core.osmURL(current, selected);
  };
  const hideSearch = () => { searchContent.hidden = true; };
  const cancelSearch = () => {
    searchVersion++;
    searchController?.abort();
    searchController = null;
    resultsList.replaceChildren();
    $('map-search-form').removeAttribute('aria-busy');
  };
  function renderPin(point) {
    selected = point;
    if (marker) { map.removeLayer(marker); marker = null; }
    if (accuracy) { map.removeLayer(accuracy); accuracy = null; }
    $('clear-pin').hidden = !point;
    $('place-bottom').hidden = !point;
    $('place-kicker').textContent = point ? 'On the map' : 'A world to explore';
    $('place-name').textContent = point?.name || 'Explore from here.';
    $('place-detail').textContent = point?.detail || (point ? 'Copy the link to save or share this place.' : 'Find a favourite place, or tap the map to drop a pin.');
    $('place-coordinates').textContent = point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : '';
    if (point) {
      const icon = L.divIcon({ className: 'gregle-map-pin', iconSize: [38, 46], iconAnchor: [19, 44], html: '<svg viewBox="0 0 38 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M19 2C9.6 2 2 9.6 2 19c0 11 17 25 17 25s17-14 17-25C36 9.6 28.4 2 19 2Z" fill="#7637cc" stroke="#fff" stroke-width="2.5"/><circle cx="19" cy="18" r="6" fill="#fff"/></svg>' });
      marker = L.marker([point.lat, point.lng], { icon, title: point.name, alt: 'Map pin', keyboard: true }).addTo(map);
    }
  }
  function selectPoint(point, zoom = 16) {
    intent++;
    cancelSearch(); hideSearch();
    renderPin(point);
    map.setView([Math.max(-85.051129, Math.min(85.051129, point.lat)), point.lng], zoom);
    updateURL();
    $('gregle-map').focus({ preventScroll: true });
  }
  function showResults(results) {
    resultsList.replaceChildren();
    $('map-search-status').textContent = results.length ? `${results.length} ${results.length === 1 ? 'place' : 'places'} found` : 'No places found. Try a town, postcode or a more complete address.';
    $('osm-search').hidden = results.length > 0;
    for (const point of results) {
      const li = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      const name = document.createElement('strong'), detail = document.createElement('span');
      name.textContent = point.name; detail.textContent = point.detail;
      button.append(name, detail); li.append(button); resultsList.append(li);
      button.addEventListener('click', () => selectPoint(point, point.zoom));
    }
  }
  async function share() {
    const url = new URL(location.pathname, location.origin);
    url.hash = core.makeHash(view(), selected, layerControl?.getState());
    try {
      await navigator.clipboard.writeText(url.href);
      notify(selected ? 'Link to this pin copied.' : 'Link to this map copied.');
    } catch {
      $('map-link-copy').hidden = false;
      $('map-link-input').value = url.href;
      $('map-link-input').focus(); $('map-link-input').select();
    }
  }
  const controls = [$('map-locate'), $('map-share'), $('map-query'), $('map-layers-toggle'), document.querySelector('.map-search-submit')];
  controls.forEach(control => { control.disabled = true; });
  if (!window.L || !core || !window.GregleMapLayers || !window.GregleDriveBC) {
    notify('The map could not load. Use the OpenStreetMap link above to keep exploring.', 'map', true);
    return;
  }
  let config = { ...defaults };
  try {
    const response = await fetch('assets/maps-config.json?v=20261017-layers', { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const supplied = await response.json();
      for (const key of Object.keys(defaults)) if (typeof supplied[key] === 'string' && supplied[key].startsWith('https://')) config[key] = supplied[key];
    }
  } catch {}
  const initial = core.readHash(location.hash);
  map = L.map('gregle-map', { zoomControl: false, minZoom: 2, maxZoom: 19, worldCopyJump: true }).setView([initial.view.lat, initial.view.lng], initial.view.zoom);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 110 }).addTo(map);
  layerControl = window.GregleMapLayers({ map, config, initial: core.readLayers(location.hash), notify, onChange: updateURL });
  renderPin(initial.pin); updateURL();
  controls.forEach(control => { control.disabled = false; });
  map.on('moveend', updateURL);
  map.on('dragstart zoomstart', () => { intent++; });
  map.on('click', event => {
    const point = { lat: event.latlng.lat, lng: core.wrapLongitude(event.latlng.lng), name: 'Dropped pin', detail: 'A place to come back to. Copy the link to save or share it.' };
    if (core.validPoint(point.lat, point.lng)) { intent++; cancelSearch(); hideSearch(); renderPin(point); updateURL(); }
  });
  window.addEventListener('hashchange', () => {
    intent++; cancelSearch(); hideSearch();
    const state = core.readHash(location.hash);
    const layers = core.readLayers(location.hash);
    if (layers) layerControl.setState(layers);
    renderPin(state.pin); map.setView([state.view.lat, state.view.lng], state.view.zoom); updateURL();
  });
  $('map-search-form').addEventListener('submit', async event => {
    event.preventDefault();
    const term = query.value.trim();
    if (term.length < 2) { query.focus(); return; }
    intent++; cancelSearch();
    const version = searchVersion;
    const fallback = new URL('https://www.openstreetmap.org/search'); fallback.searchParams.set('query', term);
    $('osm-search').href = fallback.href; $('osm-search').hidden = true;
    searchContent.hidden = false;
    const key = term.toLocaleLowerCase();
    if (cache.has(key)) { showResults(cache.get(key)); return; }
    if (Date.now() < nextSearch) { $('map-search-status').textContent = 'Please wait a moment, then search again.'; return; }
    nextSearch = Date.now() + 1000;
    searchController = new AbortController();
    const controller = searchController;
    const timer = setTimeout(() => controller.abort(), 10000);
    $('map-search-form').setAttribute('aria-busy', 'true');
    $('map-search-status').textContent = 'Finding places…';
    try {
      const url = new URL(config.searchURL); url.searchParams.set('q', term); url.searchParams.set('limit', '6'); url.searchParams.set('lang', 'en');
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Search unavailable');
      const results = core.readResults(await response.json());
      if (version !== searchVersion) return;
      if (cache.size >= 30) cache.delete(cache.keys().next().value);
      cache.set(key, results); showResults(results);
    } catch {
      if (version !== searchVersion) return;
      $('map-search-status').textContent = 'Place search is unavailable right now. Try again or search on OpenStreetMap.';
      $('osm-search').hidden = false;
    } finally {
      clearTimeout(timer);
      if (version === searchVersion) { searchController = null; $('map-search-form').removeAttribute('aria-busy'); }
    }
  });
  query.addEventListener('input', () => { intent++; cancelSearch(); hideSearch(); });
  query.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && !searchContent.hidden) {
      const first = resultsList.querySelector('button');
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
  resultsList.addEventListener('keydown', event => {
    const buttons = Array.from(resultsList.querySelectorAll('button')), index = buttons.indexOf(event.target);
    if (index < 0) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(index + 1) % buttons.length].focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) query.focus(); else buttons[index - 1].focus(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !searchContent.hidden) { cancelSearch(); hideSearch(); query.focus(); }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, textarea, [contenteditable="true"]')) {
      event.preventDefault(); query.focus();
    }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.map-search')) hideSearch(); });
  $('clear-pin').addEventListener('click', () => { intent++; renderPin(null); updateURL(); $('gregle-map').focus(); });
  $('map-locate').addEventListener('click', () => {
    if (!navigator.geolocation) { notify('Your browser does not support location sharing. Search for a place instead.'); return; }
    const token = ++intent, button = $('map-locate');
    button.disabled = true; button.setAttribute('aria-busy', 'true'); notify('Finding your location…');
    navigator.geolocation.getCurrentPosition(position => {
      button.disabled = false; button.removeAttribute('aria-busy');
      if (token !== intent) return;
      const point = { lat: position.coords.latitude, lng: position.coords.longitude, name: 'My location', detail: 'Your approximate position, as reported by your device.' };
      if (!core.validPoint(point.lat, point.lng)) { notify('Your device did not return a usable location. Try searching instead.'); return; }
      selectPoint(point, 15);
      if (Number.isFinite(position.coords.accuracy) && position.coords.accuracy > 0) accuracy = L.circle([point.lat, point.lng], { radius: Math.min(position.coords.accuracy, 50000), color: '#7637cc', fillOpacity: .08, weight: 1, interactive: false }).addTo(map);
      notify('Showing your approximate location.');
    }, error => {
      button.disabled = false; button.removeAttribute('aria-busy');
      if (token !== intent) return;
      notify(error.code === 1 ? 'Location access was declined. Search for a place instead.' : 'Your location could not be found. Try again or search for a place.');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  });
  $('map-share').addEventListener('click', share); $('share-pin').addEventListener('click', share);
  $('close-map-link').addEventListener('click', () => { $('map-link-copy').hidden = true; $('map-share').focus(); });
  const stage = document.querySelector('.map-stage'), fullscreen = $('map-fullscreen');
  if (document.fullscreenEnabled && stage.requestFullscreen) {
    fullscreen.hidden = false;
    fullscreen.addEventListener('click', async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); }
      catch { notify('Full screen is unavailable in this browser.'); }
    });
    document.addEventListener('fullscreenchange', () => {
      const active = document.fullscreenElement === stage;
      fullscreen.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
      fullscreen.setAttribute('aria-pressed', String(active));
      requestAnimationFrame(() => map.invalidateSize());
    });
  }
  if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe(stage);
})();
