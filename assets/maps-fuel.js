(() => {
  'use strict';
  window.GregleFuel = ({map, config}) => {
    const core = window.GregleFuelCore, $ = id => document.getElementById(id);
    const card = $('map-fuel-card'), cities = L.layerGroup(), stations = L.layerGroup(), cache = new Map();
    const credit = 'Fuel locations: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · Daily city averages: <a href="https://charting.kalibrate.com/" target="_blank" rel="noopener">Kalibrate Canada</a>';
    let enabled = false, fuel = 'regular', report, priceRequest, stationRequest, version = 0, moveTimer, refreshTimer, lastPriceFetch = 0, retryAfter = 0;
    let stationMessage = '', priceError = '', stationAction = '', stationTimer, stationAttempts = 0;
    const storageKey = 'gregle-maps-fuel-stations-v1';
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw && raw.length < 1500000 ? JSON.parse(raw) : null;
      if (saved?.endpoint === config.fuelStationsURL && Array.isArray(saved.entries)) for (const value of saved.entries.slice(-6)) {
        try { const entry = core.stationCache(value); cache.set(entry.area.join(','), entry); } catch {}
      }
    } catch {}
    function persistStations() {
      try {
        const entries = [...cache.values()].slice(-6);
        let raw = JSON.stringify({endpoint: config.fuelStationsURL, entries});
        while (raw.length >= 1500000 && entries.length) { entries.shift(); raw = JSON.stringify({endpoint: config.fuelStationsURL, entries}); }
        localStorage.setItem(storageKey, raw);
      } catch {}
    }
    const bounds = () => { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; };
    const dateLabel = date => new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
    const element = (tag, content, className) => { const node = document.createElement(tag); node.textContent = content; if (className) node.className = className; return node; };
    function draw() {
      if (!enabled) return;
      cities.clearLayers();
      const usable = report && core.age(report.date) >= 0 && core.age(report.date) <= 4;
      const box = bounds(), center = map.getCenter(), selected = usable ? core.select(report.markets, center, box, fuel) : null;
      $('fuel-card-place').textContent = selected ? `${selected.name}, ${selected.province}` : 'Canadian fuel prices';
      $('fuel-card-price').textContent = selected ? core.format(selected.prices[fuel]) : '—';
      $('fuel-card-grade').textContent = `${core.fuels[fuel]} · CAD / litre`;
      $('fuel-card-area').textContent = selected ? `City survey average${!core.contains(box, selected) ? ` · ${Math.round(selected.distance)} km from map centre` : ''}` : usable ? 'No surveyed city in or within 50 km of this view. Zoom out to see coverage.' : priceError || 'Loading the latest daily survey…';
      const dated = usable ? `${core.age(report.date) === 0 ? 'Today’s survey' : 'Latest survey'}: ${dateLabel(report.date)}${core.age(report.date) > 0 ? ' · Today’s report is not available yet.' : ''}${report.delayed ? ' · Refresh delayed.' : ''}` : report ? 'Daily survey is out of date. Prices are hidden until a new report is available.' : priceError;
      $('fuel-card-date').textContent = dated;
      $('fuel-card-stations').textContent = stationMessage;
      const action = $('fuel-pin-action');
      action.hidden = !stationAction; action.disabled = stationAction === 'retry' && Date.now() < retryAfter;
      action.textContent = stationAction === 'zoom' ? 'Zoom in for petrol stations' : action.disabled ? 'Waiting to retry stations…' : 'Retry petrol stations';
      $('fuel-layer-status').textContent = [dated, stationMessage].filter(Boolean).join(' ');
      $('fuel-retry').hidden = !priceError && !stationMessage.includes('unavailable');
      if (!usable) return;
      for (const city of report.markets.filter(item => item.prices[fuel] !== null && core.contains(box, item))) {
        const label = core.format(city.prices[fuel]), html = `<span>${label}</span>`;
        const marker = L.marker([city.lat, city.lng], {icon: L.divIcon({className: 'fuel-average-marker', html, iconSize: [72, 28], iconAnchor: [36, 14]}), title: `${city.name}: ${label}/L ${core.fuels[fuel]} city average, ${dateLabel(report.date)}`, keyboard: true, zIndexOffset: 500});
        const popup = element('div', '', 'fuel-popup');
        popup.append(element('strong', `${city.name}, ${city.province}`), element('p', `${core.fuels[fuel]} city average: ${label} CAD/L`), element('p', `Survey: ${dateLabel(report.date)}. Individual station prices vary.`));
        marker.bindPopup(popup).addTo(cities);
      }
    }
    function drawStations(entry, box, saved = false) {
      stations.clearLayers();
      const items = core.stations(entry, box);
      for (const point of items) {
        const marker = L.marker([point.lat, point.lng], {icon: L.divIcon({className: 'fuel-station-marker', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M3 21h12M7 7h4v5H7zM14 13h2a2 2 0 0 1 2 2v3a1.5 1.5 0 0 0 3 0V9l-4-4M18 6v4h3"/></svg>', iconSize: [30, 34], iconAnchor: [15, 17]}), title: point.name, keyboard: true});
        const popup = element('div', '', 'fuel-popup');
        popup.append(element('strong', point.name));
        if (point.address) popup.append(element('p', point.address));
        if (point.hours) popup.append(element('p', `Opening hours: ${point.hours}`));
        if (point.access) popup.append(element('p', `Access: ${point.access}`));
        popup.append(element('p', 'Station location from OpenStreetMap. The area average is not this station’s price.'));
        const link = element('a', 'View OpenStreetMap record ↗'); link.href = `https://www.openstreetmap.org/${point.id}`; link.target = '_blank'; link.rel = 'noopener'; popup.append(link);
        marker.bindPopup(popup).addTo(stations);
      }
      stationAction = '';
      stationMessage = `${items.length} ${saved ? 'saved' : 'mapped'} petrol stations in this view.${entry.truncated ? ' Zoom in to see more.' : ''}${entry.gregle?.stale ? ' Locations are cached while the source refreshes.' : ''}`;
      draw();
    }
    function retryStations(delay) {
      clearTimeout(stationTimer);
      if (enabled && !document.hidden) stationTimer = setTimeout(() => {
        if (stationAttempts < 3) loadStations(); else draw();
      }, delay);
    }
    async function loadStations() {
      clearTimeout(moveTimer); clearTimeout(stationTimer); stationRequest?.abort();
      if (!enabled || document.hidden) return;
      const box = core.stationArea(bounds(), map.getZoom());
      if (!box) { stations.clearLayers(); stationAction = 'zoom'; stationMessage = 'Zoom in to show petrol station pins.'; draw(); return; }
      const snapped = [Math.floor(box[0] * 20) / 20, Math.floor(box[1] * 20) / 20, Math.ceil(box[2] * 20) / 20, Math.ceil(box[3] * 20) / 20], key = snapped.join(',');
      const entries = [...cache.values()].filter(entry => Date.now() - entry.fetchedAt < 7 * 86400000).sort((a, b) => b.fetchedAt - a.fetchedAt);
      const covering = entries.find(entry => core.covers(entry.area, box));
      const entry = covering || entries.find(item => core.stations(item, box).length);
      if (entry) drawStations(entry, box, true); else stations.clearLayers();
      if (covering && Date.now() - covering.fetchedAt < 86400000) { stationAttempts = 0; return; }
      const retained = entry ? core.stations(entry, box).length : 0;
      const failed = () => {
        stationAttempts++; retryAfter = Math.max(retryAfter, Date.now() + 60000); stationAction = 'retry';
        stationMessage = `${retained ? `${retained} saved petrol stations shown. ` : 'Petrol station service is unavailable. '}${stationAttempts < 3 ? 'Retrying shortly.' : 'Please retry shortly.'}`;
        draw(); retryStations(retryAfter - Date.now());
      };
      if (Date.now() < retryAfter) {
        stationAction = 'retry'; stationMessage = `${retained ? `${retained} saved petrol stations shown. ` : ''}Waiting to retry the petrol station service.`;
        draw(); retryStations(retryAfter - Date.now()); return;
      }
      const current = version, controller = new AbortController(); stationRequest = controller;
      stationAction = ''; stationMessage = retained ? `${retained} saved petrol stations shown. Updating locations…` : 'Loading petrol station pins…'; draw();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 65000);
      try {
        const url = new URL(config.fuelStationsURL); url.searchParams.set('bbox', key);
        const response = await fetch(url, {signal: controller.signal});
        if (!response.ok) { retryAfter = Date.now() + Math.min(3600, Math.max(60, Number(response.headers.get('Retry-After')) || 60)) * 1000; throw Error('unavailable'); }
        const data = await response.json();
        if (!enabled || current !== version || controller.signal.aborted) return;
        const received = core.stationCache(data);
        cache.set(received.area.join(','), received); if (cache.size > 20) cache.delete(cache.keys().next().value);
        persistStations(); stationAttempts = 0; retryAfter = 0; drawStations(received, box);
      } catch { if (enabled && current === version && (timedOut || !controller.signal.aborted)) failed(); }
      finally { clearTimeout(timeout); if (stationRequest === controller) stationRequest = null; }
    }
    function schedule() {
      clearTimeout(refreshTimer);
      if (enabled && !document.hidden) refreshTimer = setTimeout(() => { loadPrices(); }, 1800000);
    }
    async function loadPrices() {
      if (!enabled || document.hidden || priceRequest) return;
      const current = version, controller = new AbortController(); priceRequest = controller;
      try {
        const response = await fetch(config.fuelPricesURL, {signal: controller.signal});
        if (!response.ok) throw Error('unavailable');
        const data = await response.json();
        if (!enabled || current !== version || controller.signal.aborted) return;
        report = core.read(data); priceError = ''; lastPriceFetch = Date.now(); draw();
      } catch { if (enabled && current === version && !controller.signal.aborted) { priceError = 'The latest daily survey is unavailable. Try again later.'; draw(); } }
      finally { if (priceRequest === controller) priceRequest = null; schedule(); }
    }
    function cancel() {
      version++; priceRequest?.abort(); stationRequest?.abort(); priceRequest = stationRequest = null;
      clearTimeout(moveTimer); clearTimeout(refreshTimer); clearTimeout(stationTimer);
    }
    map.on('movestart', () => { if (enabled) { stationRequest?.abort(); clearTimeout(moveTimer); clearTimeout(stationTimer); } });
    map.on('moveend', () => { if (enabled) { stationAttempts = 0; draw(); clearTimeout(moveTimer); moveTimer = setTimeout(loadStations, 650); } });
    const retry = () => { stationAttempts = 0; loadPrices(); loadStations(); };
    $('fuel-retry').addEventListener('click', retry);
    $('fuel-pin-action').addEventListener('click', () => {
      if (stationAction === 'zoom') map.setView(map.getCenter(), Math.max(12, map.getZoom() + 1));
      else retry();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); else if (enabled) { draw(); if (Date.now() - lastPriceFetch >= 1800000) loadPrices(); else schedule(); loadStations(); } });
    window.addEventListener('pagehide', cancel);
    window.addEventListener('pageshow', event => { if (event.persisted && enabled) { draw(); loadPrices(); loadStations(); } });
    return {setSelection(next, type = 'regular') {
      const wasEnabled = enabled; enabled = next === true; fuel = Object.hasOwn(core.fuels, type) ? type : 'regular'; card.hidden = !enabled;
      if (!enabled) { cancel(); map.removeLayer(cities); map.removeLayer(stations); cities.clearLayers(); stations.clearLayers(); if (wasEnabled) map.attributionControl?.removeAttribution(credit); return; }
      if (!wasEnabled) { cities.addTo(map); stations.addTo(map); map.attributionControl?.addAttribution(credit); }
      draw();
      if (!report || Date.now() - lastPriceFetch >= 1800000) loadPrices(); else schedule();
      if (!wasEnabled) { stationAttempts = 0; loadStations(); }
    }};
  };
})();
