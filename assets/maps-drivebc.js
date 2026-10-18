(() => {
  'use strict';
  window.GregleDriveBC = ({ map, notify }) => {
    const core = window.GregleMaps;
    const output = document.getElementById('drivebc-layer-status');
    const endpoint = 'https://api.open511.gov.bc.ca/events';
    const attribution = 'Road events: <a href="https://www.drivebc.ca/" target="_blank" rel="noopener">DriveBC</a> (<a href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc" target="_blank" rel="noopener">OGL-BC</a>)';
    const group = L.layerGroup(), cache = new Map();
    let enabled = false, controller, version = 0, debounce, refresh, lastRequest = 0;
    const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; };
    const time = value => new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    function boundsKey() {
      const bounds = map.getBounds();
      const south = Math.max(48, bounds.getSouth()), north = Math.min(60.1, bounds.getNorth());
      if (south >= north) return null;
      let west = -139.1, east = -114;
      if (bounds.getEast() - bounds.getWest() < 360) {
        const candidates = [-360, 0, 360].map(shift => [Math.max(-139.1, bounds.getWest() + shift), Math.min(-114, bounds.getEast() + shift)]).filter(([w,e]) => w < e);
        if (!candidates.length) return null;
        [west,east] = candidates.sort((a,b) => (b[1]-b[0])-(a[1]-a[0]))[0];
      }
      return [Math.floor(west*100)/100, Math.floor(south*100)/100, Math.ceil(east*100)/100, Math.ceil(north*100)/100].join(',');
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
    function render(data) {
      group.clearLayers();
      for (const event of data.events) {
        const kind = event.closed ? 'closed' : event.type === 'CONSTRUCTION' ? 'work' : event.type === 'WEATHER_CONDITION' || event.type === 'ROAD_CONDITION' ? 'condition' : 'incident';
        const color = ({ closed: '#ac3046', work: '#a56c13', condition: '#326da5', incident: '#c14c1d' })[kind];
        if (event.coordinates.length > 1) L.polyline(event.coordinates, { color, weight: 5, opacity: .85, bubblingMouseEvents: false }).bindPopup(() => popup(event), { maxWidth: 300 }).addTo(group);
        const symbol = ({ closed: '×', work: '↔', condition: '!', incident: '!' })[kind];
        const icon = L.divIcon({ className: `drivebc-marker drivebc-marker-${kind}`, html: `<span aria-hidden="true">${symbol}</span>`, iconSize: [26,26], iconAnchor: [13,13] });
        L.marker(event.point, { icon, title: `DriveBC: ${event.name}`, alt: 'DriveBC road event', keyboard: true }).bindPopup(() => popup(event), { maxWidth: 300 }).addTo(group);
      }
      const count = data.events.length;
      report(`${count}${data.partial ? '+' : ''} road ${count === 1 ? 'event' : 'events'} in this view · checked ${time(data.checked)}. Includes planned work.${data.partial ? ' Zoom in for more complete coverage.' : ''}`);
    }
    function cancel() {
      version++; controller?.abort(); controller = null;
      clearTimeout(debounce); debounce = null;
    }
    async function load() {
      if (!enabled || document.hidden) return;
      const key = boundsKey();
      cancel(); const requestVersion = version;
      if (!key) { group.clearLayers(); report('DriveBC covers British Columbia. Move the map to BC to see road events.'); return; }
      const cached = cache.get(key);
      if (cached && Date.now() - cached.checked < 120000) { render(cached); return; }
      lastRequest = Date.now();
      controller = new AbortController(); const active = controller;
      const timeout = setTimeout(() => active.abort(), 12000);
      group.clearLayers(); report('Checking DriveBC road events…');
      try {
        const all = []; let partial = false;
        for (let page = 0; page < 4; page++) {
          const url = new URL(endpoint);
          url.searchParams.set('status', 'ACTIVE'); url.searchParams.set('bbox', key); url.searchParams.set('limit', '500'); url.searchParams.set('offset', String(page*500));
          const response = await fetch(url, { signal: active.signal, credentials: 'omit' });
          if (!response.ok) throw new Error('DriveBC unavailable');
          const data = await response.json();
          if (!Array.isArray(data.events)) throw new Error('Invalid DriveBC response');
          all.push(...data.events);
          const next = data.pagination?.next_url;
          if (!next) break;
          if (page === 3) partial = true;
        }
        if (requestVersion !== version || !enabled || document.hidden) return;
        const data = { events: core.readRoadEvents({ events: all }), partial, checked: Date.now() };
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(key, data); render(data);
      } catch {
        if (requestVersion !== version || !enabled || document.hidden) return;
        group.clearLayers(); report('DriveBC could not be checked. Road events are unavailable; try moving the map or toggling this layer.', true);
        notify('DriveBC road events are unavailable. Check DriveBC for the latest road updates.', 'drivebc');
      } finally {
        clearTimeout(timeout);
        if (requestVersion === version) controller = null;
      }
    }
    function schedule() {
      if (!enabled || document.hidden) return;
      cancel();
      debounce = setTimeout(load, Math.max(400, 1000 - (Date.now()-lastRequest)));
    }
    function setEnabled(value) {
      const next = value === true;
      if (next === enabled) return;
      enabled = next; cancel(); clearInterval(refresh);
      if (enabled) {
        group.addTo(map); map.attributionControl.addAttribution(attribution);
        load(); refresh = setInterval(() => { if (!document.hidden) load(); }, 180000);
      } else {
        group.clearLayers(); map.removeLayer(group); map.attributionControl.removeAttribution(attribution);
      }
    }
    map.on('moveend', schedule);
    document.addEventListener('visibilitychange', () => {
      if (!enabled) return;
      if (document.hidden) cancel(); else load();
    });
    window.addEventListener('pagehide', () => { cancel(); clearInterval(refresh); });
    window.addEventListener('pageshow', event => { if (event.persisted && enabled) { load(); refresh = setInterval(() => { if (!document.hidden) load(); }, 180000); } });
    return { setEnabled };
  };
})();
