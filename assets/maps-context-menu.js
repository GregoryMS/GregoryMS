'use strict';
window.GregleMapContextMenu = ({ map, navigation, enabled, ignore, onAction, onPin, onShare }) => {
  const $ = id => document.getElementById(id), core = window.GregleMaps;
  const container = $('gregle-map'), stage = container.parentElement;
  const menu = $('map-context-menu'), panel = $('map-measure');
  const buttons = Array.from(menu.querySelectorAll('[role="menuitem"]'));
  const layers = L.layerGroup().addTo(map);
  let target = null, measuring = false, points = [];
  const dismiss = (focus = false) => {
    menu.hidden = true;
    if (focus) container.focus({ preventScroll: true });
  };
  function redraw() {
    layers.clearLayers();
    let total = 0;
    for (let i = 1; i < points.length; i++) total += map.distance(points[i - 1], points[i]);
    if (points.length > 1) L.polyline(points, { color: '#7637cc', weight: 3, dashArray: '6 6', interactive: false }).addTo(layers);
    for (const point of points) L.circleMarker(point, { radius: 5, color: '#7637cc', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(layers);
    $('map-measure-total').textContent = total < 1000 ? `${Math.round(total)} m` : `${(total / 1000).toFixed(2)} km`;
    $('map-measure-undo').disabled = !measuring || points.length < 2;
    $('map-measure-finish').disabled = !measuring;
  }
  function addPoint(point) {
    if (!core.validPoint(point.lat, core.wrapLongitude(point.lng))) return;
    const previous = points.at(-1) || map.getCenter();
    // Draw across the nearest world copy, including measurements over the dateline.
    const next = L.latLng(point.lat, previous.lng + core.wrapLongitude(point.lng - previous.lng));
    if (points.length && map.distance(previous, next) < .01) return;
    points.push(next); redraw();
  }
  function clear() {
    dismiss(); measuring = false; points = []; layers.clearLayers(); panel.hidden = true;
  }
  function act(callback) {
    if (!target) return;
    const point = { ...target };
    dismiss(true); onAction(); callback(point);
  }
  $('map-context-share').addEventListener('click', () => act(point => onShare(point)));
  $('map-context-pin').addEventListener('click', () => act(point => { clear(); onPin(point); }));
  $('map-context-start').addEventListener('click', () => act(point => { clear(); navigation?.choosePoint('from', point); }));
  $('map-context-navigate').addEventListener('click', () => act(point => { clear(); navigation?.navigateTo(point); }));
  $('map-context-measure').addEventListener('click', () => act(point => {
    clear(); measuring = true; panel.hidden = false;
    $('map-measure-help').textContent = 'Click the map to add points. Distance is measured in a straight line.';
    addPoint(point);
  }));
  $('map-measure-undo').addEventListener('click', () => {
    if (measuring && points.length > 1) { points.pop(); redraw(); }
  });
  $('map-measure-finish').addEventListener('click', () => {
    measuring = false; redraw();
    $('map-measure-help').textContent = 'Straight-line distance. Right-click and choose Measure distance to start again.';
    container.focus({ preventScroll: true });
  });
  $('map-measure-clear').addEventListener('click', () => { clear(); container.focus({ preventScroll: true }); });
  function open(point) {
    if (!enabled()) return;
    const lat = point.lat, lng = core.wrapLongitude(point.lng);
    if (!core.validPoint(lat, lng)) return;
    target = { lat, lng, name: 'Dropped pin', detail: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
    $('map-context-what3words').href = `https://what3words.com/${lat.toFixed(6)},${lng.toFixed(6)}`;
    $('map-context-lat').textContent = `Latitude: ${lat.toFixed(6)}`;
    $('map-context-lng').textContent = `Longitude: ${lng.toFixed(6)}`;
    if (window.GreglePlusCodes) $('map-context-pluscode').textContent = 'OLC: ' + window.GreglePlusCodes.encode(lat,lng);
    menu.hidden = false;
    const anchor = map.latLngToContainerPoint(point), mapRect = container.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.x + mapRect.left - stageRect.left, stage.clientWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.y + mapRect.top - stageRect.top, stage.clientHeight - menu.offsetHeight - 8))}px`;
    buttons[0].focus({ preventScroll: true });
  }
  $('map-context-what3words').addEventListener('click', () => { dismiss(); onAction(); });
  map.on('contextmenu', event => {
    if (!enabled() || ignore(event.originalEvent)) return;
    event.originalEvent?.preventDefault(); open(event.latlng);
  });
  map.on('click', event => {
    dismiss();
    if (!measuring || !enabled() || event.originalEvent?.target?.closest?.('.leaflet-interactive, .leaflet-popup, .leaflet-control')) return;
    onAction(); addPoint(event.latlng);
  });
  map.on('movestart resize rotate', () => dismiss());
  window.addEventListener('resize', () => dismiss());
  window.addEventListener('hashchange', clear);
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target) && event.button !== 2) dismiss();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (!menu.hidden || measuring)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!menu.hidden) dismiss(true);
      else { clear(); container.focus({ preventScroll: true }); }
    }
  }, true);
  menu.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
    if (event.key === 'Tab') dismiss();
  });
  return { open, clear, get measuring() { return measuring; } };
};
