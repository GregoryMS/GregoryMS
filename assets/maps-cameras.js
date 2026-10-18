(() => {
  'use strict';
  window.GregleDriveBCCameras = ({ map, config, notify }) => {
    const output = document.getElementById('drivebc-cameras-status');
    const group = L.layerGroup(), displayed = new Map();
    const attribution = 'Cameras: <a href="https://www.drivebc.ca/cameras/" target="_blank" rel="noopener">DriveBC</a> (<a href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc" target="_blank" rel="noopener">OGL-BC</a>)';
    const refreshEvery = 3600000, maxCacheAge = 86400000;
    let enabled = false, controller, version = 0, refresh, debounce, snapshot, retryAt = 0, failures = 0, preview;
    const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; };
    function inView(point) {
      const b = map.getBounds(), [lat, lng] = point;
      return lat >= b.getSouth() && lat <= b.getNorth() && (b.getEast() - b.getWest() >= 360 || [-360, 0, 360].some(shift => lng >= b.getWest() + shift && lng <= b.getEast() + shift));
    }
    function coversBC() {
      const b = map.getBounds();
      return b.getSouth() <= 60.1 && b.getNorth() >= 48 && (b.getEast() - b.getWest() >= 360 || [-360, 0, 360].some(shift => b.getWest() + shift <= -114 && b.getEast() + shift >= -139.1));
    }
    function closePreview() {
      if (!preview) return;
      const old = preview; preview = null; old.cancel(); map.closePopup(old.popup);
    }
    function popup(site, marker) {
      closePreview();
      const box = document.createElement('div'); box.className = 'drivebc-popup drivebc-camera-popup';
      const size = map.getSize(), width = Math.max(150, Math.min(360, size.x - 120));
      box.style.width = `${width}px`;
      Object.assign(marker.getPopup().options, { minWidth: width, maxWidth: width, maxHeight: Math.max(80, size.y - 220), autoPanPaddingTopLeft: [12, 90], autoPanPaddingBottomRight: [68, 35] });
      const title = document.createElement('strong'); title.textContent = site.name;
      const selectLabel = document.createElement('label'); selectLabel.textContent = 'Camera view';
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Camera view');
      site.cameras.forEach(camera => { const option = document.createElement('option'); option.value = camera.id; option.textContent = camera.name; select.append(option); });
      selectLabel.append(select); selectLabel.hidden = site.cameras.length < 2;
      const caption = document.createElement('p');
      const image = document.createElement('img'); image.className = 'drivebc-camera-image'; image.decoding = 'async';
      const imageStatus = document.createElement('p'); imageStatus.className = 'drivebc-meta'; imageStatus.setAttribute('role', 'status');
      const note = document.createElement('p'); note.className = 'drivebc-meta'; note.textContent = 'Still images, not live video. Check the capture time printed on the image; update intervals vary.';
      const credit = document.createElement('p'); credit.className = 'drivebc-meta';
      const actions = document.createElement('div'); actions.className = 'drivebc-camera-actions';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Refresh image';
      const link = document.createElement('a'); link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open on DriveBC ↗';
      actions.append(button, link); box.append(title, selectLabel, caption, image, imageStatus, note, credit, actions);
      let timeout, unlock, alive = true;
      const stopImage = () => { clearTimeout(timeout); clearTimeout(unlock); image.onload = image.onerror = null; image.removeAttribute('src'); };
      function loadImage() {
        if (!alive || !enabled || document.hidden) return;
        stopImage();
        const camera = site.cameras.find(item => item.id === select.value) || site.cameras[0];
        caption.textContent = camera.caption; credit.textContent = camera.credit; credit.hidden = !camera.credit;
        image.alt = `DriveBC webcam: ${camera.name}`; image.hidden = true; link.href = camera.pageURL;
        imageStatus.textContent = 'Loading camera image…'; button.disabled = true;
        // A one-minute cache bucket allows reopening a view without downloading every frame again.
        const failed = () => {
          if (!alive) return;
          clearTimeout(timeout); image.onload = image.onerror = null; image.removeAttribute('src'); image.hidden = true;
          imageStatus.textContent = 'Camera image unavailable. Try again later or open this camera on DriveBC.';
        };
        image.onload = () => { if (!alive) return; clearTimeout(timeout); image.hidden = false; imageStatus.textContent = 'Image loaded from DriveBC. Capture time is shown in the image.'; marker.getPopup()?.update(); };
        image.onerror = failed;
        timeout = setTimeout(failed, 15000);
        unlock = setTimeout(() => { if (alive) button.disabled = false; }, 60000);
        image.src = `${camera.imageURL}?t=${Math.floor(Date.now() / 60000)}`;
      }
      select.addEventListener('change', loadImage); button.addEventListener('click', loadImage);
      preview = { marker, popup: marker.getPopup(), cancel: () => { alive = false; stopImage(); } };
      loadImage();
      return box;
    }
    function clearMarkers() { closePreview(); group.clearLayers(); displayed.clear(); }
    function render() {
      if (!coversBC()) { clearMarkers(); report('DriveBC webcams cover British Columbia. Move the map to BC to see cameras.'); return; }
      const data = snapshot && Date.now() - snapshot.checked <= maxCacheAge ? snapshot : null;
      const sites = data ? data.sites.filter(site => inView(site.point)) : [];
      const visible = new Map(sites.map(site => [site.id, site]));
      for (const [id, entry] of displayed) {
        if (visible.get(id) === entry.site) continue;
        if (preview?.marker === entry.marker) closePreview();
        group.removeLayer(entry.marker); displayed.delete(id);
      }
      for (const site of sites) {
        if (displayed.has(site.id)) continue;
        const icon = L.divIcon({ className: 'drivebc-camera-marker', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 6 9.5 3.5h5L16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12.5" r="4"/></svg>', iconSize: [32, 32], iconAnchor: [16, 16] });
        const marker = L.marker(site.point, { icon, title: `DriveBC webcam: ${site.name} (${site.cameras.length} ${site.cameras.length === 1 ? 'view' : 'views'})`, alt: `DriveBC webcam: ${site.name}`, keyboard: true, riseOnHover: true, bubblingMouseEvents: false });
        // Keep DOM content stable when Leaflet updates the popup after an image loads.
        marker.bindPopup('', { maxWidth: 420, minWidth: 150 });
        marker.on('popupopen', () => marker.getPopup().setContent(popup(site, marker)));
        marker.on('popupclose', () => { if (preview?.marker === marker) { const old = preview; preview = null; old.cancel(); } });
        marker.addTo(group); displayed.set(site.id, { site, marker });
      }
      const waiting = retryAt > Date.now();
      const error = waiting ? ' Camera locations could not refresh; another check will run later.' : '';
      if (!data) report(waiting ? 'Camera locations are unavailable. Another check will run later.' : 'Loading DriveBC camera locations…', waiting);
      else report(`${sites.length} camera ${sites.length === 1 ? 'location' : 'locations'} in this view · tap a camera for its images.${error}`, waiting);
    }
    function cancel() { version++; controller?.abort(); controller = null; clearTimeout(refresh); clearTimeout(debounce); }
    function schedule(delay) {
      clearTimeout(refresh);
      const expires = snapshot ? snapshot.checked + maxCacheAge - Date.now() + 1 : 0;
      if (expires > 0) delay = Math.min(delay, expires);
      if (enabled && !document.hidden && coversBC()) refresh = setTimeout(load, Math.max(0, Math.min(2147483647, delay)));
    }
    async function load() {
      if (!enabled || document.hidden) return;
      clearTimeout(refresh); render();
      if (!coversBC()) { cancel(); return; }
      if (controller) return;
      if (Date.now() < retryAt) { schedule(retryAt - Date.now()); return; }
      if (snapshot && Date.now() - snapshot.checked < refreshEvery) { schedule(refreshEvery - (Date.now() - snapshot.checked)); return; }
      const requestVersion = version, active = new AbortController(); controller = active;
      const timeout = setTimeout(() => active.abort(), 15000);
      let delay = refreshEvery;
      try {
        const response = await fetch(config.cameraCatalogueURL, { signal: active.signal, credentials: 'omit' });
        if (!response.ok) {
          const error = new Error('Camera catalogue unavailable');
          const retry = response.headers.get('Retry-After');
          error.retryAfter = retry === null ? 0 : /^\d+(\.\d+)?$/.test(retry.trim()) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
          throw error;
        }
        const sites = window.GregleCamerasCore.readCatalogue(await response.text());
        if (requestVersion !== version || !enabled || document.hidden) return;
        snapshot = { sites, checked: Date.now() }; failures = 0; retryAt = 0;
      } catch (error) {
        if (requestVersion !== version || !enabled || document.hidden) return;
        failures++;
        delay = Math.max(Number.isFinite(error.retryAfter) ? error.retryAfter : 0, Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6)));
        retryAt = Date.now() + delay;
        notify('DriveBC camera locations could not refresh. Open Layers for details.', 'drivebc-cameras');
      } finally {
        clearTimeout(timeout);
        if (requestVersion === version) { controller = null; render(); schedule(delay); }
      }
    }
    function setEnabled(value) {
      const next = value === true; if (next === enabled) return;
      enabled = next; cancel();
      if (enabled) { group.addTo(map); map.attributionControl.addAttribution(attribution); load(); }
      else { clearMarkers(); map.removeLayer(group); map.attributionControl.removeAttribution(attribution); }
    }
    map.on('moveend', () => {
      if (!enabled || document.hidden) return;
      clearTimeout(debounce); debounce = setTimeout(load, 150);
    });
    document.addEventListener('visibilitychange', () => { if (!enabled) return; if (document.hidden) { cancel(); closePreview(); } else load(); });
    window.addEventListener('pagehide', () => { cancel(); closePreview(); });
    window.addEventListener('pageshow', event => { if (event.persisted && enabled) load(); });
    return { setEnabled };
  };
})();
