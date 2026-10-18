(() => {
  'use strict';
  window.GregleDriveBC = ({ map, notify }) => {
    const core = window.GregleMaps;
    const output = document.getElementById('drivebc-layer-status');
    const endpoint = 'https://api.open511.gov.bc.ca/events';
    const attribution = 'Road events: <a href="https://www.drivebc.ca/" target="_blank" rel="noopener">DriveBC</a> (<a href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc" target="_blank" rel="noopener">OGL-BC</a>)';
    const group = L.layerGroup(), displayed = new Map();
    const refreshEvery = 180000, maxCacheAge = 900000, pageGap = 2000;
    let enabled = false, controller, version = 0, debounce, refresh, lastRequest = 0;
    let snapshot, pending, failure, retryAt = 0, failures = 0;
    const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; };
    const time = value => new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    function viewBounds() {
      const bounds = map.getBounds();
      const south = Math.max(48, bounds.getSouth()), north = Math.min(60.1, bounds.getNorth());
      if (south >= north) return null;
      let west = -139.1, east = -114;
      if (bounds.getEast() - bounds.getWest() < 360) {
        const candidates = [-360, 0, 360].map(shift => [Math.max(-139.1, bounds.getWest() + shift), Math.min(-114, bounds.getEast() + shift)]).filter(([w,e]) => w < e);
        if (!candidates.length) return null;
        [west,east] = candidates.sort((a,b) => (b[1]-b[0])-(a[1]-a[0]))[0];
      }
      return [west, south, east, north];
    }
    function popup(event) {
      const box = document.createElement('div'); box.className = 'drivebc-popup';
      const name = document.createElement('strong'); name.textContent = event.name;
      const type = document.createElement('p');
      type.className = 'drivebc-meta';
      const label = event.type.toLowerCase().replaceAll('_',' ');
      type.textContent = `${event.closed ? 'Closure report · ' : ''}${label} · ${event.severity.toLowerCase()}`;
      const description = document.createElement('p'); description.textContent = event.description || 'See DriveBC for the event details.';
      const updated = document.createElement('p'); updated.className = 'drivebc-meta';
      updated.textContent = event.updated ? 'Event updated ' + new Date(event.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Event update time not supplied';
      const link = document.createElement('a'); link.href = 'https://www.drivebc.ca/'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open DriveBC ↗';
      box.append(name, type, description, updated, link); return box;
    }
    function clearEvents() { group.clearLayers(); displayed.clear(); }
    function render() {
      const bounds = viewBounds();
      if (!bounds) { clearEvents(); report('DriveBC covers British Columbia. Move the map to BC to see road events.'); return; }
      const data = snapshot && Date.now() - snapshot.checked <= maxCacheAge ? snapshot : null;
      const events = data ? data.events.filter(event => event.bounds[0] <= bounds[2] && event.bounds[2] >= bounds[0] && event.bounds[1] <= bounds[3] && event.bounds[3] >= bounds[1]) : [];
      const visible = new Map(events.map(event => [event.id, event]));
      for (const [id, entry] of displayed) {
        if (visible.get(id) === entry.event) continue;
        entry.layers.forEach(layer => group.removeLayer(layer)); displayed.delete(id);
      }
      for (const event of events) {
        if (displayed.has(event.id)) continue;
        const layers = [];
        const kind = event.closed ? 'closed' : event.type === 'CONSTRUCTION' ? 'work' : event.type === 'WEATHER_CONDITION' || event.type === 'ROAD_CONDITION' ? 'condition' : 'incident';
        const color = ({ closed: '#ff315b', work: '#ffc400', condition: '#008cff', incident: '#ff7a00' })[kind];
        if (event.coordinates.length > 1) {
          layers.push(L.polyline(event.coordinates, { color: '#fff', weight: 11, opacity: 1, interactive: false, className: 'drivebc-road-casing' }).addTo(group));
          layers.push(L.polyline(event.coordinates, { color, weight: 7, opacity: 1, bubblingMouseEvents: false }).bindPopup(() => popup(event), { maxWidth: 300 }).addTo(group));
        }
        const symbol = ({ closed: '×', work: '↔', condition: '!', incident: '!' })[kind];
        const icon = L.divIcon({ className: `drivebc-marker drivebc-marker-${kind}`, html: `<span aria-hidden="true">${symbol}</span>`, iconSize: [30,30], iconAnchor: [15,15] });
        layers.push(L.marker(event.point, { icon, title: `DriveBC: ${event.name}`, alt: 'DriveBC road event', keyboard: true }).bindPopup(() => popup(event), { maxWidth: 300 }).addTo(group));
        displayed.set(event.id, { event, layers });
      }
      const count = events.length;
      const retry = failure ? `${failure.limited ? 'DriveBC is limiting requests' : 'DriveBC is temporarily unavailable'}; retrying after ${time(retryAt)}.` : '';
      if (!data) { report(retry || 'Checking DriveBC road events…', !!failure); return; }
      report(`${count}${data.partial ? '+' : ''} road ${count === 1 ? 'event' : 'events'} in this view · ${failure ? 'cached reports ' : ''}checked ${time(data.checked)}. Includes planned work.${data.partial ? ' Coverage is incomplete.' : ''}${retry ? ' ' + retry : controller ? ' Checking for updates…' : ''}`, !!failure);
    }
    function cacheReports(raw, partial) {
      const events = core.readRoadEvents({ events: raw });
      for (const event of events) {
        const latitudes = event.coordinates.map(point => point[0]), longitudes = event.coordinates.map(point => point[1]);
        event.bounds = [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
      }
      snapshot = { events, partial, checked: Date.now() };
    }
    function cancel() {
      version++; controller?.abort(); controller = null;
      clearTimeout(debounce); debounce = null;
      clearTimeout(refresh); refresh = null;
    }
    function schedule(delay) {
      clearTimeout(refresh); refresh = null;
      const remaining = snapshot ? snapshot.checked + maxCacheAge - Date.now() + 1 : 0;
      if (remaining > 0) delay = Math.min(delay, remaining);
      if (enabled && !document.hidden && viewBounds()) refresh = setTimeout(load, Math.min(2147483647, Math.max(0, delay)));
    }
    async function load() {
      if (!enabled || document.hidden) return;
      clearTimeout(refresh); refresh = null;
      if (!viewBounds()) { cancel(); render(); return; }
      render();
      // Panning filters the same province-wide snapshot; it never cancels or repeats this request.
      if (controller) return;
      if (Date.now() < retryAt) { schedule(retryAt - Date.now()); return; }
      if (pending && Date.now() - pending.started > maxCacheAge) pending = null;
      if (!pending && snapshot && Date.now() - snapshot.checked < refreshEvery) { schedule(refreshEvery - (Date.now() - snapshot.checked)); return; }
      if (Date.now() - lastRequest < pageGap) { schedule(pageGap - (Date.now() - lastRequest)); return; }
      if (!pending) pending = { events: [], offset: 0, started: Date.now() };
      const batch = pending, requestVersion = version;
      lastRequest = Date.now();
      controller = new AbortController(); const active = controller;
      const timeout = setTimeout(() => active.abort(), 12000);
      failure = null; render();
      let delay = refreshEvery;
      try {
        const url = new URL(endpoint);
        url.searchParams.set('status', 'ACTIVE'); url.searchParams.set('limit', '500'); url.searchParams.set('offset', String(batch.offset));
        const response = await fetch(url, { signal: active.signal, credentials: 'omit' });
        if (!response.ok) {
          const error = new Error('DriveBC unavailable'); error.status = response.status;
          const retry = response.headers.get('Retry-After');
          error.retryAfter = retry === null ? 0 : /^\d+(\.\d+)?$/.test(retry.trim()) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
          if (!Number.isFinite(error.retryAfter)) error.retryAfter = 0;
          throw error;
        }
        const data = await response.json();
        if (!Array.isArray(data.events)) throw new Error('Invalid DriveBC response');
        if (requestVersion !== version || !enabled || document.hidden) return;
        batch.events.push(...data.events); batch.offset += 500;
        const more = !!data.pagination?.next_url, capped = batch.offset >= 2000;
        if (!more || capped) { cacheReports(batch.events, more); pending = null; }
        else {
          // Keep complete cached coverage until replacement pages finish; expose partial data on first load.
          if (!snapshot || snapshot.partial || Date.now() - snapshot.checked > maxCacheAge) cacheReports(batch.events, true);
          delay = pageGap;
        }
        failures = 0; retryAt = 0; failure = null;
      } catch (error) {
        if (requestVersion !== version || !enabled || document.hidden) return;
        failures++;
        failure = { limited: error.status === 429 };
        delay = Math.max(error.retryAfter || 0, Math.min(900000, (failure.limited ? 120000 : 60000) * 2 ** Math.min(failures - 1, 4)));
        retryAt = Date.now() + delay;
        notify(failure.limited ? 'DriveBC is limiting refreshes. Another check will run automatically.' : 'DriveBC could not refresh. Another check will run automatically.', 'drivebc');
      } finally {
        clearTimeout(timeout);
        if (requestVersion === version) { controller = null; render(); schedule(delay); }
      }
    }
    function moved() {
      if (!enabled || document.hidden) return;
      clearTimeout(debounce);
      debounce = setTimeout(load, 150);
    }
    function setEnabled(value) {
      const next = value === true;
      if (next === enabled) return;
      enabled = next; cancel();
      if (enabled) {
        group.addTo(map); map.attributionControl.addAttribution(attribution);
        load();
      } else {
        clearEvents(); map.removeLayer(group); map.attributionControl.removeAttribution(attribution);
      }
    }
    map.on('moveend', moved);
    document.addEventListener('visibilitychange', () => {
      if (!enabled) return;
      if (document.hidden) cancel(); else load();
    });
    window.addEventListener('pagehide', cancel);
    window.addEventListener('pageshow', event => { if (event.persisted && enabled) load(); });
    return { setEnabled };
  };
})();
