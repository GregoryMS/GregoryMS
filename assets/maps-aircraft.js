(() => {
  'use strict';
  window.GregleAircraft = ({ map, notify }) => {
    const core = window.GregleAircraftCore;
    const output = document.getElementById('aircraft-layer-status'), refresh = document.getElementById('aircraft-refresh');
    const group = L.layerGroup(), displayed = new Map();
    const credit = 'Aircraft: <a href="https://pocketworld.org/api" target="_blank" rel="noopener">PocketWorld</a> / <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a> / <a href="https://opensky-network.org" target="_blank" rel="noopener">OpenSky</a> / <a href="https://adsb.lol" target="_blank" rel="noopener">ADSB.lol</a>';
    const endpoint = 'https://gregle-aircraft.square-rain-5ded.workers.dev/aircraft', interval = 15000;
    let enabled = false, suspended = false, active, snapshot, timer, expiryTimer, version = 0, nextRequest = 0, retryAt = 0, failures = 0;
    const bounds = () => { const b = map.getBounds(); return [b.getWest(), Math.max(-85.05113, b.getSouth()), b.getEast(), Math.min(85.05113, b.getNorth())]; };
    const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; refresh.textContent = failures ? 'Retry aircraft' : 'Refresh aircraft'; };
    const make = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
    const clock = time => new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const symbols = {
      airliner: { label: 'Aircraft', shape: '<path d="M14 2h4l1 11 10 6v3l-10-4v8l4 3v2l-7-2-7 2v-2l4-3v-8L3 22v-3l10-6Z"/>' },
      'small-plane': { label: 'Small plane', shape: '<path d="M14.5 6Q16 2 17.5 6L18 12l12 1v4l-12-.5-.5 9.5 5 2v2L16 29l-6.5 1v-2l5-2-.5-9.5L2 17v-4l12-1Z"/><path d="M11 5h10" class="aircraft-detail"/>' },
      helicopter: { label: 'Helicopter', shape: '<path d="M5 1 28 22l-2 2L3 3Z"/><path d="m27 1 2 2L6 24l-2-2Z"/><path d="M14.5 18h3l1 10h3v3h-11v-3h3Z"/><ellipse cx="16" cy="12" rx="4.5" ry="7.5"/><path d="M13 9q3-2 6 0" class="aircraft-detail"/>' }
    };
    function popup(plane, marker) {
      const box = make('div', null, 'aircraft-popup'), facts = make('dl');
      const width = Math.max(140, Math.min(270, map.getSize().x - 120));
      box.style.width = `${width}px`;
      Object.assign(marker.getPopup().options, { minWidth: width, maxWidth: width, maxHeight: Math.max(100, map.getSize().y - 220) });
      box.append(make('strong', plane.callsign || plane.registration || plane.id.toUpperCase(), 'aircraft-title'));
      if (plane.description || plane.type) box.append(make('p', plane.description || plane.type));
      const add = (label, value) => { if (value !== '' && value != null) facts.append(make('dt', label), make('dd', String(value))); };
      add('Registration', plane.registration); add('Aircraft type', plane.type);
      add('Altitude', plane.ground ? 'On the ground' : plane.altitude === null ? 'Not reported' : `${Math.round(plane.altitude).toLocaleString()} ft`);
      add('Ground speed', plane.speed === null ? 'Not reported' : `${Math.round(plane.speed)} kn`);
      add('Track', plane.heading === null ? 'Not reported' : `${Math.round(plane.heading)}°`);
      add('Vertical speed', plane.verticalRate === null ? null : `${plane.verticalRate > 0 ? '+' : ''}${Math.round(plane.verticalRate).toLocaleString()} ft/min`);
      add('Squawk', plane.squawk); add('ICAO address', plane.id.toUpperCase());
      box.append(facts, make('p', `${plane.source} · position reported ${clock(plane.updated)}`, 'aircraft-meta'));
      const link = make('a', 'Open flight map ↗'); link.href = `https://pocketworld.org/?mode=flights&lat=${plane.point[0]}&lng=${plane.point[1]}&zoom=10`; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
      return box;
    }
    function icon(plane) {
      const kind = Object.hasOwn(symbols, plane.kind) ? plane.kind : 'airliner';
      return L.divIcon({ className: `aircraft-marker aircraft-${kind}`, iconSize: [34, 34], iconAnchor: [17, 17], html: `<svg viewBox="0 0 32 32" style="transform:rotate(${plane.heading ?? 0}deg)" aria-hidden="true">${symbols[kind].shape}</svg>` });
    }
    function clear() { group.clearLayers(); displayed.clear(); }
    function render() {
      if (!enabled || suspended || document.hidden) return;
      const view = bounds(), area = core.area(view, map.getZoom()), now = Date.now();
      if (!area) { clear(); report('Zoom in to show aircraft across this view (up to 250 nautical miles).'); return; }
      const records = new Map((snapshot?.aircraft || []).filter(p => now - p.updated < core.maxAge && core.visible(p.point, view)).map(p => [p.id, p]));
      for (const [id, entry] of displayed) if (!records.has(id)) { group.removeLayer(entry.marker); displayed.delete(id); }
      for (const plane of records.values()) {
        const title = `${symbols[plane.kind]?.label || 'Aircraft'}: ${plane.callsign || plane.registration || plane.id.toUpperCase()}`;
        const point = [plane.point[0], plane.point[1] + 360 * Math.round((map.getCenter().lng - plane.point[1]) / 360)];
        const previous = displayed.get(plane.id);
        if (previous) {
          if (previous.plane === plane && previous.worldLng === point[1]) continue;
          previous.plane = plane; previous.worldLng = point[1];
          // Updating a live plane must not repeatedly pan the map after its popup opens.
          const card = previous.marker.getPopup(), autoPan = card.options.autoPan;
          card.options.autoPan = false;
          previous.marker.setLatLng(point);
          previous.marker.options.title = title; previous.marker.options.alt = title; previous.marker.setIcon(icon(plane));
          previous.marker.setPopupContent(() => popup(plane, previous.marker));
          card.options.autoPan = autoPan;
        } else {
          const marker = L.marker(point, { title, alt: title, icon: icon(plane), keyboard: true, riseOnHover: true, bubblingMouseEvents: false, zIndexOffset: 100 });
          marker.bindPopup(() => popup(plane, marker), { minWidth: 140, maxWidth: 290, autoPanPaddingTopLeft: [12, 90], autoPanPaddingBottomRight: [68, 35] }).addTo(group);
          displayed.set(plane.id, { marker, plane, worldLng: point[1] });
        }
      }
      const count = records.size, message = `${count} aircraft in this view.`;
      if (failures) report(`${message} Aircraft feed unavailable; retrying after a short pause. Positions disappear after two minutes.`, true);
      else if (active || !snapshot || !core.covers(snapshot.area, view)) report(`${count ? message + ' ' : ''}Loading aircraft for this area…`);
      else report(`${message} Updated ${clock(snapshot.time)} · refreshes every 15 seconds. Coverage varies.${snapshot.limited ? ' Results limited; zoom in for more.' : ''}`);
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
      const timeout = setTimeout(() => request.controller.abort(), 12000);
      render();
      try {
        const url = new URL(endpoint); url.search = new URLSearchParams({ lat: area.lat, lon: area.lng, radius: area.radius });
        const response = await fetch(url.href, { signal: request.controller.signal, credentials: 'omit' });
        if (!response.ok) {
          const error = new Error('Aircraft unavailable'), value = response.headers.get('Retry-After');
          error.retryAfter = value && /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value || '') - Date.now()) || 0;
          throw error;
        }
        const result = core.read(await response.json(), Date.now());
        if (token !== version) return;
        snapshot = { ...result, area, time: Date.now() }; failures = 0; retryAt = 0;
      } catch (error) {
        if (token !== version) return;
        failures++;
        retryAt = Date.now() + Math.max(Math.min(900000, Number(error.retryAfter) || 0), Math.min(300000, 30000 * 2 ** Math.min(failures - 1, 4)));
        if (failures === 1) notify('Live aircraft are temporarily unavailable. Open Layers to retry.', 'aircraft');
      } finally {
        clearTimeout(timeout);
        if (token === version) { active = null; render(); schedule(); }
      }
    }
    function setEnabled(value) {
      if (enabled === (value === true)) return;
      enabled = value === true; cancel();
      if (enabled) { group.addTo(map); map.attributionControl.addAttribution(credit); load(); scheduleExpiry(); }
      else { snapshot = null; clear(); map.removeLayer(group); map.attributionControl.removeAttribution(credit); }
    }
    refresh.addEventListener('click', load);
    map.on('moveend', () => { if (enabled && !suspended && !document.hidden) { render(); schedule(650); } });
    document.addEventListener('visibilitychange', () => {
      if (!enabled) return;
      if (document.hidden) { cancel(); snapshot = null; clear(); }
      else { load(); scheduleExpiry(); }
    });
    window.addEventListener('pagehide', () => { suspended = true; cancel(); snapshot = null; clear(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { suspended = false; if (enabled) { load(); scheduleExpiry(); } } });
    return { setEnabled };
  };
})();
