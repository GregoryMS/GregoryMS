(async () => {
  'use strict';
  const core = window.GregleMaps;
  const $ = id => document.getElementById(id);
  const defaults = {
    tileURL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', searchURL: 'https://maps.gregle.uk/api/maps/search',
    satelliteURL: 'https://gregle-esri.square-rain-5ded.workers.dev/tiles/{z}/{x}/{y}.jpg',
    cycleURL: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    transitURL: 'https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png',
    topographicURL: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png', maritimeURL: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    aviationURL: 'https://gregle-aviation.square-rain-5ded.workers.dev/tiles/{z}/{x}/{y}.png',
    speedSignsURL: 'https://vsls.drivebc.ca/heartbeat/geojson', messageSignsURL: 'https://gregle-drivebc.square-rain-5ded.workers.dev/messages', ferriesURL: '/data/drivebc-ferries.json',
    cameraCatalogueURL: 'https://catalogue.data.gov.bc.ca/dataset/6b39a910-6c77-476f-ac96-7b4f18849b1c/resource/a9d52d85-8402-4ce7-b2ac-a2779837c48a/download/webcams.csv',
    trafficURL: 'https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=light&tileSize=256',
    googleTrafficURL: 'https://mts0.google.com/vt/lyrs=h,traffic&x={x}&y={y}&z={z}&style=3',
    evURL: 'https://gregle-ev.square-rain-5ded.workers.dev/charging', evProvider: 'openchargemap',
    evOSMURL: 'https://gregle-ev.square-rain-5ded.workers.dev/charging?source=osm',
    fuelPricesURL: 'https://gregle-ev.square-rain-5ded.workers.dev/fuel-prices', fuelStationsURL: 'https://gregle-ev.square-rain-5ded.workers.dev/fuel-stations',
    placesURL: 'https://overpass.private.coffee/api/interpreter', placeLookupURL: 'https://nominatim.openstreetmap.org/'
  };
  const searchContent = $('map-search-content'), resultsList = $('map-results'), query = $('map-query');
  let map, drawer, layerControl, placeDetails, busyness, navigation, contextTools, marker, selected = null, searchController, searchVersion = 0, intent = 0, nextSearch = 0, noticeTimer, usingEmbed = false, usingStreetView = false;
  // Device position is independent of the selected/search pin and never enters shared links.
  let locationDot, locationHalo, locationWatch = null, locationGeneration = 0, locationExpiry, locationEnabled = false;
  function clearLocation() {
    clearTimeout(locationExpiry);
    if (locationDot) map.removeLayer(locationDot);
    if (locationHalo) map.removeLayer(locationHalo);
    locationDot = locationHalo = null;
  }
  function showLocation(position) {
    if (document.hidden || usingEmbed) return;
    const { latitude: lat, longitude: lng, accuracy: radius } = position.coords;
    if (!core.validPoint(lat, lng)) return;
    const age = Date.now() - Number(position.timestamp);
    if (Number.isFinite(age) && age > 60000) return;
    const point = [lat, lng];
    if (!locationDot) locationDot = L.circleMarker(point, { radius: 7, color: '#fff', weight: 3, fillColor: '#2476e8', fillOpacity: 1, bubblingMouseEvents: false }).bindTooltip('Your current location').addTo(map);
    else locationDot.setLatLng(point);
    if (Number.isFinite(radius) && radius > 0) {
      if (!locationHalo) locationHalo = L.circle(point, { radius, color: '#2476e8', fillOpacity: .1, weight: 1, interactive: false }).addTo(map);
      else { locationHalo.setLatLng(point); locationHalo.setRadius(radius); }
    } else if (locationHalo) { map.removeLayer(locationHalo); locationHalo = null; }
    locationDot.bringToFront();
    clearTimeout(locationExpiry);
    locationExpiry = setTimeout(clearLocation, Math.max(1, 60000 - Math.max(0, age || 0)));
  }
  function stopLocation() {
    locationGeneration++;
    if (locationWatch !== null) navigator.geolocation?.clearWatch(locationWatch);
    locationWatch = null;
    clearLocation();
  }
  function startLocation() {
    if (!locationEnabled || locationWatch !== null || document.hidden || usingEmbed || !navigator.geolocation?.watchPosition) return;
    const generation = ++locationGeneration;
    try {
      locationWatch = navigator.geolocation.watchPosition(position => {
        if (generation === locationGeneration) showLocation(position);
      }, error => {
        if (generation !== locationGeneration) return;
        clearLocation();
        if (error.code === 1) { locationEnabled = false; stopLocation(); }
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    } catch { stopLocation(); }
  }
  function acceptLocation(position) {
    locationEnabled = true;
    showLocation(position);
    startLocation();
  }
  const cache = new Map();
  let suggestionTimer,composing=false;
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
  };
  const hideSearch = () => { searchContent.hidden = true; };
  const cancelSearch = (keepResults = false) => {
    clearTimeout(suggestionTimer);suggestionTimer=null;
    searchVersion++;
    searchController?.abort();
    searchController = null;
    if (keepResults !== true) resultsList.replaceChildren();
    $('map-search-form').removeAttribute('aria-busy');
  };
  function renderPin(point, lookup = true, nearby = false) {
    const changed = point && (!selected || point.lat !== selected.lat || point.lng !== selected.lng);
    selected = point;
    busyness?.select(point);
    if ($('route-pin-actions')) $('route-pin-actions').hidden = !point;
    if (marker) { map.removeLayer(marker); marker = null; }
    $('clear-pin').hidden = !point;
    $('map-place').hidden = !point;
    $('place-bottom').hidden = !point;
    $('place-kicker').textContent = point ? 'On the map' : '';
    $('place-name').textContent = point?.name || '';
    $('place-detail').textContent = point?.detail || (point ? 'Copy the link to save or share this place.' : '');
    $('place-coordinates').textContent = point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : '';
    $('map-place').classList.toggle('has-pin', !!point);
    if (point?.osm) $('place-kicker').textContent = 'OpenStreetMap place';
    if (point) {
      const icon = L.divIcon({ className: 'gregle-map-pin', iconSize: [38, 46], iconAnchor: [19, 44], html: '<svg viewBox="0 0 38 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M19 2C9.6 2 2 9.6 2 19c0 11 17 25 17 25s17-14 17-25C36 9.6 28.4 2 19 2Z" fill="#7637cc" stroke="#fff" stroke-width="2.5"/><circle cx="19" cy="18" r="6" fill="#fff"/></svg>' });
      marker = L.marker([point.lat, point.lng], { icon, title: point.name, alt: 'Map pin', keyboard: true }).addTo(map);
      marker.on('click', () => placeDetails?.select(point, { nearby: !point.osm }));
    }
    if (lookup && !usingEmbed) placeDetails?.select(point, { nearby });
    if (changed && lookup) { drawer?.show('map-place', true); drawer?.revealPoint(point); }
  }
  function selectPoint(point, zoom = 16) {
    intent++;
    cancelSearch(); hideSearch();
    renderPin(point);
    const mobile = document.querySelector('.map-stage').classList.contains('has-mobile-drawer');
    map.setView([Math.max(-85.051129, Math.min(85.051129, point.lat)), point.lng], zoom, mobile ? { animate: false } : {});
    if (layerControl.getState().streetview) layerControl.openStreetView(point);
    updateURL();
    $('gregle-map').focus({ preventScroll: true });
  }
  function clearPin() {
    intent++;
    renderPin(null);
    updateURL();
    $('gregle-map').focus({ preventScroll: true });
  }
  function syncMapMode(restoreDetails = true) {
    const embedded = core.isEmbeddedBase(layerControl.getState().base);
    if (embedded === usingEmbed) return;
    usingEmbed = embedded; intent++; cancelSearch(); hideSearch();
    if (embedded) stopLocation(); else startLocation();
    if (embedded) {
      contextTools?.clear();
      navigation?.close();
      placeDetails?.clear();
      if (document.activeElement?.closest('.map-search, .map-place, .map-actions, #gregle-map')) $('embedded-layers-toggle').focus({ preventScroll: true });
    } else if (restoreDetails) placeDetails?.select(selected);
  }
  function syncStreetView() {
    const enabled = layerControl.getState().streetview && !usingEmbed;
    if (enabled === usingStreetView) return;
    usingStreetView = enabled;
    if (enabled) $('map-place').hidden = true;
    else if (!usingEmbed) renderPin(selected, false);
  }
  function showScopeAction(worldwide) {
    const button = $('map-search-scope');
    button.dataset.worldwide = String(worldwide);
    button.textContent = worldwide ? 'Search worldwide' : 'Search this area';
    button.hidden = false;
  }
  function showResults(results, worldwide) {
    resultsList.replaceChildren();
    $('map-search-status').textContent = results.length ? `${results.length} ${results.length === 1 ? 'place' : 'places'} found ${worldwide ? 'worldwide' : 'near this map area'}` : worldwide ? 'No places found. Try a town, postcode or a more complete address.' : 'No places found near this map area. Try a fuller name or search worldwide.';
    showScopeAction(!worldwide);
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
      if (!document.body.classList.contains('vehicle-layout')) { $('map-link-input').focus(); $('map-link-input').select(); }
    }
  }
  async function shareLocation(point) {
    const url = new URL(location.pathname, location.origin);
    url.hash = core.makeHash({ lat: point.lat, lng: point.lng, zoom: 15 }, point);
    if (navigator.share) {
      try { await navigator.share({ title: 'Location · Gregle Maps', url: url.href }); return; }
      catch (error) { if (error.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url.href); notify('Location link copied.'); }
    catch {
      $('map-link-copy').hidden = false;
      $('map-link-input').value = url.href;
      drawer?.show('map-link-copy', true);
      if (!document.body.classList.contains('vehicle-layout')) { $('map-link-input').focus(); $('map-link-input').select(); }
    }
  }
  const controls = [$('map-locate'), $('map-query'), $('map-base-toggle'), $('map-layers-toggle'), document.querySelector('.map-search-submit')];
  controls.forEach(control => { control.disabled = true; });
  if (!window.L || !core || !window.GregleFuel || !window.GregleFuelCore || !window.GregleMapLayers || !window.GregleMapEmbed || !window.GregleAircraft || !window.GregleAircraftCore || !window.GregleVessels || !window.GregleVesselsCore || !window.GregleDriveBC || !window.GregleDriveBCCameras || !window.GregleCamerasCore || !window.GregleDriveBCSigns || !window.GregleSignsCore || !window.GregleDriveBCFerries || !window.GregleFerriesCore || !window.GregleEVCore || !window.GregleEVCharging || !window.GregleStreetView || !window.GregleGoogleTraffic || !window.GregleAviation || !window.GreglePlaceData || !window.GregleMapPlaces || !window.GregleMapPinGestures) {
    notify('The map could not load. Use the OpenStreetMap link above to keep exploring.', 'map', true);
    return;
  }
  let config = { ...defaults };
  const serverTomTom = location.hostname === 'maps.gregle.uk' ? fetch('/api/maps/tomtom-config', {credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(3000)})
    .then(async response => response.ok && (await response.json()).enabled === true).catch(() => false) : Promise.resolve(false);
  try {
    const response = await fetch('assets/maps-config.json?v=20261112-search-proxy', { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const supplied = await response.json();
      if (['openchargemap', 'overpass'].includes(supplied.evProvider)) config.evProvider = supplied.evProvider;
      for (const key of Object.keys(defaults)) if (typeof supplied[key] === 'string' && (supplied[key].startsWith('https://') || (['messageSignsURL', 'ferriesURL'].includes(key) && supplied[key].startsWith('/') && !supplied[key].startsWith('//')))) config[key] = supplied[key];
    }
  } catch {}
  config.serverTomTom = await serverTomTom;
  const explicitInitialLocation = new URLSearchParams(location.hash.slice(1)).has('map') || new URLSearchParams(location.hash.slice(1)).has('pin');
  const initial = core.readHash(location.hash);
  map = L.map('gregle-map', { zoomControl: false, doubleClickZoom: false, tapHold: false, minZoom: 2, maxZoom: 23, worldCopyJump: true }).setView([initial.view.lat, initial.view.lng], initial.view.zoom);
  drawer = window.GregleMapDrawer?.({ map });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 110 }).addTo(map);
  layerControl = window.GregleMapLayers({ map, config, initial: core.readLayers(location.hash), notify, getSelected: () => layerControl ? selected : initial.pin, onStreetViewOpen: () => { navigation?.close(); $('map-place').hidden = true; }, onTrafficKeyChange: () => navigation?.refreshTraffic(), onStreetViewSelect: point => { intent++; cancelSearch(); hideSearch(); renderPin(point, false); $('map-place').hidden = true; updateURL(); }, onChange: () => { syncMapMode(); syncStreetView(); updateURL(); }, onOpen: (panelId = 'map-layers-panel') => drawer?.show(panelId, true) });
  busyness = window.GregleMapBusyness?.();
  placeDetails = window.GregleMapPlaces({ map, config, onPlace: point => { renderPin(point, false); updateURL(); } });
  syncMapMode(false);
  renderPin(initial.pin); syncStreetView(); updateURL();
  navigation = window.GregleMapNavigation?.({ map, config, getSelected: () => selected, onOpen: () => drawer?.show('map-directions', true), onConnectTraffic: () => layerControl.connectTraffic() });
  window.GregleSavedPlaces?.({ map, config, navigation, getSelected: () => selected, notify });
  controls.forEach(control => { control.disabled = false; });
  map.on('moveend', updateURL);
  map.on('dragstart zoomstart', () => { intent++; });
  map.on('movestart', () => { cancelSearch(); hideSearch(); });
  // Shared map views keep their position; ordinary visits start near the device.
  if (!explicitInitialLocation && !usingEmbed && navigator.geolocation) {
    const initialIntent = intent;
    navigator.geolocation.getCurrentPosition(position => {
      acceptLocation(position);
      if (intent !== initialIntent || document.querySelector('.map-stage').classList.contains('navigating')) return;
      const {latitude: lat, longitude: lng} = position.coords;
      if (core.validPoint(lat, lng)) map.setView([Math.max(-85.051129, Math.min(85.051129, lat)), lng], 15, {animate: false});
    }, () => {}, {enableHighAccuracy: true, timeout: 12000, maximumAge: 0});
  }
  // A shared view stays put, while an already allowed device location can still be shown.
  navigator.permissions?.query({ name: 'geolocation' }).then(permission => {
    if (permission.state === 'granted') { locationEnabled = true; startLocation(); }
    permission.addEventListener('change', () => {
      locationEnabled = permission.state === 'granted';
      if (locationEnabled) startLocation(); else stopLocation();
    });
  }).catch(() => {});
  const dropPin = event => {
    if (contextTools?.measuring || usingEmbed || layerControl.getState().streetview || event.originalEvent?.target?.closest?.('.leaflet-interactive, .leaflet-popup, .leaflet-control')) return;
    const point = { lat: event.latlng.lat, lng: core.wrapLongitude(event.latlng.lng), name: 'Dropped pin', detail: 'A place to come back to. Copy the link to save or share it.' };
    if (core.validPoint(point.lat, point.lng)) { intent++; cancelSearch(); hideSearch(); renderPin(point, true, true); updateURL(); }
  };
  const pinGestures = window.GregleMapPinGestures({
    container: $('gregle-map'),
    onPin: touch => dropPin({ latlng: map.mouseEventToLatLng(touch), originalEvent: { target: touch.target } }),
  });
  map.on('dblclick', event => { if (!pinGestures.ignoreDoubleClick(event.originalEvent)) dropPin(event); });
  contextTools = window.GregleMapContextMenu?.({
    map, navigation, enabled: () => !usingEmbed, onShare: shareLocation,
    ignore: event => pinGestures.ignoreDoubleClick(event),
    onAction: () => { intent++; cancelSearch(); hideSearch(); },
    onPin: point => { renderPin(point, true, true); updateURL(); },
  });
  window.addEventListener('hashchange', () => {
    intent++; cancelSearch(); hideSearch();
    const state = core.readHash(location.hash);
    const layers = core.readLayers(location.hash);
    if (layers) layerControl.setState(layers);
    syncMapMode(false);
    renderPin(state.pin); map.setView([state.view.lat, state.view.lng], state.view.zoom);
    if (layerControl.getState().streetview && !usingEmbed) layerControl.openStreetView(state.pin || state.view);
    syncStreetView(); updateURL();
  });
  async function search(worldwide = false, automatic = false) {
    const term = query.value.trim();
    if (term.length < (automatic?3:2)||automatic&&(composing||document.hidden||usingEmbed)) return;
    intent++; cancelSearch(automatic);
    const version = searchVersion;
    const fallback = new URL(core.osmURL(view())); fallback.pathname = '/search'; fallback.searchParams.set('query', term);
    $('osm-search').href = fallback.href; $('osm-search').hidden = true;
    $('map-search-scope').hidden = true;
    searchContent.hidden = false;
    drawer?.show('map-search-content', true);
    if (!automatic&&searchContent.closest('.map-drawer')) query.blur();
    let timer;
    try {
      const bounds = map.getBounds();
      const area = worldwide ? null : core.searchArea(view(), [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
      const url = new URL(core.searchURL(config.searchURL, term, area));
      const cacheURL = new URL(url); cacheURL.searchParams.set('q', term.toLocaleLowerCase());
      const key = cacheURL.href;
      if (cache.has(key)) { showResults(cache.get(key), worldwide); return; }
      if (Date.now() < nextSearch) { if(automatic){suggestionTimer=setTimeout(()=>search(worldwide,true),nextSearch-Date.now());$('map-search-status').textContent='Finding suggestions…';}else{$('map-search-status').textContent = 'Please wait a moment, then search again.'; showScopeAction(worldwide);}return; }
      nextSearch = Date.now() + 1000;
      searchController = new AbortController();
      const controller = searchController;
      timer = setTimeout(() => controller.abort(), 10000);
      $('map-search-form').setAttribute('aria-busy', 'true');
      $('map-search-status').textContent = worldwide ? 'Finding places worldwide…' : 'Finding places near this map area…';
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Search unavailable');
      const results = core.readResults(await response.json(), area);
      if (version !== searchVersion) return;
      if (cache.size >= 30) cache.delete(cache.keys().next().value);
      cache.set(key, results); showResults(results, worldwide);
    } catch {
      if (version !== searchVersion) return;
      $('map-search-status').textContent = 'Place search is unavailable right now. Try again or search on OpenStreetMap.';
      $('osm-search').hidden = false;
    } finally {
      clearTimeout(timer);
      if (version === searchVersion) { searchController = null; $('map-search-form').removeAttribute('aria-busy'); }
    }
  }
  $('map-search-form').addEventListener('submit', event => { event.preventDefault(); search(); });
  $('map-search-scope').addEventListener('click', () => search($('map-search-scope').dataset.worldwide === 'true'));
  const clearSearchButton = $('map-search-clear');
  const syncClearSearch = () => { clearSearchButton.hidden = query.value.length === 0; };
  clearSearchButton.addEventListener('click', () => {
    query.value = '';
    intent++;
    cancelSearch();
    hideSearch();
    syncClearSearch();
    query.focus({ preventScroll: true });
  });
  syncClearSearch();
  function suggest(schedule = true) {
    syncClearSearch(); intent++;
    const eligible = query.value.trim().length >= 3;
    cancelSearch(eligible);
    if (!eligible) { hideSearch(); return; }
    if (!searchContent.hidden) {
      $('map-search-status').textContent = 'Updating suggestions…';
      $('map-search-scope').hidden = true;
      $('osm-search').hidden = true;
    }
    if (schedule && !composing) suggestionTimer = setTimeout(() => search(false, true), 450);
  }
  query.addEventListener('input', event => suggest(!event.isComposing));
  query.addEventListener('compositionstart',()=>{composing=true;suggest(false);});
  query.addEventListener('compositionend',()=>{composing=false;suggest();});
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
    if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) { if (!document.body.classList.contains('vehicle-layout')) query.focus(); } else buttons[index - 1].focus(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!searchContent.hidden||suggestionTimer) { event.preventDefault();cancelSearch(); hideSearch(); if (!document.body.classList.contains('vehicle-layout')) query.focus(); }
      else if (selected) clearPin();
    }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, textarea, [contenteditable="true"]')) {
      event.preventDefault(); if (!document.body.classList.contains('vehicle-layout')) query.focus();
    }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.map-search, #map-search-content, #map-drawer')) {cancelSearch();hideSearch();} });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelSearch();hideSearch();stopLocation();}else startLocation();});
  window.addEventListener('pagehide',()=>{cancelSearch();stopLocation();});
  window.addEventListener('pageshow',startLocation);
  $('place-streetview').addEventListener('click', () => { if (selected) layerControl.openStreetView(selected); });
  $('clear-pin').addEventListener('click', clearPin);
  $('map-locate').addEventListener('click', () => {
    if (!navigator.geolocation) { notify('Your browser does not support location sharing. Search for a place instead.'); return; }
    const token = ++intent, button = $('map-locate');
    button.disabled = true; button.setAttribute('aria-busy', 'true'); notify('Finding your location…');
    navigator.geolocation.getCurrentPosition(position => {
      button.disabled = false; button.removeAttribute('aria-busy');
      acceptLocation(position);
      if (token !== intent) return;
      const point = { lat: position.coords.latitude, lng: position.coords.longitude, name: 'My location', detail: 'Your approximate position, as reported by your device.' };
      if (!core.validPoint(point.lat, point.lng)) { notify('Your device did not return a usable location. Try searching instead.'); return; }
      cancelSearch(); hideSearch();
      map.setView([Math.max(-85.051129, Math.min(85.051129, point.lat)), point.lng], 15);
      $('gregle-map').focus({ preventScroll: true });
      notify('Showing your approximate location.');
    }, error => {
      button.disabled = false; button.removeAttribute('aria-busy');
      if (token !== intent) return;
      notify(error.code === 1 ? 'Location access was declined. Search for a place instead.' : 'Your location could not be found. Try again or search for a place.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
  $('share-pin').addEventListener('click', share);
  $('close-map-link').addEventListener('click', () => { $('map-link-copy').hidden = true; $('map-query').focus(); });
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
