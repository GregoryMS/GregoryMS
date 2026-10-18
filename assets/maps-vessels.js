(() => {
  'use strict';
  window.GregleVessels = ({ map, notify }) => {
    const core = window.GregleVesselsCore;
    const output = document.getElementById('vessels-layer-status'), refresh = document.getElementById('vessels-refresh');
    const group = L.layerGroup(), displayed = new Map();
    const credit = 'Vessels: <a href="https://openwaters.io/ais/" target="_blank" rel="noopener">Open Waters AIS</a> / <a href="https://www.aishub.net/" target="_blank" rel="noopener">AISHub</a> / <a href="https://aisstream.io/" target="_blank" rel="noopener">AISStream</a> / <a href="https://www.kystverket.no/en/sea-transport-and-ports/ais/access-to-ais-data/" target="_blank" rel="noopener">Kystverket</a> / <a href="https://www.digitraffic.fi/en/marine-traffic/" target="_blank" rel="noopener">Fintraffic</a>';
    const endpoint = 'https://gregle-vessels.square-rain-5ded.workers.dev/vessels', interval = 60000;
    let enabled = false, suspended = false, active, snapshot, timer, expiryTimer, version = 0, nextRequest = 0, retryAt = 0, failures = 0;
    const bounds = () => { const b = map.getBounds(); return [b.getWest(), Math.max(-85.05113, b.getSouth()), b.getEast(), Math.min(85.05113, b.getNorth())]; };
    const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; refresh.textContent = failures ? 'Retry vessels' : 'Refresh vessels'; };
    const make = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
    const clock = time => new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const legendToggle = document.getElementById('vessels-legend-toggle'), legend = document.getElementById('vessels-legend');
    const legendList = document.getElementById('vessels-legend-list');
    for (const type of core.vesselTypes) {
      const item = make('li'), swatch = make('span', null, 'vessels-type-swatch');
      swatch.style.backgroundColor = type.color; swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, make('span', type.label)); legendList.append(item);
    }
    function closeLegend(restoreFocus = false) {
      legend.hidden = true; legendToggle.setAttribute('aria-expanded', 'false');
      if (restoreFocus && !legendToggle.hidden) legendToggle.focus();
    }
    legendToggle.addEventListener('click', () => {
      if (!enabled) return;
      if (!legend.hidden) { closeLegend(); return; }
      legend.hidden = false; legendToggle.setAttribute('aria-expanded', 'true');
      document.getElementById('close-vessels-legend').focus({ preventScroll: true });
    });
    document.getElementById('close-vessels-legend').addEventListener('click', () => closeLegend(true));
    document.addEventListener('click', event => {
      if (!legend.hidden && !legend.contains(event.target) && !legendToggle.contains(event.target)) closeLegend();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !legend.hidden) { event.preventDefault(); closeLegend(true); }
    });
    function popup(vessel, marker) {
      const box = make('div', null, 'vessels-popup'), facts = make('dl');
      const width = Math.max(140, Math.min(270, map.getSize().x - 120));
      box.style.width = `${width}px`;
      Object.assign(marker.getPopup().options, { minWidth: width, maxWidth: width, maxHeight: Math.max(100, map.getSize().y - 220) });
      box.append(make('strong', vessel.name || `MMSI ${vessel.id}`, 'vessels-title'));
      const type = core.vesselStyle(vessel.type), typeLine = make('p', null, 'vessels-popup-type');
      const swatch = make('span', null, 'vessels-type-swatch');
      swatch.style.backgroundColor = type.color; swatch.setAttribute('aria-hidden', 'true');
      typeLine.append(swatch, make('span', vessel.type || type.label)); box.append(typeLine);
      const add = (label, value) => { if (value !== '' && value != null) facts.append(make('dt', label), make('dd', String(value))); };
      add('MMSI', vessel.id); add('Flag', vessel.country);
      add('Speed', vessel.speed === null ? 'Not reported' : `${vessel.speed.toFixed(1)} kn`);
      add('Course', vessel.course === null ? 'Not reported' : `${Math.round(vessel.course)}°`);
      add('Destination', vessel.destination || 'Not reported');
      const age = Math.max(0, Math.floor((Date.now() - vessel.updated) / 60000));
      box.append(facts, make('p', `${vessel.source} · position reported ${clock(vessel.updated)} · ${age < 1 ? 'less than a minute ago' : `${age} min ago`}`, 'vessels-meta'));
      box.append(make('p', 'AIS coverage and reporting delays vary. For information only; not for navigation.', 'vessels-meta'));
      const link = make('a', 'Open vessel map ↗'); link.href = 'https://openwaters.io/ais/vessels'; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
      return box;
    }
    function icon(vessel) {
      const type = core.vesselStyle(vessel.type);
      return L.divIcon({ className: `vessels-marker${vessel.heading === null ? ' vessels-no-heading' : ''}`, iconSize: [26, 32], iconAnchor: [13, 16], html: `<svg viewBox="0 0 26 32" style="--vessel-color:${type.color};transform:rotate(${vessel.heading ?? 0}deg)" aria-hidden="true">${vessel.heading === null ? '<circle cx="13" cy="16" r="7"/>' : '<path d="M13 2 22 15v14H4V15Z"/><path d="M13 11v12" class="vessels-deck"/>'}</svg>` });
    }
    function clear() { group.clearLayers(); displayed.clear(); }
    function mergeReports(previous, incoming, area) {
      const records = new Map(), now = Date.now();
      for (const vessel of [...previous, ...incoming]) {
        if (now - vessel.updated >= core.maxAge || !core.visible(vessel.point, area)) continue;
        if (!records.has(vessel.id) || records.get(vessel.id).updated < vessel.updated) records.set(vessel.id, vessel);
      }
      return [...records.values()].slice(0, 60000);
    }
    function render() {
      if (!enabled || suspended || document.hidden) return;
      const view = bounds(), area = core.area(view, map.getZoom()), now = Date.now();
      if (!area) { clear(); report('Zoom in to show vessels across this view.'); return; }
      const current = active?.preview || snapshot;
      const records = new Map((current?.vessels || []).filter(p => now - p.updated < core.maxAge && core.visible(p.point, view)).slice(0, 1500).map(p => [p.id, p]));
      for (const [id, entry] of displayed) if (!records.has(id)) { group.removeLayer(entry.marker); displayed.delete(id); }
      for (const vessel of records.values()) {
        const title = `Vessel: ${vessel.name || vessel.id} · ${vessel.type || core.vesselStyle(vessel.type).label}`;
        const point = [vessel.point[0], vessel.point[1] + 360 * Math.round((map.getCenter().lng - vessel.point[1]) / 360)];
        const previous = displayed.get(vessel.id);
        if (previous) {
          if (previous.vessel === vessel && previous.worldLng === point[1]) continue;
          previous.vessel = vessel; previous.worldLng = point[1];
          // Updating a live vessel must not repeatedly pan the map after its popup opens.
          const card = previous.marker.getPopup(), autoPan = card.options.autoPan;
          card.options.autoPan = false;
          previous.marker.setLatLng(point);
          previous.marker.options.title = title; previous.marker.options.alt = title; previous.marker.setIcon(icon(vessel));
          previous.marker.setPopupContent(() => popup(vessel, previous.marker));
          card.options.autoPan = autoPan;
        } else {
          const marker = L.marker(point, { title, alt: title, icon: icon(vessel), keyboard: true, riseOnHover: true, bubblingMouseEvents: false, zIndexOffset: 100 });
          marker.bindPopup(() => popup(vessel, marker), { minWidth: 140, maxWidth: 290, autoPanPaddingTopLeft: [12, 90], autoPanPaddingBottomRight: [68, 35] }).addTo(group);
          displayed.set(vessel.id, { marker, vessel, worldLng: point[1] });
        }
      }
      const count = records.size, message = `${count} vessels in this view.`;
      if (failures) report(`${count ? `${count} recently reported vessels in this view. Updates delayed; ` : 'Vessel feed temporarily unavailable; '}retrying automatically. Reports older than ten minutes are hidden.`, count === 0);
      else if (active || !snapshot || !core.covers(snapshot.area, view)) report(`${count ? message + ' ' : ''}Loading vessels for this area…`);
      else report(`${message} ${snapshot.cached ? 'Showing recent reports while the feed refreshes in the background.' : `Updated ${clock(snapshot.time)} · refreshes each minute.`} AIS coverage varies; an empty view does not confirm no vessels.${records.size >= 1500 ? ' Results limited; zoom in for more.' : snapshot.limited ? snapshot.cached ? ' Some reports may be delayed.' : ' Results limited; zoom in for more.' : ''}${snapshot.degraded ? ' Source coverage is currently reduced.' : ''}`);
    }
    function scheduleExpiry() {
      clearTimeout(expiryTimer);
      if (enabled && !suspended && !document.hidden) expiryTimer = setTimeout(() => { render(); scheduleExpiry(); }, 5000);
    }
    function cancel() { version++; active?.controller.abort(); active = null; clearTimeout(timer); clearTimeout(expiryTimer); }
    function schedule(delay = interval) {
      clearTimeout(timer);
      if (enabled && !suspended && !document.hidden) timer = setTimeout(load, Math.max(delay, retryAt - Date.now(), nextRequest - Date.now()));
    }
    async function load() {
      clearTimeout(timer);
      if (!enabled || suspended || document.hidden) return;
      const area = core.area(bounds(), map.getZoom()); render();
      if (!area || active) return;
      const now = Date.now(), wait = Math.max(nextRequest, retryAt) - now;
      if (wait > 0) { schedule(wait); return; }
      const token = version, request = { controller: new AbortController() }; active = request; nextRequest = now + interval;
      const timeout = setTimeout(() => request.controller.abort(), 65000);
      render();
      const vessels = new Map(); let received = 0, limited = false, degraded = false, cached = false;
      try {
        async function page(cursor = '', snapshotId = '') {
          const url = new URL(endpoint); url.search = new URLSearchParams({ bbox: area.join(','), ...(cursor ? { cursor, snapshot: snapshotId } : {}) });
          const response = await fetch(url.href, { signal: request.controller.signal, credentials: 'omit' });
          if (!response.ok) {
            const error = new Error('Vessels unavailable'), value = response.headers.get('Retry-After');
            error.status = response.status;
            error.retryAfter = value && /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value || '') - Date.now()) || 0;
            throw error;
          }
          const result = core.read(await response.json(), Date.now());
          if (token !== version) throw new Error('Cancelled vessel update');
          if (!/^[a-f0-9]{24}$/.test(result.snapshotId) || snapshotId && result.snapshotId !== snapshotId && !result.cached || result.cursor && (!/^[1-9]\d{3,4}$/.test(result.cursor) || +result.cursor <= +(cursor || 0) || +result.cursor % 5000)) throw new Error('Invalid vessel page');
          const credits = document.getElementById('vessels-source-credits');
          if (credits && result.credits.length) credits.replaceChildren(...result.credits.map(value => make('p', value)));
          received++; limited ||= result.limited; degraded ||= result.degraded; cached ||= result.cached;
          for (const vessel of result.vessels) if (!vessels.has(vessel.id) || vessels.get(vessel.id).updated < vessel.updated) vessels.set(vessel.id, vessel);
          request.preview = { vessels: mergeReports(snapshot?.vessels || [], [...vessels.values()], area) }; render();
          return result;
        }
        const first = await page();
        if (first.pages && first.cursor) {
          const queue = Array.from({ length: first.pages - 1 }, (_, i) => String((i + 1) * 5000));
          let offset = 0, failure, paused = false;
          // Three bounded requests avoid a slow page delaying every other region.
          async function consume() {
            while (offset < queue.length && !paused && token === version && !request.controller.signal.aborted) {
              const cursor = queue[offset++];
              try { await page(cursor, first.snapshotId); }
              catch (error) { failure ||= error; if (error.status === 429) paused = true; }
            }
          }
          await Promise.all(Array.from({ length: Math.min(3, queue.length) }, consume));
          if (failure) throw failure;
          if (received !== first.pages) throw new Error('Incomplete vessel update');
        } else {
          // Continue to work with a relay version that has no page count yet.
          let next = first;
          for (let i = 1; next.cursor && i < 12; i++) next = await page(next.cursor, first.snapshotId);
          if (next.cursor) limited = true;
        }
        snapshot = { vessels: mergeReports(snapshot?.vessels || [], [...vessels.values()], area), area, time: Date.now(), limited, degraded, cached }; failures = 0; retryAt = 0;
      } catch (error) {
        if (token !== version) return;
        if (received) {
          // Keep valid observations even when a later snapshot page fails.
          snapshot = { vessels: mergeReports(snapshot?.vessels || [], [...vessels.values()], area), area, time: Date.now(), limited: true, degraded: true, cached };
        }
        failures++;
        retryAt = Date.now() + Math.max(Math.min(900000, Number(error.retryAfter) || 0), Math.min(300000, 60000 * 2 ** Math.min(failures - 1, 4)));
        if (failures === 1 && !snapshot?.vessels.some(v => Date.now() - v.updated < core.maxAge && core.visible(v.point, bounds()))) notify('Live vessels are temporarily unavailable. Open Layers to retry.', 'vessels');
      } finally {
        clearTimeout(timeout);
        if (token === version) { active = null; render(); schedule(); }
      }
    }
    function setEnabled(value) {
      if (enabled === (value === true)) return;
      enabled = value === true; cancel();
      legendToggle.hidden = !enabled;
      if (!enabled) {
        const restoreFocus = legend.contains(document.activeElement) || document.activeElement === legendToggle;
        closeLegend();
        if (restoreFocus) document.getElementById('map-vessels')?.focus({ preventScroll: true });
      }
      if (enabled) { group.addTo(map); map.attributionControl.addAttribution(credit); load(); scheduleExpiry(); }
      else { snapshot = null; clear(); map.removeLayer(group); map.attributionControl.removeAttribution(credit); }
    }
    refresh.addEventListener('click', load);
    map.on('moveend', () => { if (enabled && !suspended && !document.hidden) { render(); if (!snapshot || !core.covers(snapshot.area, bounds())) schedule(650); } });
    document.addEventListener('visibilitychange', () => {
      if (!enabled) return;
      if (document.hidden) { cancel(); clear(); }
      else { load(); scheduleExpiry(); }
    });
    window.addEventListener('pagehide', () => { suspended = true; cancel(); clear(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { suspended = false; if (enabled) { load(); scheduleExpiry(); } } });
    return { setEnabled };
  };
})();
