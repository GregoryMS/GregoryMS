(() => {
  'use strict';
  window.GregleAircraft = ({ map, notify }) => {
    const core = window.GregleAircraftCore;
    const output = document.getElementById('aircraft-layer-status'), refresh = document.getElementById('aircraft-refresh');
    document.getElementById('aircraft-altitude-gradient').style.background = core.altitudeGradient;
    document.getElementById('aircraft-altitude-neutral').style.background = core.neutralColour;
    const group = L.layerGroup(), displayed = new Map(), pathGroup = L.layerGroup();
    const histories = new Map(), tracks = new Map();
    let selectedAircraft = null, pinnedAircraft = null, hoveredAircraft = null, hoverTimer, trackRequest = null, trackVersion = 0, trackRetryAt = 0, pathState = '';
    const credit = 'Aircraft: <a href="https://pocketworld.org/api" target="_blank" rel="noopener">PocketWorld</a> / <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a> / <a href="https://opensky-network.org" target="_blank" rel="noopener">OpenSky</a> / <a href="https://adsb.lol" target="_blank" rel="noopener">ADSB.lol</a>';
    const endpoint = 'https://gregle-aircraft.square-rain-5ded.workers.dev/aircraft', interval = 15000;
    let enabled = false, suspended = false, active, snapshot, timer, expiryTimer, version = 0, nextRequest = 0, retryAt = 0, failures = 0, lastRequestArea = '';
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
      box.append(make('p', pathMessage(plane.id), 'aircraft-meta aircraft-path-status'));
      const link = make('a', 'Open flight map ↗'); link.href = `https://pocketworld.org/?mode=flights&lat=${plane.point[0]}&lng=${plane.point[1]}&zoom=10`; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
      return box;
    }
    function icon(plane) {
      const kind = Object.hasOwn(symbols, plane.kind) ? plane.kind : 'airliner';
      return L.divIcon({ className: `aircraft-marker aircraft-${kind}`, iconSize: [34, 34], iconAnchor: [17, 17], html: `<svg viewBox="0 0 32 32" style="fill:${core.altitudeColour(plane.altitude, plane.ground)};transform:rotate(${plane.heading ?? 0}deg)" aria-hidden="true">${symbols[kind].shape}</svg>` });
    }
    function pathMessage(id) {
      if (id !== selectedAircraft) return 'Hover over or click this aircraft to show up to two hours of its past flight path, where available.';
      const points = core.mergeTrack(tracks.get(id)?.points || [], histories.get(id) || [], Date.now());
      const segments = core.trackSegments(points, displayed.get(id)?.worldLng ?? 0);
      if (segments.length) return `${tracks.get(id)?.points.length > 1 ? 'Past flight path' : 'Live trail'} · ${points.length} reported positions since ${clock(points[0].updated)}.${pathState === 'loading' ? ' Loading earlier history…' : pathState === 'unavailable' ? ' Earlier history unavailable.' : ''}`;
      return pathState === 'loading' ? 'Loading past flight path…' : 'No continuous past path available yet. A trail builds as new positions arrive.';
    }
    function updatePathPopup() {
      const entry = displayed.get(selectedAircraft);
      if (!entry) return;
      const card = entry.marker.getPopup(), autoPan = card.options.autoPan;
      card.options.autoPan = false;
      entry.marker.setPopupContent(() => popup(entry.plane, entry.marker));
      card.options.autoPan = autoPan;
    }
    function renderPath() {
      pathGroup.clearLayers();
      const entry = displayed.get(selectedAircraft);
      if (!entry || !enabled || suspended || document.hidden) return;
      const points = core.mergeTrack(tracks.get(selectedAircraft)?.points || [], histories.get(selectedAircraft) || [], Date.now());
      const segments = core.trackSegments(points, entry.worldLng);
      if (!segments.length) return;
      const options = {interactive: false, bubblingMouseEvents: false, lineCap: 'round', lineJoin: 'round'};
      L.polyline(segments.map(segment => segment.points), {...options, color: '#ffffff', weight: 6, opacity: 0.8}).addTo(pathGroup);
      for (const segment of segments) L.polyline(segment.points, {...options, color: segment.colour, weight: 3, opacity: 1}).addTo(pathGroup);
    }
    function clearPath() {
      selectedAircraft = null; trackVersion++; trackRequest?.abort(); trackRequest = null; pathState = ''; pathGroup.clearLayers();
    }
    function rememberPositions(planes) {
      const now = Date.now();
      for (const plane of planes) {
        const previous = histories.get(plane.id) || [];
        histories.delete(plane.id); histories.set(plane.id, core.mergeTrack(previous, [plane], now));
      }
      for (const [id, points] of histories) if (!points.length || now - points.at(-1).updated > core.trackAge) histories.delete(id);
      if (histories.has(selectedAircraft)) { const points = histories.get(selectedAircraft); histories.delete(selectedAircraft); histories.set(selectedAircraft, points); }
      while (histories.size > 300) histories.delete(histories.keys().next().value);
    }
    async function selectAircraft(id) {
      if (selectedAircraft === id) return;
      clearPath(); selectedAircraft = id;
      const cached = tracks.get(id);
      if (cached && Date.now() - cached.checked < 30000) { pathState = cached.state; renderPath(); updatePathPopup(); return; }
      if (!/^[a-f0-9]{6}$/.test(id) || Date.now() < trackRetryAt) { pathState = 'unavailable'; renderPath(); updatePathPopup(); return; }
      pathState = 'loading'; renderPath(); updatePathPopup();
      const controller = new AbortController(), token = trackVersion; trackRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`${endpoint}/track/${id}`, {credentials: 'omit', signal: controller.signal});
        if (!response.ok) {
          const value = response.headers.get('Retry-After');
          const wait = value && /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value || '') - Date.now();
          trackRetryAt = Math.max(trackRetryAt, Date.now() + Math.min(900000, Math.max(30000, Number.isFinite(wait) ? wait : 0)));
          throw new Error('History unavailable');
        }
        const points = core.mergeTrack(cached?.points || [], core.readTrack(await response.json(), id, Date.now()), Date.now());
        if (token !== trackVersion || selectedAircraft !== id) return;
        pathState = points.length > 1 ? 'ready' : 'unavailable';
        tracks.delete(id); tracks.set(id, {points, state: pathState, checked: Date.now()});
        while (tracks.size > 20) tracks.delete(tracks.keys().next().value);
      } catch {
        if (token !== trackVersion || selectedAircraft !== id) return;
        pathState = 'unavailable';
        trackRetryAt = Math.max(trackRetryAt, Date.now() + 30000);
      } finally {
        clearTimeout(timeout);
        if (token === trackVersion && selectedAircraft === id) { trackRequest = null; renderPath(); updatePathPopup(); }
      }
    }
    function updatePathSelection() {
      const id = hoveredAircraft || pinnedAircraft;
      if (id) selectAircraft(id);
      else clearPath();
    }
    function clear() {
      clearTimeout(hoverTimer); pinnedAircraft = null; hoveredAircraft = null;
      clearPath(); group.clearLayers(); displayed.clear();
    }
    function render() {
      if (!enabled || suspended || document.hidden) return;
      const view = bounds(), area = core.area(view, map.getZoom()), now = Date.now();
      if (!area) { clear(); report('Zoom in to show aircraft across this view (up to 250 nautical miles).'); return; }
      const records = new Map((snapshot?.aircraft || []).filter(p => now - p.updated < core.maxAge && core.visible(p.point, view)).map(p => [p.id, p]));
      for (const [id, entry] of displayed) if (!records.has(id)) {
        if (id === pinnedAircraft) pinnedAircraft = null;
        if (id === hoveredAircraft) hoveredAircraft = null;
        group.removeLayer(entry.marker); displayed.delete(id);
      }
      if (selectedAircraft && !records.has(selectedAircraft)) updatePathSelection();
      for (const plane of records.values()) {
        const altitudeLabel = plane.ground ? 'On the ground' : plane.altitude === null ? 'Altitude not reported' : `${Math.round(plane.altitude).toLocaleString()} ft`;
        const title = `${symbols[plane.kind]?.label || 'Aircraft'}: ${plane.callsign || plane.registration || plane.id.toUpperCase()} · ${altitudeLabel}`;
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
          marker.on('mouseover', () => {
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => {
              if (!enabled || suspended || document.hidden || !displayed.has(plane.id)) return;
              hoveredAircraft = plane.id; updatePathSelection();
            }, 150);
          });
          marker.on('mouseout', () => {
            clearTimeout(hoverTimer);
            if (hoveredAircraft === plane.id) { hoveredAircraft = null; updatePathSelection(); }
          });
          marker.on('popupopen', () => {
            clearTimeout(hoverTimer); hoveredAircraft = null; pinnedAircraft = plane.id; updatePathSelection();
          });
          marker.on('popupclose', () => {
            if (pinnedAircraft === plane.id) { pinnedAircraft = null; updatePathSelection(); }
          });
        }
      }
      renderPath();
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
    function requestTime(area) {
      // New map areas need not wait for the periodic refresh of the previous area.
      return area?.key === lastRequestArea ? nextRequest : nextRequest - interval + 1200;
    }
    function schedule(delay = interval) {
      clearTimeout(timer);
      if (enabled && !suspended && !document.hidden) timer = setTimeout(load, Math.max(delay, retryAt - Date.now(), requestTime(core.area(bounds(), map.getZoom())) - Date.now()));
    }
    async function load() {
      clearTimeout(timer);
      if (!enabled || suspended || document.hidden) return;
      const area = core.area(bounds(), map.getZoom()); render();
      if (!area || active) return;
      const now = Date.now(), wait = Math.max(requestTime(area), retryAt) - now;
      if (wait > 0) { schedule(wait); return; }
      const token = version, request = { controller: new AbortController() }; active = request; lastRequestArea = area.key; nextRequest = now + interval;
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
        snapshot = { ...result, area, time: Date.now() }; rememberPositions(result.aircraft); failures = 0; retryAt = 0;
      } catch (error) {
        if (token !== version) return;
        failures++;
        retryAt = Date.now() + Math.max(Math.min(900000, Number(error.retryAfter) || 0), Math.min(300000, 30000 * 2 ** Math.min(failures - 1, 4)));
        if (failures === 1) notify('Live aircraft are temporarily unavailable. Open Layers to retry.', 'aircraft');
      } finally {
        clearTimeout(timeout);
        if (token === version) { active = null; render(); schedule(core.area(bounds(), map.getZoom())?.key === area.key ? interval : 650); }
      }
    }
    function setEnabled(value) {
      if (enabled === (value === true)) return;
      enabled = value === true; cancel();
      if (enabled) { group.addTo(map); pathGroup.addTo(map); map.attributionControl.addAttribution(credit); load(); scheduleExpiry(); }
      else { snapshot = null; clear(); histories.clear(); tracks.clear(); map.removeLayer(group); map.removeLayer(pathGroup); map.attributionControl.removeAttribution(credit); }
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
