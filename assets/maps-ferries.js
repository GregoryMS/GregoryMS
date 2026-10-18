(() => {
  'use strict';
  window.GregleDriveBCFerries = ({ map, config, notify }) => {
    const core = window.GregleFerriesCore, output = document.getElementById('drivebc-ferries-status');
    const group = L.layerGroup(), displayed = new Map();
    const attribution = 'Ferries: <a href="https://www.drivebc.ca/" target="_blank" rel="noopener">DriveBC</a> (<a href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc" target="_blank" rel="noopener">OGL-BC</a>), <a href="https://www.bcferries.com/" target="_blank" rel="noopener">BC Ferries</a>';
    const refreshEvery = 300000, maxCacheAge = 86400000;
    let enabled = false, snapshot, controller, version = 0, refresh, debounce, retryAt = 0, failures = 0;
    const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; };
    const time = value => new Date(value).toLocaleString(undefined, { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
    function coversBC() {
      const b = map.getBounds();
      return b.getSouth() <= 60.1 && b.getNorth() >= 48 && (b.getEast() - b.getWest() >= 360 || [-360, 0, 360].some(shift => b.getWest() + shift <= -114 && b.getEast() + shift >= -139.1));
    }
    function inView([lat, lng]) {
      const b = map.getBounds();
      return lat >= b.getSouth() && lat <= b.getNorth() && (b.getEast() - b.getWest() >= 360 || [-360, 0, 360].some(shift => lng >= b.getWest() + shift && lng <= b.getEast() + shift));
    }
    function officialLink(name, url) {
      const link = document.createElement('a'); link.textContent = name; link.href = url; link.target = '_blank'; link.rel = 'noopener'; return link;
    }
    function popup(ferry, marker) {
      const box = document.createElement('div'); box.className = 'drivebc-popup drivebc-ferry-popup';
      const size = map.getSize(), width = Math.max(150, Math.min(340, size.x - 120));
      box.style.width = `${width}px`;
      Object.assign(marker.getPopup().options, { minWidth: width, maxWidth: width, maxHeight: Math.max(80, size.y - 220) });
      const title = document.createElement('strong'); title.textContent = ferry.name;
      const type = document.createElement('p'); type.className = 'drivebc-meta'; type.textContent = ferry.kind === 'coastal' ? 'Coastal ferry terminal' : 'Inland ferry crossing';
      box.append(title, type);
      if (ferry.description) { const description = document.createElement('p'); description.textContent = ferry.description; box.append(description); }
      const old = Date.now() - Date.parse(snapshot.fetched) > maxCacheAge;
      if (old) { const stale = document.createElement('p'); stale.textContent = 'This schedule snapshot is old. Open the official schedule for current service information.'; box.append(stale); }
      if (ferry.routes.length) {
        const heading = document.createElement('strong'); heading.className = 'ferry-subheading'; heading.textContent = 'Routes and schedules';
        const list = document.createElement('ul'); list.className = 'ferry-routes';
        ferry.routes.forEach(route => { const item = document.createElement('li'); if (route.url) item.append(officialLink(route.name + ' ↗', route.url)); else item.textContent = route.name; list.append(item); });
        box.append(heading, list);
      }
      for (const [index, vessel] of ferry.vessels.entries()) {
        const heading = document.createElement('strong'); heading.className = 'ferry-subheading'; heading.textContent = vessel.name || (ferry.vessels.length > 1 ? `Ferry ${index + 1}` : 'Service information'); box.append(heading);
        const details = [vessel.crossing_time_min ? `${vessel.crossing_time_min} min crossing` : '', vessel.vehicle_capacity ? `${vessel.vehicle_capacity} vehicles` : '', vessel.passenger_capacity ? `${vessel.passenger_capacity} passengers` : ''].filter(Boolean);
        if (details.length) { const capacity = document.createElement('p'); capacity.textContent = details.join(' · '); box.append(capacity); }
        if (vessel.schedule && !old) { const schedule = document.createElement('p'); schedule.className = 'ferry-schedule'; schedule.textContent = vessel.schedule; box.append(schedule); }
        if (vessel.restriction && !old) { const restriction = document.createElement('p'); restriction.textContent = vessel.restriction; box.append(restriction); }
      }
      if (ferry.operator) { const operator = document.createElement('p'); operator.textContent = ferry.operator; box.append(operator); }
      if (ferry.phone) { const phone = document.createElement('p'); if (ferry.phoneURL) { const link = document.createElement('a'); link.href = ferry.phoneURL; link.textContent = ferry.phone; phone.append(link); } else phone.textContent = ferry.phone; box.append(phone); }
      const checked = document.createElement('p'); checked.className = 'drivebc-meta'; checked.textContent = `Snapshot checked ${time(snapshot.fetched)} · published about every 15 minutes`;
      const note = document.createElement('p'); note.className = 'drivebc-meta'; note.textContent = 'Published timetable information. Official schedules show the latest service updates.';
      const url = ferry.url || (ferry.kind === 'coastal' ? 'https://www.bcferries.com/routes-fares/schedules' : 'https://www2.gov.bc.ca/gov/content/transportation/passenger-travel/water-travel/inland-ferries');
      box.append(checked, note, officialLink('Official schedules and service information ↗', url));
      return box;
    }
    function clear() { group.clearLayers(); displayed.clear(); }
    function render() {
      if (!coversBC()) { clear(); report('DriveBC ferries cover British Columbia. Move the map to BC to see crossings and terminals.'); return; }
      const data = snapshot && Date.now() - snapshot.checked <= maxCacheAge ? snapshot : null;
      const ferries = data ? data.ferries.filter(ferry => inView(ferry.point)) : [], visible = new Set(ferries.map(ferry => ferry.id));
      const old = data && Date.now() - Date.parse(data.fetched) > maxCacheAge;
      for (const [id, entry] of displayed) if (!visible.has(id)) { group.removeLayer(entry.marker); displayed.delete(id); }
      for (const ferry of ferries) {
        const previous = displayed.get(ferry.id);
        if (previous) {
          if (JSON.stringify(previous.ferry) !== JSON.stringify(ferry) || previous.old !== old) {
            previous.marker.setLatLng(ferry.point); previous.marker.setPopupContent(() => popup(ferry, previous.marker)); previous.ferry = ferry; previous.old = old;
          }
          continue;
        }
        const icon = L.divIcon({ className: `drivebc-ferry-marker drivebc-ferry-${ferry.kind}`, html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 11V5h12v6M9 5V2h6v3M3 13l9-3 9 3-3 6H6Z"/><path d="M8 8h2m4 0h2M2 22c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/></svg>', iconSize: [32, 32], iconAnchor: [16, 16] });
        const marker = L.marker(ferry.point, { icon, title: `Ferry ${ferry.kind === 'coastal' ? 'terminal' : 'crossing'}: ${ferry.name}`, alt: ferry.name, keyboard: true, riseOnHover: true, bubblingMouseEvents: false });
        marker.bindPopup(() => popup(ferry, marker), { minWidth: 150, maxWidth: 360, maxHeight: Math.max(80, map.getSize().y - 220), autoPanPaddingTopLeft: [12, 90], autoPanPaddingBottomRight: [68, 35] }).addTo(group);
        displayed.set(ferry.id, { ferry, marker, old });
      }
      const failed = retryAt > Date.now();
      report(data ? `${ferries.length} ferry crossings and terminals in this view · snapshot checked ${time(data.fetched)}.${old ? ' Schedule snapshot is old; use official links.' : ''}${failed ? ' Refresh failed; cached locations shown while waiting to retry.' : ''}` : failed ? 'Ferry locations are unavailable. Another check will run later.' : 'Loading DriveBC ferry crossings and terminals…', failed || !!old);
    }
    function cancel() { version++; controller?.abort(); controller = null; clearTimeout(refresh); clearTimeout(debounce); }
    function schedule(delay) {
      clearTimeout(refresh);
      const now = Date.now(), deadlines = snapshot ? [snapshot.checked + maxCacheAge + 1, Date.parse(snapshot.fetched) + maxCacheAge + 1].filter(value => value > now) : [];
      if (deadlines.length) delay = Math.min(delay, Math.min(...deadlines) - now);
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
      const timeout = setTimeout(() => active.abort(), 12000); let delay = refreshEvery;
      try {
        const response = await fetch(config.ferriesURL, { signal: active.signal, credentials: 'omit', cache: 'no-cache' });
        if (!response.ok) {
          const error = new Error('Ferry snapshot unavailable'), retry = response.headers.get('Retry-After');
          error.retryAfter = retry === null ? 0 : /^\d+(\.\d+)?$/.test(retry.trim()) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
          throw error;
        }
        const data = core.read(await response.json(), Date.now());
        if (requestVersion !== version || !enabled || document.hidden) return;
        snapshot = { ...data, checked: Date.now() }; retryAt = 0; failures = 0;
      } catch (error) {
        if (requestVersion !== version || !enabled || document.hidden) return;
        failures++; delay = Math.max(Number.isFinite(error.retryAfter) ? error.retryAfter : 0, Math.min(900000, 60000 * 2 ** Math.min(failures - 1, 4)));
        retryAt = Date.now() + delay; notify('DriveBC ferries could not refresh. Open Layers for details.', 'drivebc-ferries');
      } finally {
        clearTimeout(timeout);
        if (requestVersion === version) { controller = null; render(); schedule(delay); }
      }
    }
    function setEnabled(value) {
      const next = value === true; if (next === enabled) return;
      enabled = next; cancel();
      if (enabled) { group.addTo(map); map.attributionControl.addAttribution(attribution); load(); }
      else { clear(); map.removeLayer(group); map.attributionControl.removeAttribution(attribution); }
    }
    map.on('moveend', () => { if (enabled && !document.hidden) { clearTimeout(debounce); debounce = setTimeout(load, 150); } });
    document.addEventListener('visibilitychange', () => { if (!enabled) return; if (document.hidden) cancel(); else load(); });
    window.addEventListener('pagehide', cancel);
    window.addEventListener('pageshow', event => { if (event.persisted && enabled) load(); });
    return { setEnabled };
  };
})();
