'use strict';
window.GregleMapNavigation = ({ map, config, getSelected }) => {
  const $ = id => document.getElementById(id), core = window.GregleNavigation;
  const panel = $('map-directions'), toggle = $('map-directions-toggle');
  const inputs = { from: $('directions-from'), to: $('directions-to') }, points = { from: null, to: null };
  const routeLayers = L.layerGroup().addTo(map);
  let active = 'from', version = 0, controller, locating = false, nextSearch = 0, nextRoute = 0;
  const status = text => { $('directions-status').textContent = text; };
  function invalidate(message = 'Choose locations, then show your route.') {
    version++; controller?.abort(); controller = null; locating = false;
    $('directions-location').disabled = false;
    panel.removeAttribute('aria-busy');
    routeLayers.clearLayers(); $('directions-summary').hidden = true;
    $('directions-steps').replaceChildren(); $('directions-results').replaceChildren();
    $('directions-route').disabled = !points.from || !points.to;
    const urls = core.links(points.from, points.to);
    $('directions-handoff').hidden = !urls;
    if (urls) { $('directions-google').href = urls.google; $('directions-apple').href = urls.apple; }
    status(message);
  }
  function setPoint(field, point) {
    points[field] = { lat: point.lat, lng: point.lng, name: point.name, detail: point.detail };
    inputs[field].value = [point.name, point.detail].filter(Boolean).join(' · ');
    invalidate(points.from && points.to ? 'Ready to find a driving route.' : 'Choose the other end of your journey.');
  }
  function open() {
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    document.querySelector('.map-stage').classList.add('directions-open');
    if ($('map-layers-toggle').getAttribute('aria-expanded') === 'true') $('close-map-layers').click();
  }
  function close() {
    invalidate('Directions paused. Show route to calculate again.');
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    document.querySelector('.map-stage').classList.remove('directions-open'); toggle.focus();
  }
  toggle.disabled = false;
  toggle.addEventListener('click', () => { if (panel.hidden) { open(); inputs[active].focus(); } else close(); });
  $('close-directions').addEventListener('click', close);
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  for (const field of ['from', 'to']) {
    inputs[field].addEventListener('focus', () => { active = field; $('directions-search').textContent = `Find ${field === 'from' ? 'starting point' : 'destination'}`; });
    inputs[field].addEventListener('input', () => { points[field] = null; invalidate('Search and choose a matching place.'); });
    $(`directions-${field}-pin`).addEventListener('click', () => {
      const p = getSelected(); if (!core.valid(p)) return;
      open(); setPoint(field, p); active = field === 'from' ? 'to' : 'from'; inputs[active].focus();
    });
  }
  $('directions-swap').addEventListener('click', () => {
    [points.from, points.to] = [points.to, points.from];
    [inputs.from.value, inputs.to.value] = [inputs.to.value, inputs.from.value]; invalidate();
  });
  $('directions-clear').addEventListener('click', () => {
    points.from = points.to = null; inputs.from.value = inputs.to.value = ''; invalidate(); active = 'from'; inputs.from.focus();
  });
  $('directions-location').addEventListener('click', () => {
    invalidate();
    if (!navigator.geolocation) { status('Location is unavailable. Search for a starting point instead.'); return; }
    const token = version; locating = true; $('directions-location').disabled = true; status('Finding your starting location…');
    navigator.geolocation.getCurrentPosition(position => {
      if (token !== version || !locating) return;
      const p = { lat: position.coords.latitude, lng: position.coords.longitude, name: 'My location' };
      if (!core.valid(p)) { invalidate('Your location was invalid. Search for a starting point.'); return; }
      setPoint('from', p); active = 'to'; inputs.to.focus();
    }, () => { if (token === version) invalidate('Location could not be shared. Allow location access or search for a starting point.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
  $('directions-search-form').addEventListener('submit', async e => {
    e.preventDefault(); const field = active, term = inputs[field].value.trim();
    invalidate();
    if (term.length < 2) { status('Enter at least two characters to search.'); inputs[field].focus(); return; }
    if (Date.now() < nextSearch) { status('Please wait a moment, then search again.'); return; }
    nextSearch = Date.now() + 1000;
    const token = version; controller = new AbortController(); const current = controller;
    const timer = setTimeout(() => current.abort(), 10000);
    panel.setAttribute('aria-busy', 'true'); status(`Finding ${field === 'from' ? 'starting points' : 'destinations'}…`);
    try {
      const url = new URL(window.GregleMaps.searchURL(config.searchURL, term));
      const center = map.getCenter(); url.searchParams.set('lat', center.lat); url.searchParams.set('lon', window.GregleMaps.wrapLongitude(center.lng));
      const response = await fetch(url, { signal: current.signal }); if (!response.ok) throw new Error();
      const results = window.GregleMaps.readResults(await response.json()); if (token !== version) return;
      status(results.length ? 'Choose the matching place below.' : 'No matching places. Try a fuller address or nearby town.');
      for (const point of results) {
        const li = document.createElement('li'), button = document.createElement('button'), name = document.createElement('strong'), detail = document.createElement('span');
        button.type = 'button'; name.textContent = point.name; detail.textContent = point.detail; button.append(name, detail); li.append(button); $('directions-results').append(li);
        button.addEventListener('click', () => { setPoint(field, point); active = field === 'from' ? 'to' : 'from'; inputs[active].focus(); });
      }
    } catch { if (token === version) status('Place search is unavailable. Try again, or select a map pin and choose Start here / Directions here.'); }
    finally { clearTimeout(timer); if (token === version) { controller = null; panel.removeAttribute('aria-busy'); } }
  });
  $('directions-route').addEventListener('click', async () => {
    if (!core.valid(points.from) || !core.valid(points.to)) return;
    invalidate();
    if (Date.now() < nextRoute) { status('Please wait a moment, then show the route again.'); return; }
    nextRoute = Date.now() + 1100;
    const token = version, from = { ...points.from }, to = { ...points.to };
    controller = new AbortController(); const current = controller, timer = setTimeout(() => current.abort(), 15000);
    panel.setAttribute('aria-busy', 'true'); $('directions-route').disabled = true; status('Finding a driving route…');
    try {
      const response = await fetch(core.routeURL(from, to), { signal: current.signal });
      const data = await response.json(); if (token !== version) return;
      if (!response.ok && !['NoRoute', 'NoSegment'].includes(data?.code)) throw new Error('Routing is unavailable. Try again, or open your navigation app below.');
      const route = core.readRoute(data);
      L.polyline(route.points, { color: '#fff', weight: 9, opacity: .9, interactive: false }).addTo(routeLayers);
      const line = L.polyline(route.points, { color: '#7637cc', weight: 5, opacity: .95, interactive: false }).addTo(routeLayers);
      for (const [label, p] of [['A', from], ['B', to]]) {
        const icon = L.divIcon({ className: 'directions-marker', html: label, iconSize: [28, 28], iconAnchor: [14, 14] });
        L.marker([p.lat, p.lng], { icon, title: `${label}: ${p.name}`, alt: `${label}: ${p.name}` }).addTo(routeLayers);
      }
      const small = window.innerWidth <= 700;
      map.fitBounds(line.getBounds(), { paddingTopLeft: small ? [30, 30] : [425, 35], paddingBottomRight: small ? [75, 290] : [85, 35], maxZoom: 16 });
      $('directions-total').textContent = `${core.duration(route.duration)} · ${core.distance(route.distance)}`;
      for (const step of route.steps) { const li = document.createElement('li'); li.textContent = `${step.text} · ${core.distance(step.distance)}`; $('directions-steps').append(li); }
      $('directions-summary').hidden = false; status('Driving route ready. Open a navigation app for live guidance.');
    } catch (error) { if (token === version) status(error.name === 'AbortError' ? 'Routing timed out. Try again, or use your navigation app below.' : error.message || 'Routing is unavailable. Try again.'); }
    finally { clearTimeout(timer); if (token === version) { controller = null; panel.removeAttribute('aria-busy'); $('directions-route').disabled = !points.from || !points.to; } }
  });
  return { close };
};
