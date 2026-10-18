(() => {
  'use strict';
  window.GregleEVCharging = ({ map, config, notify }) => {
    const core = window.GregleEVCore, maps = window.GregleMaps, places = window.GreglePlaceData;
    const output = document.getElementById('ev-layer-status'), retry = document.getElementById('ev-retry');
    const group = L.layerGroup(), displayed = new Map(), cache = [];
    const credit = 'EV charging: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
    const cacheAge = 600000, fallbackAge = 3600000, requestGap = 10000;
    let enabled = false, active, version = 0, timer, nextRequest = 0, retryAt = 0, failures = 0;
    const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; };
    const make = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
    const link = (text, href) => { const el = make('a', text); el.href = href; if (href.startsWith('https:') || href.startsWith('http:')) { el.target = '_blank'; el.rel = 'noopener noreferrer'; } return el; };
    function bounds() {
      const b = map.getBounds(), west = maps.wrapLongitude(b.getWest());
      return [west, b.getSouth(), west + b.getEast() - b.getWest(), b.getNorth()];
    }
    function visible(point, view) {
      const lng = view[0] + ((point[1] - view[0]) % 360 + 360) % 360;
      return point[0] >= view[1] && point[0] <= view[3] && lng <= view[2];
    }
    function showHours(schedule, target) {
      if (!schedule.weekly) { target.textContent = schedule.raw; return; }
      target.className = 'place-hours';
      const table = make('table'); table.setAttribute('aria-label', 'Weekly charging access hours');
      const body = make('tbody');
      for (const day of schedule.days) {
        const row = make('tr'), label = make('th', day.day), times = make('td'); label.scope = 'row';
        if (day.closed) row.className = 'place-hours-closed';
        for (const time of day.times) times.append(make('div', time));
        row.append(label, times); body.append(row);
      }
      table.append(body); target.append(table);
      for (const note of schedule.notes) target.append(make('p', `${note.label}: ${note.times.join(', ')}`));
    }
    function popup(station, marker) {
      const box = make('div', null, 'ev-popup'), size = map.getSize(), width = Math.max(150, Math.min(320, size.x - 120));
      box.style.width = `${width}px`;
      Object.assign(marker.getPopup().options, { minWidth: width, maxWidth: width, maxHeight: Math.max(80, size.y - 220) });
      box.append(make('strong', station.name, 'ev-title'), make('p', 'EV charging station · OpenStreetMap', 'ev-meta'));
      if (station.address) box.append(make('p', station.address));
      const tags = station.tags, facts = make('dl', null, 'ev-facts');
      const add = (label, value) => { if (value) facts.append(make('dt', label), make('dd', value)); };
      add('Network', tags.network); add('Operator', tags.operator);
      add('Access', ({ yes: 'Public', permissive: 'Public', private: 'Private', no: 'No public access', customers: 'Customers only', permit: 'Permit required', destination: 'Destination users' })[tags.access] || tags.access || 'Not recorded');
      add('Fee', ({ yes: 'A fee applies', no: 'No charging fee recorded' })[tags.fee] || tags.fee);
      add('Charging spaces', tags.capacity); add('Maximum output', tags['charging_station:output']);
      box.append(facts, make('strong', 'Connectors', 'ev-subheading'));
      if (station.connectors.length) {
        const list = make('ul', null, 'ev-connectors');
        for (const socket of station.connectors) list.append(make('li', [socket.name, socket.count ? `${socket.count} ${socket.count === 1 ? 'socket' : 'sockets'}` : '', socket.output].filter(Boolean).join(' · ')));
        box.append(list);
      } else box.append(make('p', 'Connector types not recorded.'));
      const contacts = make('dl', null, 'ev-facts');
      for (const fact of places.facts(tags).filter(fact => ['Phone', 'Website', 'Hours', 'Hours note'].includes(fact.label))) {
        const value = make('dd');
        if (fact.schedule) showHours(fact.schedule, value);
        else if (fact.href) value.append(link(fact.value, fact.href));
        else value.textContent = fact.value;
        contacts.append(make('dt', fact.label), value);
      }
      box.append(contacts, make('p', 'Mapped information; live charger availability is not included.', 'ev-meta'));
      const actions = make('div', null, 'ev-links'), [lat, lng] = station.point;
      actions.append(link('Check this area on PlugShare ↗', maps.plugshareURL({ lat, lng }, [lng - .01, lat - .01, lng + .01, lat + .01])), link('View OpenStreetMap details ↗', `https://www.openstreetmap.org/${station.id}`));
      box.append(actions); return box;
    }
    function clear() { group.clearLayers(); displayed.clear(); }
    function render() {
      if (!enabled) return;
      const view = bounds(), requestArea = core.area(view, map.getZoom());
      retry.hidden = failures === 0;
      if (!requestArea) { clear(); report('Zoom in to level 12 or closer to see EV charging stations.'); return; }
      const now = Date.now(), records = new Map();
      // Keep locations through short outages, but use only fresh, complete coverage to skip a request.
      for (const entry of cache) if (now - entry.time <= fallbackAge) for (const station of entry.stations) if (visible(station.point, view)) records.set(station.id, station);
      const coverage = cache.findLast(entry => now - entry.time < cacheAge && core.contains(entry.area, view) && (!entry.truncated || entry.area.every((value, i) => value === requestArea[i])));
      for (const [id, entry] of displayed) if (!records.has(id)) { group.removeLayer(entry.marker); displayed.delete(id); }
      for (const station of records.values()) {
        const previous = displayed.get(station.id);
        if (previous) {
          if (JSON.stringify(previous.station) !== JSON.stringify(station)) { previous.marker.setLatLng(station.point); previous.marker.setPopupContent(() => popup(station, previous.marker)); previous.station = station; }
          continue;
        }
        const icon = L.divIcon({ className: `ev-charge-marker${station.restricted ? ' ev-charge-restricted' : ''}`, iconSize: [32, 32], iconAnchor: [16, 16], html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v5m8-5v5M5 8h12v3a6 6 0 0 1-6 6v4m7-9h2v6a3 3 0 0 1-3 3"/><path d="m12 9-3 4h4l-2 3"/></svg>' });
        const marker = L.marker(station.point, { icon, title: `EV charging: ${station.name}`, alt: `EV charging: ${station.name}`, keyboard: true, riseOnHover: true, bubblingMouseEvents: false });
        marker.bindPopup(() => popup(station, marker), { minWidth: 150, maxWidth: 340, maxHeight: Math.max(80, map.getSize().y - 220), autoPanPaddingTopLeft: [12, 90], autoPanPaddingBottomRight: [68, 35] }).addTo(group);
        displayed.set(station.id, { marker, station });
      }
      const count = records.size, text = `${count} mapped charging ${count === 1 ? 'station' : 'stations'} in this view.`;
      if (active) report(`${text} Loading charging stations… The public data service can be slow.`);
      else if (failures) report(`${count ? text + ' Cached locations shown. ' : ''}Charging data is unavailable. Retry later or open PlugShare above.`, true);
      else if (coverage) report(`${text}${coverage.truncated ? ' Results are limited; zoom in for more stations.' : ''} No live availability.`);
      else report(`${text} Loading this area…`);
    }
    function cancel() { version++; active?.controller.abort(); active = null; clearTimeout(timer); }
    async function load(force = false) {
      clearTimeout(timer);
      if (!enabled || document.hidden) return;
      const view = bounds(), requestArea = core.area(view, map.getZoom()), now = Date.now();
      render();
      if (!requestArea || active) return;
      if (!force && cache.some(entry => now - entry.time < cacheAge && core.contains(entry.area, view) && (!entry.truncated || entry.area.every((value, i) => value === requestArea[i])))) return;
      if (now < retryAt) { report(`Please wait ${Math.ceil((retryAt - now) / 1000)} seconds before retrying charging stations. Cached locations may be shown.`, true); return; }
      if (now < nextRequest) { timer = setTimeout(() => load(force), nextRequest - now); return; }
      const token = version, request = { controller: new AbortController(), area: requestArea }; active = request;
      const timeout = setTimeout(() => request.controller.abort(), 45000); nextRequest = now + requestGap;
      render();
      try {
        const response = await fetch(config.evURL, { method: 'POST', body: new URLSearchParams({ data: core.query(requestArea) }), signal: request.controller.signal, credentials: 'omit' });
        if (!response.ok) {
          const error = new Error('Charging stations unavailable'), value = response.headers.get('Retry-After');
          error.retryAfter = value === null ? 0 : /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0;
          throw error;
        }
        const result = core.read(await response.json());
        if (token !== version || !enabled || document.hidden) return;
        cache.push({ ...result, area: requestArea, time: Date.now() }); while (cache.length > 12) cache.shift();
        failures = 0; retryAt = 0;
      } catch (error) {
        if (token !== version || !enabled || document.hidden) return;
        failures++; retryAt = Date.now() + Math.max(Number.isFinite(error.retryAfter) ? error.retryAfter : 0, Math.min(900000, 60000 * 2 ** Math.min(failures - 1, 4)));
        notify('EV charging data could not load. PlugShare above opens the area you are viewing.', 'ev');
      } finally {
        clearTimeout(timeout);
        if (token === version) { active = null; render(); if (!failures) timer = setTimeout(load, 650); }
      }
    }
    function setEnabled(value) {
      const next = value === true; if (next === enabled) return;
      enabled = next; cancel();
      if (enabled) { group.addTo(map); map.attributionControl.addAttribution(credit); load(); }
      else { clear(); map.removeLayer(group); map.attributionControl.removeAttribution(credit); }
    }
    retry.addEventListener('click', () => load(true));
    map.on('moveend', () => { if (enabled && !document.hidden) { render(); clearTimeout(timer); timer = setTimeout(load, 650); } });
    document.addEventListener('visibilitychange', () => { if (!enabled) return; if (document.hidden) cancel(); else load(); });
    window.addEventListener('pagehide', cancel);
    window.addEventListener('pageshow', event => { if (event.persisted && enabled) load(); });
    return { setEnabled };
  };
})();
