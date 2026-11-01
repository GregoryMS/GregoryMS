(() => {
  'use strict';
  window.GregleStreetView = ({ map, getSelected = () => null, onClose, onOpen = () => {}, onSelect = () => {} }) => {
    const core = window.GregleMaps, $ = id => document.getElementById(id);
    const stage = document.querySelector('.map-stage'), panel = $('streetview-panel');
    const host = $('streetview-frame'), status = $('streetview-status');
    let enabled = false, frame, marker, timer, point;
    function remove() {
      clearTimeout(timer); frame?.remove(); frame = null;
      if (marker) { map.removeLayer(marker); marker = null; }
    }
    function showAt(value) {
      if (!enabled || !Number.isFinite(value?.lng)) return;
      const next = { lat: value.lat, lng: core.wrapLongitude(value.lng) };
      if (!core.validPoint(next.lat, next.lng)) return;
      if (frame && point?.lat === next.lat && point?.lng === next.lng) return;
      remove(); point = next;
      $('streetview-google').href = core.streetViewURL(point);
      $('streetview-coordinates').textContent = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)} · selected map point`;
      status.textContent = 'Loading Street View…'; status.hidden = false;
      const active = document.createElement('iframe');
      active.title = 'Google Street View panorama'; active.allow = 'fullscreen'; active.allowFullscreen = true;
      active.referrerPolicy = 'strict-origin-when-cross-origin';
      // Google-hosted legacy embed. Keep a documented Maps URL as the fallback;
      // cross-origin load events cannot confirm imagery or coverage.
      active.addEventListener('load', () => { if (active === frame) { clearTimeout(timer); status.hidden = true; } });
      active.addEventListener('error', () => {
        if (active !== frame) return;
        clearTimeout(timer); status.textContent = 'Street View could not load. Select another street or open Google Maps above.'; status.hidden = false;
      });
      active.src = core.streetViewEmbedURL(point); frame = active; host.append(active);
      marker = L.circleMarker([point.lat, point.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2477e8', fillOpacity: 1, interactive: false }).addTo(map);
      timer = setTimeout(() => {
        if (frame === active) { status.textContent = 'Street View is taking longer to load. Try another street or open Google Maps above.'; status.hidden = false; }
      }, 20000);
    }
    function setEnabled(value) {
      if (enabled === (value === true)) return;
      enabled = value === true; panel.hidden = !enabled;
      stage.classList.toggle('streetview-active', enabled);
      // Resizing keeps the map centre stable and does not reload the panorama.
      map.invalidateSize({ pan: true });
      if (enabled) { map.closePopup(); onOpen(); showAt(getSelected() || point || map.getCenter()); }
      else { remove(); status.hidden = true; }
    }
    function select(value) {
      if (!enabled || !core.validPoint(value?.lat, core.wrapLongitude(value?.lng))) return;
      showAt(value); onSelect({ ...point, name: 'Street View point', detail: 'Selected Street View location.' });
    }
    $('streetview-close').addEventListener('click', () => { onClose(); $('map-layers-toggle').focus(); });
    $('streetview-retry').addEventListener('click', () => { if (point) { const retry = point; remove(); showAt(retry); } });
    $('streetview-center').addEventListener('click', () => select(map.getCenter()));
    map.on('click', event => {
      if (!enabled || event.originalEvent?.target?.closest?.('.leaflet-interactive, .leaflet-popup, .leaflet-control')) return;
      select(event.latlng);
    });
    window.addEventListener('pagehide', remove);
    window.addEventListener('pageshow', event => { if (event.persisted && enabled) showAt(point || map.getCenter()); });
    return { setEnabled, showAt };
  };
})();
