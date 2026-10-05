(function (root) {
  'use strict';
  const API = 'https://api.wheretheiss.at/v1/satellites/25544';
  function parsePosition(data, now = Date.now()) {
    if (!data || data.id !== 25544 || data.units !== 'kilometers' ||
        !['latitude', 'longitude', 'altitude', 'velocity', 'timestamp'].every(key => Number.isFinite(data[key])) ||
        Math.abs(data.latitude) > 90 || Math.abs(data.longitude) > 180 ||
        data.altitude <= 0 || data.altitude > 2000 || data.velocity <= 0 || data.velocity > 50000 ||
        Math.abs(now / 1000 - data.timestamp) > 60) throw Error('Invalid or delayed satellite position');
    return { latitude:data.latitude, longitude:data.longitude, altitude:data.altitude,
      velocity:data.velocity, timestamp:data.timestamp,
      sunlight:data.visibility === 'daylight' ? 'In sunlight' : data.visibility === 'eclipsed' ? 'In Earth’s shadow' : 'Unknown' };
  }
  function trackSegments(positions) {
    const segments = []; let segment = [];
    for (const position of positions) {
      const previous = segment[segment.length - 1];
      // Avoid a line spanning the entire map at the date line or after a polling gap.
      if (previous && (Math.abs(position.longitude - previous.longitude) > 180 || position.timestamp - previous.timestamp > 60)) {
        segments.push(segment.map(p => [p.latitude, p.longitude])); segment = [];
      }
      segment.push(position);
    }
    if (segment.length) segments.push(segment.map(p => [p.latitude, p.longitude]));
    return segments;
  }
  function passesURL(place) {
    if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) ||
        Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) return 'https://www.heavens-above.com/';
    return 'https://www.heavens-above.com/PassSummary.aspx?' + new URLSearchParams({
      satid:'25544', lat:String(place.latitude), lng:String(place.longitude), alt:'0',
      loc:place.name || 'Observing location'
    });
  }
  if (typeof module === 'object' && module.exports) module.exports = { parsePosition, trackSegments, passesURL };
  if (!root.document) return;
  const $ = id => root.document.getElementById(id), section = $('satellite-tracker');
  if (!section) return;
  let map, marker, observerMarker, trail, tileFailed = false, place, lastPosition;
  let active = false, inView = false, stopped = false, timer, controller, lastAttempt = 0;
  const positions = [];
  function setLocation(next) {
    place = next;
    $('satellite-passes').href = passesURL(next);
    $('satellite-passes').textContent = 'ISS passes for ' + (next.name || 'your location') + ' (UTC) ↗';
    if (map && Number.isFinite(next.latitude) && Number.isFinite(next.longitude)) {
      const latlng = [next.latitude, next.longitude];
      if (!observerMarker) observerMarker = root.L.circleMarker(latlng, {radius:7, color:'#5e35b1', weight:3, fillColor:'#fff', fillOpacity:1}).addTo(map);
      observerMarker.setLatLng(latlng).bindTooltip(next.name || 'Observing location');
    }
  }
  root.GregleSatellite = { setLocation };
  function initMap() {
    if (map || !root.L) return;
    $('satellite-map').replaceChildren();
    map = root.L.map('satellite-map', {scrollWheelZoom:false, worldCopyJump:true, minZoom:1, maxZoom:8}).setView([20, 0], 2);
    const tiles = root.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom:19
    }).addTo(map);
    tiles.on('tileerror', () => { tileFailed = true; $('satellite-status').textContent = 'Map tiles unavailable. The latest coordinates and ISS details are shown below.'; });
    tiles.on('load', () => { map.invalidateSize(); });
    trail = root.L.polyline([], {color:'#7452c8', weight:3, opacity:0.8}).addTo(map);
    if (place) setLocation(place);
    map.on('dragstart', () => { $('satellite-follow').checked = false; });
  }
  function render(position) {
    const pair = [position.latitude, position.longitude];
    $('satellite-position').textContent = position.latitude.toFixed(2) + '°, ' + position.longitude.toFixed(2) + '°';
    $('satellite-altitude').textContent = position.altitude.toFixed(0) + ' km';
    $('satellite-speed').textContent = Math.round(position.velocity).toLocaleString() + ' km/h';
    $('satellite-sunlight').textContent = position.sunlight;
    const time = new Date(position.timestamp * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    $('satellite-status').textContent = 'Position at ' + time + ' · updates every 10 seconds.' +
      (!map ? ' Map unavailable; coordinates are shown above.' : tileFailed ? ' Some map tiles could not load.' : '');
    if (map) {
      if (!marker) marker = root.L.circleMarker(pair, {radius:9, color:'#fff', weight:2, fillColor:'#7452c8', fillOpacity:1}).addTo(map).bindTooltip('International Space Station', {permanent:true, direction:'top'});
      marker.setLatLng(pair);
      trail.setLatLngs(trackSegments(positions));
      if ($('satellite-follow').checked) map.panTo(pair, {animate:false});
    }
  }
  async function update() {
    if (controller || stopped || root.document.hidden || !inView) return;
    if (Date.now() - lastAttempt < 10000) { schedule(); return; }
    lastAttempt = Date.now(); controller = new AbortController();
    const currentController = controller, timeout = root.setTimeout(() => currentController.abort(), 8000);
    $('satellite-refresh').disabled = true;
    try {
      const response = await root.fetch(API, {signal:currentController.signal, cache:'no-store', credentials:'omit'});
      if (!response.ok) throw Error('Satellite feed unavailable');
      const position = parsePosition(await response.json());
      if (!active || currentController.signal.aborted) return;
      if (!lastPosition || position.timestamp > lastPosition.timestamp) {
        positions.push(position);
        while (positions.length && position.timestamp - positions[0].timestamp > 1800) positions.shift();
      }
      lastPosition = position; render(position);
    } catch (_) {
      if (active) $('satellite-status').textContent = lastPosition ?
        'Live update unavailable. Showing the last position at ' + new Date(lastPosition.timestamp * 1000).toLocaleTimeString() + ' · retrying automatically.' :
        'Live position unavailable. Try Update position or open the provider links below.';
    } finally {
      root.clearTimeout(timeout); controller = null; $('satellite-refresh').disabled = false;
      schedule();
    }
  }
  function schedule() {
    root.clearTimeout(timer);
    if (active) timer = root.setTimeout(update, Math.max(1000, 10000 - (Date.now() - lastAttempt)));
  }
  function sync() {
    active = inView && !root.document.hidden && !stopped;
    root.clearTimeout(timer);
    if (active) { initMap(); map?.invalidateSize(); update(); }
    else {
      controller?.abort();
      if (lastPosition) $('satellite-status').textContent = 'Updates paused · last position at ' + new Date(lastPosition.timestamp * 1000).toLocaleTimeString() + '.';
    }
  }
  $('satellite-refresh').addEventListener('click', () => { root.clearTimeout(timer); update(); });
  $('satellite-follow').addEventListener('change', () => { if (map && lastPosition && $('satellite-follow').checked) map.panTo([lastPosition.latitude, lastPosition.longitude]); });
  if (root.IntersectionObserver) {
    const observer = new root.IntersectionObserver(entries => { inView = entries[0].isIntersecting; sync(); });
    observer.observe(section);
  } else { inView = true; sync(); }
  root.document.addEventListener('visibilitychange', sync);
  root.addEventListener('pagehide', () => { stopped = true; sync(); });
  root.addEventListener('pageshow', () => { stopped = false; sync(); });
})(typeof window === 'object' ? window : globalThis);
