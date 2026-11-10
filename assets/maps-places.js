(() => {
  'use strict';
  window.GregleMapPlaces = ({ map, config, onPlace }) => {
    const data = window.GreglePlaceData;
    const box = document.getElementById('place-tags');
    const card = document.getElementById('map-place');
    const cache = new Map();
    let controller, version = 0, nextRequest = 0, retryAt = 0, overpassRetryAt = 0, current;
    const cacheKey = 'gregle-maps-place-cache-v1', healthKey = 'gregle-maps-place-health-v1';
    const maxAge = 600000;
    try {
      const saved = JSON.parse(sessionStorage.getItem(cacheKey));
      if (saved?.endpoint === config.placesURL && saved.lookup === config.placeLookupURL && Array.isArray(saved.entries)) {
        for (const [key, entry] of saved.entries.slice(-40)) {
          if (typeof key === 'string' && key.length < 4096 && entry && Number.isFinite(entry.time) && entry.time <= Date.now() && Date.now() - entry.time < maxAge && Array.isArray(entry.places) && entry.places.length <= 12) cache.set(key, entry);
        }
      }
      const health = JSON.parse(sessionStorage.getItem(healthKey));
      if (health?.endpoint === config.placesURL && Number.isFinite(health.until)) overpassRetryAt = Math.min(health.until, Date.now() + 86400000);
    } catch {}
    function remember(key, places, address) {
      cache.delete(key); cache.set(key, { places, address, time: Date.now() });
      while (cache.size > 40) cache.delete(cache.keys().next().value);
    }
    function saveCache() {
      try {
        const entries = [...cache].filter(([, entry]) => Date.now() - entry.time < maxAge);
        const serialize = () => JSON.stringify({ endpoint: config.placesURL, lookup: config.placeLookupURL, entries });
        let saved = serialize();
        while (saved.length > 200000 && entries.length) { entries.shift(); saved = serialize(); }
        sessionStorage.setItem(cacheKey, saved);
      } catch {}
    }
    function cachedPlaces(entry, point) {
      // Stored data goes through the same identity, coordinate and tag validation as network data.
      const originals = new Map(entry.places.map(place => [place?.osm, place]));
      const elements = entry.places.map(place => {
        const [type, id] = String(place?.osm || '').split('/');
        return { type, id: Number(id), lat: place?.lat, lon: place?.lng, tags: place?.tags };
      });
      return data.readPlaces({ elements }, point).map(place => {
        const old = originals.get(place.osm);
        return { ...place, distance: Number.isFinite(old.distance) && old.distance >= 0 ? old.distance : place.distance,
          partial: old.partial === true, snapshot: Number.isFinite(Date.parse(old.snapshot)) ? old.snapshot : null };
      }).sort((a, b) => a.distance - b.distance || a.centreDistance - b.centreDistance);
    }
    function cachedAddress(address) {
      if (address === null) return null;
      const [type, id] = String(address?.osm || '').split('/');
      return data.readAddress({ osm_type: type, osm_id: Number(id), lat: address?.lat, lon: address?.lng, display_name: address?.label });
    }
    const make = (tag, text, className) => {
      const el = document.createElement(tag);
      if (text) el.textContent = text;
      if (className) el.className = className;
      return el;
    };
    const link = (text, href) => {
      const el = make('a', text); el.href = href;
      if (href.startsWith('http')) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      return el;
    };
    function clear() {
      version++; controller?.abort(); controller = null; current = null;
      box.replaceChildren(); box.hidden = true; box.removeAttribute('aria-busy');
      card.classList.remove('has-place'); card.scrollTop = 0;
    }
    function message(text, retry = false) {
      box.replaceChildren(); box.hidden = false;
      const status = make('p', text, 'place-tags-status'); status.setAttribute('role', 'status'); box.append(status);
      if (retry) {
        const button = make('button', 'Try place details again', 'place-retry'); button.type = 'button';
        button.addEventListener('click', () => current && select(current.point, current.options)); box.append(button);
      }
    }
    function showAddress(address) {
      if (!address) { message('No mapped place or nearby address found at this pin.'); return; }
      box.replaceChildren(); box.hidden = false;
      // The address belongs to a nearby mapped feature. Keep the selected pin and its shared coordinates unchanged.
      const list = make('dl', null, 'place-facts');
      list.append(make('dt', 'Closest mapped address'), make('dd', address.label));
      box.append(list);
      const source = make('div', null, 'place-data-source');
      source.append(link('View address on OpenStreetMap ↗', 'https://www.openstreetmap.org/' + address.osm));
      source.append(make('p', 'Address lookup: Nominatim · OpenStreetMap', 'place-tags-status'));
      box.append(source);
    }
    function alternatives(places, active, chooseOnly = false) {
      if (places.length < 2 && !chooseOnly) return;
      const details = make('details', null, 'place-choices');
      details.open = chooseOnly;
      details.append(make('summary', chooseOnly ? 'Choose a place here' : 'Other places here'));
      const list = make('div', null, 'place-choice-list');
      for (const place of places) {
        const button = make('button'); button.type = 'button';
        button.append(make('strong', place.name), make('span', place.detail || 'OpenStreetMap place'));
        if (place.osm === active?.osm) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => show(place, places)); list.append(button);
      }
      details.append(list); box.append(details);
    }
    function showHours(schedule, target) {
      target.className = 'place-hours';
      if (!schedule.weekly) {
        target.append(make('p', 'Special schedule — see the recorded hours:', 'place-hours-note'), make('div', schedule.raw, 'place-hours-recorded'));
        return;
      }
      const table = make('table'); table.setAttribute('aria-label', 'Weekly opening hours');
      const body = make('tbody');
      for (const day of schedule.days) {
        const row = make('tr'), label = make('th', day.day), times = make('td');
        label.scope = 'row';
        if (day.closed) row.className = 'place-hours-closed';
        for (const time of day.times) times.append(make('div', time));
        row.append(label, times); body.append(row);
      }
      table.append(body); target.append(table);
      if (schedule.notes.length) {
        const exceptions = make('div', null, 'place-hours-exceptions');
        for (const note of schedule.notes) {
          const line = make('div'); line.append(make('strong', note.label), make('span', note.times.join('\n'))); exceptions.append(line);
        }
        target.append(exceptions);
      }
    }
    function show(place, places, preserve = false) {
      const scrollTop = card.scrollTop;
      const tagsOpen = preserve && box.querySelector('.place-all-tags')?.open;
      const choicesOpen = preserve && box.querySelector('.place-choices')?.open;
      if (current) current.place = place;
      box.replaceChildren(); box.hidden = false; if (!preserve) card.scrollTop = 0;
      onPlace(place);
      const list = make('dl', null, 'place-facts');
      for (const fact of data.facts(place.tags)) {
        const value = make('dd');
        if (fact.schedule) showHours(fact.schedule, value);
        else if (fact.href) value.append(link(fact.value, fact.href)); else value.textContent = fact.value;
        list.append(make('dt', fact.label), value);
      }
      box.append(list);
      if (!place.tags.phone && !place.tags['contact:phone'] || !place.tags.opening_hours) {
        const missing = [!place.tags.phone && !place.tags['contact:phone'] ? 'phone number' : '', !place.tags.opening_hours ? 'opening hours' : ''].filter(Boolean);
        box.append(make('p', `No ${missing.join(' or ')} recorded in OpenStreetMap.`, 'place-tags-status'));
      }
      const tags = make('details', null, 'place-all-tags');
      tags.open = !!tagsOpen;
      const entries = Object.entries(place.tags).sort(([a], [b]) => a.localeCompare(b));
      tags.append(make('summary', `${place.partial ? 'Available' : 'All'} OpenStreetMap tags (${entries.length})`));
      const values = make('dl', null, 'place-raw-tags');
      for (const [key, value] of entries) values.append(make('dt', key), make('dd', value));
      tags.append(values); box.append(tags);
      const source = make('div', null, 'place-data-source');
      source.append(link('View on OpenStreetMap ↗', 'https://www.openstreetmap.org/' + place.osm));
      if (place.partial) source.append(make('p', 'Place lookup: Nominatim · available tags', 'place-tags-status'));
      if (place.snapshot) source.append(make('p', 'OSM snapshot: ' + new Date(place.snapshot).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), 'place-tags-status'));
      box.append(source);
      alternatives(places, place);
      if (choicesOpen) { const choices = box.querySelector('.place-choices'); if (choices) choices.open = true; }
      if (preserve) card.scrollTop = scrollTop;
    }
    async function select(point, options = {}) {
      clear();
      if (!point || !point.osm && !options.nearby) return;
      card.classList.add('has-place'); current = { point, options };
      if (!point.osm && map.getZoom() < 13) { message('Zoom in to select individual places and see their details.'); return; }
      const zoom = map.getZoom(), query = data.query(point, zoom), token = version;
      const cached = cache.get(query);
      if (cached && Date.now() - cached.time < maxAge) {
        try {
          const places = cachedPlaces(cached, point);
          if (places.length) { display(places); return; }
          if (!cached.places.length && cached.address !== undefined) { showAddress(cachedAddress(cached.address)); return; }
        } catch {}
        cache.delete(query);
      }
      const wait = retryAt - Date.now();
      if (wait > 0) { message(`Please wait ${Math.ceil(wait / 1000)} seconds, then try place details again.`, true); return; }
      if (nextRequest > Date.now()) {
        message('Loading OpenStreetMap place details…');
        await new Promise(resolve => setTimeout(resolve, nextRequest - Date.now()));
        if (token !== version) return;
      }
      nextRequest = Date.now() + 1000;
      message('Loading OpenStreetMap place details…'); box.setAttribute('aria-busy', 'true');
      controller = new AbortController(); const request = controller;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; request.abort(); }, 18000);
      const fallback = new AbortController();
      let fullPlaces = null, quickPlaces = null, hedgeTimer, addressTask;
      const publish = (places, preserve = false) => {
        if (token !== version || request.signal.aborted) return;
        remember(query, places);
        for (const place of places) remember(data.query(place, zoom), [place]);
        saveCache();
        display(places, preserve); box.removeAttribute('aria-busy');
      };
      const detailed = async () => {
        if (Date.now() < overpassRetryAt) return null;
        try {
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(6500)]);
          const response = await fetch(config.placesURL, { method: 'POST', body: new URLSearchParams({ data: query }), signal, credentials: 'omit' });
          if (token !== version || request.signal.aborted) return null;
          if (!response.ok) { overpassRetryAt = retryAfter(response, 300000); throw new Error('Place details unavailable'); }
          fullPlaces = data.readPlaces(await response.json(), point);
          if (token !== version || request.signal.aborted) return null;
          if (fullPlaces.length) {
            // Enrich the shop already being read; never switch it after a late response.
            const active = current?.place;
            if (active && !fullPlaces.some(place => place.osm === active.osm)) fullPlaces = [active, ...fullPlaces].slice(0, 12);
            publish(fullPlaces, true); fallback.abort();
          }
          return fullPlaces;
        } catch {
          if (token !== version || request.signal.aborted) return null;
          overpassRetryAt = Math.max(overpassRetryAt, Date.now() + 300000);
          try { sessionStorage.setItem(healthKey, JSON.stringify({ endpoint: config.placesURL, until: overpassRetryAt })); } catch {}
          return null;
        }
      };
      const closestAddress = async () => {
        try {
          if (retryAt > Date.now()) throw new Error('Address lookup cooling down');
          message('No mapped place found. Looking up the closest address…');
          if (nextRequest > Date.now()) await new Promise(resolve => setTimeout(resolve, nextRequest - Date.now()));
          if (token !== version || request.signal.aborted || fullPlaces?.length || quickPlaces?.length) return;
          nextRequest = Date.now() + 1100;
          const response = await fetch(data.addressURL(config.placeLookupURL, point), { signal: AbortSignal.any([request.signal, fallback.signal]), credentials: 'omit' });
          if (token !== version || request.signal.aborted || fullPlaces?.length || quickPlaces?.length) return;
          if (!response.ok) { retryAt = retryAfter(response, 30000); throw new Error('Address lookup unavailable'); }
          const address = data.readAddress(await response.json());
          if (token !== version || request.signal.aborted || fullPlaces?.length || quickPlaces?.length) return;
          remember(query, [], address); saveCache(); showAddress(address); box.removeAttribute('aria-busy');
        } catch {
          if (token !== version || request.signal.aborted && !timedOut || fullPlaces?.length || quickPlaces?.length) return;
          retryAt = Math.max(retryAt, Date.now() + 30000);
          message('No mapped place found at this pin. The closest address is unavailable right now. Try again shortly.', true);
        }
      };
      try {
        const full = detailed();
        // Give a healthy detailed lookup a head start, without making the user wait for its timeout.
        await Promise.race([full, new Promise(resolve => { hedgeTimer = setTimeout(resolve, 800); })]);
        clearTimeout(hedgeTimer);
        if (token !== version || request.signal.aborted) return;
        if (!fullPlaces?.length) {
          // One user-triggered, rate-limited fallback; no polling or speculative area requests.
          nextRequest = Date.now() + 1100;
          try {
            const response = await fetch(data.fallbackURL(config.placeLookupURL, point), { signal: AbortSignal.any([request.signal, fallback.signal]), credentials: 'omit' });
            if (token !== version || request.signal.aborted) return;
            if (!response.ok) { retryAt = retryAfter(response, 30000); throw new Error('Place lookup unavailable'); }
            quickPlaces = data.readFallback(await response.json(), point, zoom);
            if (!fullPlaces?.length && quickPlaces.length) publish(quickPlaces);
          } catch { /* A detailed result can still complete when the quick service fails. */ }
        }
        // An empty quick lookup can show the address while the detailed service finishes.
        if (!fullPlaces?.length && !quickPlaces?.length && (fullPlaces || quickPlaces)) addressTask = closestAddress();
        await full;
        if (token !== version || request.signal.aborted) return;
        if (!fullPlaces?.length && !quickPlaces?.length) {
          if (fullPlaces || quickPlaces) addressTask ||= closestAddress();
          else throw new Error('Place details unavailable');
        }
        await addressTask;
      } catch {
        if (token !== version) return;
        retryAt = Math.max(retryAt, Date.now() + 30000);
        message('Place details are unavailable right now. Your pin is still saved on the map.', true);
      } finally {
        clearTimeout(timer);
        clearTimeout(hedgeTimer);
        if (token === version) { controller = null; box.removeAttribute('aria-busy'); }
      }
      function display(places, preserve = false) {
        if (!places.length) { showAddress(null); return; }
        if (preserve && current?.place) { show(places.find(place => place.osm === current.place.osm) || current.place, places, true); return; }
        // An exact search result or a clear hit opens immediately. Ambiguous clicks offer a choice.
        if (point.osm || places[0].distance <= 12 || places.length === 1) show(places[0], places);
        else { message('Several places are nearby. Choose the one you want to see.'); alternatives(places, null, true); }
      }
    }
    function retryAfter(response, minimum) {
      const header = response.headers.get('Retry-After');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? (Date.parse(header) - Date.now()) / 1000 : 0;
      return Date.now() + Math.max(minimum, Number.isFinite(seconds) ? seconds * 1000 : 0);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden && controller) { controller.abort(); } });
    window.addEventListener('pagehide', clear);
    return { select, clear };
  };
})();
