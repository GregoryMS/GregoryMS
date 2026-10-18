(() => {
  'use strict';
  window.GregleMapPlaces = ({ map, config, onPlace }) => {
    const data = window.GreglePlaceData;
    const box = document.getElementById('place-tags');
    const card = document.getElementById('map-place');
    const cache = new Map();
    let controller, version = 0, nextRequest = 0, retryAt = 0, overpassRetryAt = 0, current;
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
    function show(place, places) {
      box.replaceChildren(); box.hidden = false; card.scrollTop = 0;
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
    }
    async function select(point, options = {}) {
      clear();
      if (!point || !point.osm && !options.nearby) return;
      card.classList.add('has-place'); current = { point, options };
      if (!point.osm && map.getZoom() < 13) { message('Zoom in to click individual places and see their details.'); return; }
      const zoom = map.getZoom(), query = data.query(point, zoom), token = version;
      const cached = cache.get(query);
      if (cached && Date.now() - cached.time < 600000) { display(cached.places); return; }
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
      const timer = setTimeout(() => request.abort(), 18000);
      try {
        let places;
        if (Date.now() >= overpassRetryAt) {
          try {
            const signal = AbortSignal.any([request.signal, AbortSignal.timeout(6500)]);
            const response = await fetch(config.placesURL, { method: 'POST', body: new URLSearchParams({ data: query }), signal, credentials: 'omit' });
            if (token !== version) return;
            if (!response.ok) { overpassRetryAt = retryAfter(response, 300000); throw new Error('Place details unavailable'); }
            places = data.readPlaces(await response.json(), point);
          } catch {
            if (token !== version) return;
            if (request.signal.aborted) throw new Error('Place details timed out');
            overpassRetryAt = Math.max(overpassRetryAt, Date.now() + 300000);
          }
        }
        if (!places) {
          if (request.signal.aborted) throw new Error('Place details timed out');
          // Nominatim is a user-triggered, cached fallback, never an autocomplete or polling service.
          nextRequest = Date.now() + 1100;
          const response = await fetch(data.fallbackURL(config.placeLookupURL, point), { signal: request.signal, credentials: 'omit' });
          if (token !== version) return;
          if (!response.ok) { retryAt = retryAfter(response, 30000); throw new Error('Place lookup unavailable'); }
          places = data.readFallback(await response.json(), point, zoom);
        }
        if (token !== version) return;
        if (cache.size >= 40) cache.delete(cache.keys().next().value);
        cache.set(query, { places, time: Date.now() });
        // Nearby choices already carry all their tags; selecting one needs no second request.
        for (const place of places) cache.set(data.query(place, map.getZoom()), { places: [place], time: Date.now() });
        while (cache.size > 40) cache.delete(cache.keys().next().value);
        display(places);
      } catch {
        if (token !== version) return;
        retryAt = Math.max(retryAt, Date.now() + 30000);
        message('Place details are unavailable right now. Your pin is still saved on the map.', true);
      } finally {
        clearTimeout(timer);
        if (token === version) { controller = null; box.removeAttribute('aria-busy'); }
      }
      function display(places) {
        if (!places.length) { message('No mapped place found at this pin. Try clicking a place marker or its building.'); return; }
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
