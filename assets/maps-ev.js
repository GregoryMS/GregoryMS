(() => {
  'use strict';
  window.GregleEVCharging = ({ map, config, notify }) => {
    const core = window.GregleEVCore, maps = window.GregleMaps, places = window.GreglePlaceData;
    const output = document.getElementById('ev-layer-status'), retry = document.getElementById('ev-retry');
    const group = L.layerGroup(), displayed = new Map(), providerStates = new Map();
    let cache = [], ocm=config.evSource ? config.evSource==='openchargemap' : config.evProvider==='openchargemap';
    const creditFor = value => value ? 'EV charging: <a href="https://openchargemap.org" target="_blank" rel="noopener">Open Charge Map</a> · provider licences in station details' : 'EV charging: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
    let endpoint=ocm?config.evURL:config.evOSMURL||config.evURL, credit=creditFor(ocm);
    let storageKey = 'gregle-maps-ev-cache-v1'+(!ocm&&config.evOSMURL?'-osm':'');
    const cacheAge = 86400000, fallbackAge = 604800000, requestGap = 10000;
    let enabled = false, showAll = false, showTesla = false, active, version = 0, timer, nextRequest = 0, retryAt = 0, failures = 0;
    const report = (message, error = false) => { output.textContent = message; output.dataset.state = error ? 'error' : 'ready'; };
    const make = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
    const link = (text, href) => { const el = make('a', text); el.href = href; if (href.startsWith('https:') || href.startsWith('http:')) { el.target = '_blank'; el.rel = 'noopener noreferrer'; } return el; };
    function providerCredit(provider){
      const box=make('div',null,'ev-provider-credit');
      box.append(provider.url?link(provider.name,provider.url):make('strong',provider.name));
      box.append(make('p',provider.license));
      if(provider.licenseURL)box.append(link('Licence terms ↗',provider.licenseURL));
      return box;
    }
    function renderCredits(records){
      const target=document.getElementById('ev-source-credits');if(!target||!ocm)return;
      const providers=new Map([...records.values()].filter(s=>s.provider).map(s=>[s.provider.name+'\n'+s.provider.license,s.provider]));
      target.replaceChildren(...[...providers.values()].map(providerCredit));
    }
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
      box.append(make('strong', station.name, 'ev-title'), make('p', `${station.supercharger ? 'Tesla Supercharger' : 'EV charging station'} · ${station.source==='openchargemap'?'Open Charge Map':'OpenStreetMap'}`, 'ev-meta'));
      if (station.address) box.append(make('p', station.address));
      const tags = station.tags, facts = make('dl', null, 'ev-facts');
      const add = (label, value) => { if (value) facts.append(make('dt', label), make('dd', value)); };
      add('Network', tags.network); add('Operator', tags.operator);
      add('Access', ({ yes: 'Public', permissive: 'Public', private: 'Private', no: 'No public access', customers: 'Customers only', permit: 'Permit required', destination: 'Destination users' })[tags.access] || tags.access || 'Not recorded');
      add('Fee', ({ yes: 'A fee applies', no: 'No charging fee recorded' })[tags.fee] || tags.fee);
      add('Charging cost',station.usageCost);add('Access notes',station.accessComments);add('Reported status',station.reportedStatus);
      if(station.verified&&Number.isFinite(Date.parse(station.verified)))add('Last verified',new Date(station.verified).toLocaleDateString());
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
      actions.append(link('Check this area on PlugShare ↗', maps.plugshareURL({ lat, lng }, [lng - .01, lat - .01, lng + .01, lat + .01])), station.source==='openchargemap'?link('Open Charge Map details / corrections ↗',`https://openchargemap.org/site/poi/details/${station.id.split('/')[1]}`):link('View OpenStreetMap details ↗', `https://www.openstreetmap.org/${station.id}`));
      if(station.provider)box.append(make('strong','Data attribution','ev-subheading'),providerCredit(station.provider));
      box.append(actions); return box;
    }
    function covered(entry, view, requestArea, scope) {
      return Date.now() - entry.time < cacheAge && core.contains(entry.area, view) &&
        (scope === 'tesla' || entry.scope === 'all') &&
        (!entry.truncated || (entry.scope === scope && entry.area.every((value, i) => value === requestArea[i])));
    }
    function icon(station, highlighted) {
      return L.divIcon({ className: `ev-charge-marker${highlighted ? ' ev-charge-supercharger' : station.restricted ? ' ev-charge-restricted' : ''}`, iconSize: [32, 32], iconAnchor: [16, 16], html: highlighted ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m13 2-8 11h6l-1 9L20 9h-7Z"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h3v5h4V3h3v5h2v4a7 7 0 0 1-6 6.93V22h-2v-3.07A7 7 0 0 1 5 12V8h2V3Z"/></svg>' });
    }
    function clear() { group.clearLayers(); displayed.clear(); }
    function render() {
      if (!enabled) return;
      const view = bounds(), requestArea = core.area(view, map.getZoom());
      retry.hidden = failures === 0;
      if (!requestArea) { clear(); report(`Zoom in to level 12 or closer to see ${showAll ? 'EV charging stations' : 'Tesla Superchargers'}.`); return; }
      const now = Date.now(), records = new Map();
      // Keep locations through short outages, but use only fresh, complete coverage to skip a request.
      for (const entry of cache) if (now - entry.time <= fallbackAge) for (const station of entry.stations) if (visible(station.point, view) && (showAll || station.supercharger)) records.set(station.id, station);
      renderCredits(records);
      const coverage = cache.findLast(entry => covered(entry, view, requestArea, showAll ? 'all' : 'tesla'));
      const retained = cache.findLast(entry => now-entry.time< fallbackAge && core.contains(entry.area,view) && (showAll?entry.scope==='all':true));
      for (const [id, entry] of displayed) if (!records.has(id)) { group.removeLayer(entry.marker); displayed.delete(id); }
      for (const station of records.values()) {
        const previous = displayed.get(station.id), highlighted = showTesla && station.supercharger;
        const title = `${highlighted ? 'Tesla Supercharger' : 'EV charging'}: ${station.name}`;
        if (previous) {
          if (previous.highlighted !== highlighted) { previous.marker.options.title = title; previous.marker.options.alt = title; previous.marker.setIcon(icon(station, highlighted)); previous.highlighted = highlighted; }
          if (JSON.stringify(previous.station) !== JSON.stringify(station)) { previous.marker.setLatLng(station.point); previous.marker.setPopupContent(() => popup(station, previous.marker)); previous.station = station; }
          continue;
        }
        const marker = L.marker(station.point, { icon: icon(station, highlighted), title, alt: title, keyboard: true, riseOnHover: true, bubblingMouseEvents: false });
        marker.bindPopup(() => popup(station, marker), { minWidth: 150, maxWidth: 340, maxHeight: Math.max(80, map.getSize().y - 220), autoPanPaddingTopLeft: [12, 90], autoPanPaddingBottomRight: [68, 35] }).addTo(group);
        displayed.set(station.id, { marker, station, highlighted });
      }
      const count = records.size, teslas = [...records.values()].filter(station => station.supercharger).length;
      const text = showAll ? `${count} mapped charging ${count === 1 ? 'station' : 'stations'} in this view.${showTesla ? ` ${teslas} Tesla ${teslas === 1 ? 'Supercharger' : 'Superchargers'} highlighted.` : ''}` : `${count} Tesla ${count === 1 ? 'Supercharger' : 'Superchargers'} in this view.`;
      if (active) report(`${text} ${count ? 'Updating charging stations…' : 'Loading charging stations…'}`);
      else if (failures) report(`${count ? text + ' Cached locations shown. ' : ''}Charging data is unavailable. Retry later or open PlugShare above.`, true);
      else if (coverage) report(`${text}${coverage.truncated ? ' Results are limited; zoom in for more stations.' : ''}${coverage.restored ? ' Recent saved locations.' : ''} No live availability.`);
      else if(retained) report(`${text} Saved locations last refreshed ${new Date(retained.time).toLocaleDateString()}. No live availability.`);
      else report(`${text} Loading this area…`);
    }
    function cancel() { version++; active?.controller.abort(); active = null; clearTimeout(timer); }
    async function load(force = false) {
      clearTimeout(timer);
      if (!enabled || document.hidden) return;
      const view = bounds(), requestArea = core.area(view, map.getZoom()), now = Date.now();
      render();
      if (!requestArea || active) return;
      const scope = ocm || showAll ? 'all' : 'tesla';
      if (!force && cache.some(entry => covered(entry, view, requestArea, scope))) return;
      if (now < retryAt) { report(`Please wait ${Math.ceil((retryAt - now) / 1000)} seconds before retrying charging stations. Cached locations may be shown.`, true); return; }
      if (now < nextRequest) { timer = setTimeout(() => load(force), nextRequest - now); return; }
      const token = version, request = { controller: new AbortController(), area: requestArea, scope }; active = request;
      const timeout = setTimeout(() => request.controller.abort(), 45000); nextRequest = now + requestGap;
      render();
      try {
        const relay=ocm||!!config.evOSMURL, url=relay?new URL(endpoint):null;
        if(url){url.searchParams.set('bbox',requestArea.join(','));url.searchParams.set('scope',scope);}
        const response = await fetch(url?.href||endpoint, { method: relay?'GET':'POST', ...(relay?{}:{body:new URLSearchParams({data: core.query(requestArea, scope === 'tesla')})}), signal: request.controller.signal, credentials: 'omit' });
        if (!response.ok) {
          const error = new Error('Charging stations unavailable'), value = response.headers.get('Retry-After');
          error.retryAfter = value === null ? 0 : /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0;
          throw error;
        }
        if (token !== version || !enabled || document.hidden) return;
        const data = await response.json();
        if(ocm&&data?.source!=='openchargemap'||!ocm&&data?.source==='openchargemap')throw new Error('Unexpected charging source');
        const result = core.read(data);
        if((ocm||relay)&&(!Number.isFinite(result.fetchedAt)||result.fetchedAt>Date.now()||Date.now()-result.fetchedAt>=fallbackAge))throw new Error('Charging data out of date');
        if (token !== version || !enabled || document.hidden) return;
        cache.push({...result, data, area: requestArea, scope: request.scope, time: result.fetchedAt||Date.now()}); while (cache.length > 12) cache.shift();
        save();
        failures = 0; retryAt = 0;
      } catch (error) {
        if (token !== version || !enabled || document.hidden) return;
        failures++; retryAt = Date.now() + Math.max(Number.isFinite(error.retryAfter) ? error.retryAfter : 0, Math.min(900000, 60000 * 2 ** Math.min(failures - 1, 4)));
        notify('EV charging data could not load. PlugShare above opens the area you are viewing.', 'ev');
      } finally {
        clearTimeout(timeout);
        if (token === version) { active = null; render(); if (!failures && ((!ocm&&!config.evOSMURL) || !core.contains(request.area,bounds()))) timer = setTimeout(load, 650); }
      }
    }
    function setSelection(all, tesla) {
      const nextAll = all === true, nextTesla = tesla === true;
      if (nextAll === showAll && nextTesla === showTesla) return;
      showAll = nextAll; showTesla = nextTesla;
      const next = showAll || showTesla;
      if (next === enabled) { if (enabled) load(); return; }
      enabled = next; cancel();
      if (enabled) { group.addTo(map); map.attributionControl.addAttribution(credit); load(); }
      else { clear(); map.removeLayer(group); map.attributionControl.removeAttribution(credit); }
    }
    function save() {
      try {
        const entries = cache.filter(entry => entry.data && Date.now() - entry.time < fallbackAge).slice(-4).map(entry => ({data: entry.data, area: entry.area, scope: entry.scope, time: entry.time}));
        const value = JSON.stringify({endpoint, entries});
        if (value.length <= 500000) localStorage.setItem(storageKey, value);
        else localStorage.removeItem(storageKey);
      } catch {}
    }
    function restoreCache() {
      try {
        const value = localStorage.getItem(storageKey);
        if (value && value.length <= 500000) {
          const saved = JSON.parse(value);
          if (saved.endpoint === endpoint && Array.isArray(saved.entries)) for (const entry of saved.entries.slice(-4)) {
            try { cache.push({...core.readCache(entry, Date.now()), restored: true}); } catch {}
          }
        }
      } catch {}
    }
    function setSource(value) {
      const next=value!=='openstreetmap';
      if(next===ocm)return;
      save();providerStates.set(endpoint,{cache,nextRequest,retryAt,failures});
      cancel();clear();
      if(enabled)map.attributionControl.removeAttribution(credit);
      ocm=next;endpoint=ocm?config.evURL:config.evOSMURL||config.evURL;credit=creditFor(ocm);
      storageKey='gregle-maps-ev-cache-v1'+(!ocm&&config.evOSMURL?'-osm':'');
      const previous=providerStates.get(endpoint);
      cache=previous?.cache||[];nextRequest=previous?.nextRequest||0;retryAt=previous?.retryAt||0;failures=previous?.failures||0;
      if(!previous)restoreCache();
      document.getElementById('ev-source-credits')?.replaceChildren?.();
      if(enabled){group.addTo(map);map.attributionControl.addAttribution(credit);load();}
    }
    restoreCache();
    retry.addEventListener('click', () => load(true));
    map.on('moveend', () => { if (enabled && !document.hidden) { render(); clearTimeout(timer); timer = setTimeout(load, 650); } });
    document.addEventListener('visibilitychange', () => { if (!enabled) return; if (document.hidden) cancel(); else load(); });
    window.addEventListener('pagehide', cancel);
    window.addEventListener('pageshow', event => { if (event.persisted && enabled) load(); });
    return { setSelection, setSource, setEnabled: value => setSelection(value, showTesla), setSuperchargers: value => setSelection(showAll, value) };
  };
})();
