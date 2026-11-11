'use strict';
window.GregleSavedPlaces = ({ map, config, navigation, getSelected, notify }) => {
  const $ = id => document.getElementById(id), core = window.GregleMaps;
  const key = 'gregle-maps-saved-places-v1', kinds = ['home', 'work'];
  const dialog = $('saved-place-dialog'), query = $('saved-place-query');
  const search = document.querySelector('.map-search'), mapQuery = $('map-query');
  const shortcuts = $('map-saved-places');
  function syncShortcuts() {
    shortcuts.hidden = mapQuery.value.length > 0 || !search.contains(document.activeElement);
  }
  search.addEventListener('focusin', syncShortcuts);
  search.addEventListener('focusout', event => {
    if (!search.contains(event.relatedTarget)) shortcuts.hidden = true;
  });
  mapQuery.addEventListener('input', syncShortcuts);
  mapQuery.addEventListener('click', syncShortcuts);
  mapQuery.addEventListener('keydown', event => {
    if (event.key === 'Escape') shortcuts.hidden = true;
  });
  document.addEventListener('pointerdown', event => {
    if (!search.contains(event.target)) shortcuts.hidden = true;
  });

  let saved, kind = 'home', candidate = null, generation = 0, controller, nextSearch = 0;
  const title = value => value === 'home' ? 'Home' : 'Work';
  const clean = point => core.validPoint(point?.lat, point?.lng) ? {
    lat: point.lat, lng: point.lng,
    name: typeof point.name === 'string' ? point.name.slice(0, 180) : 'Map location',
    detail: typeof point.detail === 'string' ? point.detail.slice(0, 360) : ''
  } : null;
  const describe = point => [point.name, point.detail].filter(Boolean).join(' · ');
  const status = text => { $('saved-place-status').textContent = text; };
  saved = read();
  function read() {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      return { home: clean(data?.home), work: clean(data?.work) };
    } catch { return { home: null, work: null }; }
  }
  function cancel() {
    generation++; controller?.abort(); controller = null;
    $('saved-place-location').disabled = false;
    $('saved-place-search-form').removeAttribute('aria-busy');
  }
  function sync() {
    for (const name of kinds) {
      const button = $('map-' + name), point = saved[name];
      const label = point ? `Navigate to ${title(name)}: ${describe(point)}` : `Set ${name} location`;
      button.setAttribute('aria-label', label); button.title = label;
      button.dataset.saved = String(!!point); button.disabled = !navigation;
      $('map-' + name + '-address').textContent = point ? describe(point) : 'Set location';
    }
    $('map-saved-edit').disabled = false;
  }
  function edit(name) {
    cancel(); kind = name; candidate = null; query.value = '';
    $('saved-place-results').replaceChildren();
    for (const choice of kinds) $('saved-place-' + choice).setAttribute('aria-pressed', String(choice === kind));
    $('saved-place-current').textContent = saved[kind] ? `${title(kind)}: ${describe(saved[kind])}` : `${title(kind)} is not set.`;
    $('saved-place-save').textContent = `Save ${kind}`; $('saved-place-save').disabled = true;
    $('saved-place-remove').textContent = `Remove ${kind}`; $('saved-place-remove').disabled = !saved[kind];
    $('saved-place-pin').disabled = !clean(getSelected());
    status('Search for a place, use a selected map pin, or use your current location.');
    if (!dialog.open) { dialog.showModal(); $('saved-place-close').focus({ preventScroll: true }); }
  }
  function choose(point) {
    cancel(); candidate = clean(point); $('saved-place-save').disabled = !candidate;
    status(candidate ? `Selected: ${describe(candidate)}. Tap Save ${kind} to keep it.` : 'This location is invalid. Choose another place.');
  }
  function persist(point) {
    cancel();
    // Merge the latest browser copy so editing one shortcut preserves the other tab's changes.
    const updated = { ...read(), [kind]: point };
    try { localStorage.setItem(key, JSON.stringify(updated)); }
    catch { status('This browser could not save the location. Check browser storage settings and try again.'); return; }
    saved = updated; sync(); dialog.close();
    notify(point ? `${title(kind)} saved in this browser.` : `${title(kind)} removed from this browser.`);
  }
  for (const name of kinds) {
    $('map-' + name).addEventListener('click', () => {
      saved = read(); sync();
      if (!saved[name]) return edit(name);
      navigation.navigateSaved({ ...saved[name], name: title(name) });
    });
    $('saved-place-' + name).addEventListener('click', () => edit(name));
  }
  $('map-saved-edit').addEventListener('click', () => { saved = read(); edit('home'); });
  $('saved-place-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', cancel);
  dialog.addEventListener('cancel', cancel);
  $('saved-place-save').addEventListener('click', () => { if (candidate) persist(candidate); });
  $('saved-place-remove').addEventListener('click', () => persist(null));
  $('saved-place-pin').addEventListener('click', () => choose(getSelected()));
  query.addEventListener('input', () => {
    cancel(); candidate = null; $('saved-place-save').disabled = true;
    $('saved-place-results').replaceChildren(); status('Search and choose a matching place.');
  });
  $('saved-place-search-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (Date.now() < nextSearch) { status('Please wait a moment before searching again.'); return; }
    cancel(); candidate = null; $('saved-place-save').disabled = true;
    $('saved-place-results').replaceChildren();
    const term = query.value.trim();
    if (term.length < 2) { status('Enter at least two characters.'); return; }
    const token = generation, request = controller = new AbortController();
    const timer = setTimeout(() => request.abort(), 10000); nextSearch = Date.now() + 1000;
    $('saved-place-search-form').setAttribute('aria-busy', 'true'); status('Searching…');
    try {
      const url = new URL(core.searchURL(config.searchURL, term)), center = map.getCenter();
      url.searchParams.set('lat', center.lat); url.searchParams.set('lon', core.wrapLongitude(center.lng));
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) throw Error('Search unavailable');
      const results = core.readResults(await response.json());
      if (token !== generation || !dialog.open) return;
      for (const point of results) {
        const li = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.textContent = describe(point);
        button.addEventListener('click', () => choose(point)); li.append(button); $('saved-place-results').append(li);
      }
      status(results.length ? 'Choose a place below, then save it.' : 'No matching places. Try a fuller address or select a pin on the map.');
    } catch (error) {
      if (token === generation && dialog.open) status(error.name === 'AbortError' ? 'Search timed out. Try again.' : 'Search is unavailable. Try again or use a map pin.');
    } finally {
      clearTimeout(timer);
      if (token === generation) { controller = null; $('saved-place-search-form').removeAttribute('aria-busy'); }
    }
  });
  $('saved-place-location').addEventListener('click', () => {
    cancel(); candidate = null; $('saved-place-save').disabled = true;
    if (!navigator.geolocation) { status('Location is unavailable. Search for an address or use a map pin.'); return; }
    const token = generation; $('saved-place-location').disabled = true; status('Finding your location…');
    navigator.geolocation.getCurrentPosition(position => {
      if (token !== generation || !dialog.open) return;
      const lat = position.coords.latitude, lng = position.coords.longitude;
      choose({ lat, lng, name: `${title(kind)} location`, detail: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    }, () => {
      if (token !== generation || !dialog.open) return;
      cancel(); status('Location could not be shared. Allow location access, search for an address, or use a map pin.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { saved = read(); sync(); if (dialog.open) edit(kind); }
  });
  window.addEventListener('pagehide', cancel);
  sync();
};
