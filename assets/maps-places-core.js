((root, factory) => {
  const core = typeof module === 'object' && module.exports ? require('./maps-core.js') : root.GregleMaps;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GreglePlaceData = api;
})(typeof window === 'object' ? window : globalThis, core => {
  'use strict';
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 1000) : '';
  const categories = ['shop', 'amenity', 'tourism', 'leisure', 'office', 'craft', 'healthcare', 'historic', 'public_transport'];
  const clickRadius = (point, zoom) => Math.round(Math.max(18, Math.min(90, 20 * 156543.034 * Math.cos(point.lat * Math.PI / 180) / 2 ** zoom)));
  function query(point, zoom) {
    if (!core.validPoint(point.lat, point.lng)) throw new Error('Invalid place location');
    const ref = point.osm && core.osmReference(...point.osm.split('/'));
    if (ref) return `[out:json][timeout:12][maxsize:8388608];${ref.replace('/', '(')});out tags center;`;
    const radius = clickRadius(point, zoom);
    const filter = `[~"^(${categories.join('|')})$"~"."]`;
    const coords = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    // Include the building/park containing the click, even if its outline is farther away.
    return `[out:json][timeout:12][maxsize:8388608];is_in(${coords})->.here;(nwr(around:${radius},${coords})${filter};wr(pivot.here)${filter};);out body center geom 40;`;
  }
  function geometryDistance(element, point) {
    const project = p => [core.wrapLongitude(p.lon - point.lng) * 111320 * Math.cos(point.lat * Math.PI / 180), (p.lat - point.lat) * 111320];
    const rings = element.geometry ? [{ geometry: element.geometry }] : (element.members || []).filter(m => Array.isArray(m.geometry));
    let nearest = Infinity, inside = false, insideHole = false;
    for (const { geometry: ring, role } of rings) {
      if (!ring.length || ring.some(p => !p || !core.validPoint(p.lat, p.lon))) continue;
      const points = ring.map(project);
      const closed = points.length > 3 && ring[0].lat === ring.at(-1).lat && ring[0].lon === ring.at(-1).lon;
      let contains = false;
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i], dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
        if (closed && (ay > 0) !== (by > 0) && 0 < ax + (bx - ax) * -ay / (by - ay)) contains = !contains;
      }
      if (contains) { if (role === 'inner') insideHole = true; else inside = true; }
    }
    return inside && !insideHole ? 0 : nearest;
  }
  function readPlaces(data, point) {
    if (!Array.isArray(data?.elements) || data.remark) throw new Error('Place details unavailable');
    const seen = new Set(), places = [];
    for (const element of data.elements.slice(0, 80)) {
      const osm = core.osmReference(element?.type, element?.id);
      if (!osm || point.osm && osm !== point.osm || seen.has(osm) || !element.tags || typeof element.tags !== 'object' || Array.isArray(element.tags)) continue;
      const tags = Object.fromEntries(Object.entries(element.tags).filter(([key, value]) => clean(key) && clean(value)).slice(0, 256).map(([key, value]) => [clean(key), clean(value)]));
      if (!Object.keys(tags).length) continue;
      const lat = element.lat ?? element.center?.lat ?? point.lat, lng = element.lon ?? element.center?.lon ?? point.lng;
      if (!core.validPoint(lat, lng)) continue;
      const category = categories.map(key => tags[key]).find(Boolean) || tags.building || tags.place || '';
      const address = [[tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '), tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ');
      const categoryLabel = category.replaceAll('_', ' ');
      const name = tags.name || tags['name:en'] || tags.brand || categoryLabel || point.name || 'Map place';
      const metres = Math.hypot(core.wrapLongitude(lng - point.lng) * 111320 * Math.cos(point.lat * Math.PI / 180), (lat - point.lat) * 111320);
      const distance = Math.min(metres, geometryDistance(element, point));
      const snapshot = Number.isFinite(Date.parse(data.osm3s?.timestamp_osm_base)) ? data.osm3s.timestamp_osm_base : null;
      places.push({ osm, lat, lng, name, detail: [categoryLabel, address].filter(Boolean).join(' · '), tags, distance, centreDistance: metres, snapshot });
      seen.add(osm);
    }
    return places.sort((a, b) => a.distance - b.distance || a.centreDistance - b.centreDistance).slice(0, 12);
  }
  function fallbackURL(endpoint, point) {
    const ref = point.osm && core.osmReference(...point.osm.split('/'));
    const url = new URL(ref ? 'lookup' : 'reverse', endpoint.endsWith('/') ? endpoint : endpoint + '/');
    url.searchParams.set('format', 'jsonv2'); url.searchParams.set('extratags', '1');
    url.searchParams.set('namedetails', '1'); url.searchParams.set('addressdetails', '1');
    if (ref) {
      const [type, id] = ref.split('/'); url.searchParams.set('osm_ids', type[0].toUpperCase() + id);
    } else {
      url.searchParams.set('lat', point.lat.toFixed(5)); url.searchParams.set('lon', point.lng.toFixed(5));
      url.searchParams.set('zoom', '18'); url.searchParams.set('layer', 'poi'); url.searchParams.set('polygon_geojson', '1');
    }
    return url.href;
  }
  function readFallback(response, point, zoom = 16) {
    if (response?.error === 'Unable to geocode') return [];
    const items = Array.isArray(response) ? response : response?.osm_id ? [response] : null;
    if (!items) throw new Error('Invalid place lookup response');
    const elements = items.map(item => {
      const tags = { ...item.extratags, ...item.namedetails };
      if (item.name) tags.name = item.name;
      if (categories.includes(item.category) && item.type) tags[item.category] = item.type;
      const address = item.address || {};
      for (const [key, value] of [['housenumber', address.house_number], ['street', address.road], ['city', address.city || address.town || address.village], ['postcode', address.postcode]]) if (value) tags['addr:' + key] = value;
      const polygons = item.geojson?.type === 'Polygon' ? [item.geojson.coordinates] : item.geojson?.type === 'MultiPolygon' ? item.geojson.coordinates : [];
      const members = polygons.flatMap(polygon => polygon.map((ring, i) => ({ role: i ? 'inner' : 'outer', geometry: ring.map(([lon,lat]) => ({lon,lat})) })));
      return { type: item.osm_type, id: item.osm_id, center: { lat: Number(item.lat), lon: Number(item.lon) }, members, tags };
    });
    return readPlaces({ elements }, point).filter(place => point.osm || place.distance <= clickRadius(point, zoom)).map(place => ({ ...place, partial: true }));
  }
  function addressURL(endpoint, point) {
    if (!core.validPoint(point.lat, point.lng)) throw new Error('Invalid address location');
    const url = new URL('reverse', endpoint.endsWith('/') ? endpoint : endpoint + '/');
    url.searchParams.set('format', 'jsonv2'); url.searchParams.set('addressdetails', '1');
    url.searchParams.set('lat', point.lat.toFixed(5)); url.searchParams.set('lon', point.lng.toFixed(5));
    url.searchParams.set('zoom', '18'); url.searchParams.set('layer', 'address');
    return url.href;
  }
  function readAddress(response) {
    if (response?.error === 'Unable to geocode') return null;
    const osm = core.osmReference(response?.osm_type, response?.osm_id);
    const lat = Number(response?.lat), lng = Number(response?.lon);
    const coordinate = value => ['string', 'number'].includes(typeof value) && String(value).trim() !== '';
    if (!osm || !coordinate(response?.lat) || !coordinate(response?.lon) || !core.validPoint(lat, lng)) throw new Error('Invalid address response');
    const address = response.address || {};
    const street = [clean(address.house_number), clean(address.road || address.pedestrian || address.residential || address.footway || address.path || address.cycleway || address.square)].filter(Boolean).join(' ');
    const locality = clean(address.city || address.town || address.village || address.municipality || address.hamlet || address.suburb);
    const parts = [street, locality, clean(address.state), clean(address.postcode), clean(address.country)].filter(Boolean);
    const label = [...new Set(parts)].join(', ') || clean(response.display_name);
    if (!label) throw new Error('Address missing from response');
    return { label: clean(label), osm, lat, lng };
  }
  function safeLink(kind, value) {
    value = clean(value);
    if (kind === 'phone') {
      // A multi-number tag remains readable without turning into a malformed dial action.
      if (!/^[+\d][\d\s().-]{3,40}$/.test(value) || value.replace(/\D/g, '').length < 3) return null;
      return 'tel:' + value.replace(/[\s().-]/g, '');
    }
    if (kind === 'email') return /^[^\s@<>?&#]+@[^\s@<>?&#]+\.[^\s@<>?&#]+$/.test(value) ? 'mailto:' + value : null;
    if (kind !== 'website' || !value || /[\s\\]/.test(value)) return null;
    try {
      const url = new URL(/^[\w+.-]+:/.test(value) ? value : 'https://' + value);
      return ['https:', 'http:'].includes(url.protocol) && url.hostname.includes('.') && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function readHours(value) {
    const raw = clean(value);
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const codes = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    const special = () => ({ days: [], notes: [], raw, weekly: false });
    if (!raw || raw.includes('||')) return special();
    // Semicolons inside quoted instructions are part of that instruction.
    const rules = []; let start = 0, quoted = false;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '"') quoted = !quoted;
      if (raw[i] === ';' && !quoted) { rules.push(raw.slice(start, i).trim()); start = i + 1; }
    }
    if (quoted) return special();
    rules.push(raw.slice(start).trim());
    const days = names.map(day => ({ day, times: ['Closed'], closed: true })), notes = [];
    let weeklyRules = 0, hasOvernight = false;
    function clock(minutes, end = false) {
      if (minutes === 1440 && end) return '24:00';
      minutes %= 1440;
      const hour = Math.floor(minutes / 60), minute = minutes % 60;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    function timesFor(body) {
      const match = body.match(/^(.*?)(?:\s*"([^"\n]+)")?$/);
      if (!match) return null;
      body = match[1].trim(); const comment = match[2];
      let times, closed = false;
      if (['off', 'closed'].includes(body)) { times = ['Closed']; closed = true; }
      else if (['24/7', 'open'].includes(body)) times = ['Open 24 hours'];
      else if (!body && comment) times = [];
      else {
        times = [];
        for (const part of body.split(',')) {
          const range = part.trim().match(/^(\d{1,2}):([0-5]\d)\s*-\s*(\d{1,2}):([0-5]\d)$/);
          if (!range) return null;
          const from = Number(range[1]) * 60 + Number(range[2]), to = Number(range[3]) * 60 + Number(range[4]);
          if (from >= 1440 || to > 2880 || from === to) return null;
          const end = to < from ? to + 1440 : to;
          if (end - from > 1440) return null;
          if (end > 1440) hasOvernight = true;
          if (from === 0 && end === 1440) times.push('Open 24 hours');
          else times.push(`${clock(from)} – ${clock(to, true)}${end > 1440 ? ' (next day)' : ''}`);
        }
      }
      if (comment) times.push(comment);
      return { times, closed };
    }
    for (const rule of rules) {
      if (!rule) return special();
      const holiday = rule.match(/^(PH|SH)\s+(.+)$/);
      if (holiday) {
        const hours = timesFor(holiday[2]); if (!hours) return special();
        const label = holiday[1] === 'PH' ? 'Public holidays' : 'School holidays';
        const existing = notes.findIndex(note => note.label === label);
        const note = { label, times: hours.times };
        if (existing >= 0) notes[existing] = note; else notes.push(note);
        continue;
      }
      const match = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(.+)$/);
      const hours = timesFor(match ? match[2] : rule);
      if (!hours) return special();
      const selected = new Set();
      if (!match) codes.forEach((_, i) => selected.add(i));
      else for (const part of match[1].split(',')) {
        const [first, last = first] = part.trim().split(/\s*-\s*/);
        const from = codes.indexOf(first), to = codes.indexOf(last);
        for (let offset = 0; offset <= (to - from + 7) % 7; offset++) selected.add((from + offset) % 7);
      }
      for (const i of selected) days[i] = { day: names[i], times: [...hours.times], closed: hours.closed };
      weeklyRules++;
    }
    // Separate overnight rules can overwrite the previous day's spillover at midnight.
    // Preserve their original meaning rather than flattening those cases incorrectly.
    return weeklyRules && !(hasOvernight && weeklyRules > 1) ? { days, notes, raw, weekly: true } : special();
  }
  function facts(tags) {
    const rows = [];
    const add = (label, value, kind) => { if (value) rows.push({ label, value, href: kind ? safeLink(kind, value) : null }); };
    add('Phone', tags.phone || tags['contact:phone'], 'phone');
    if (tags.opening_hours) rows.push({ label: 'Hours', value: tags.opening_hours === '24/7' ? 'Open 24 hours' : tags.opening_hours, href: null, schedule: readHours(tags.opening_hours) });
    add('Hours note', tags['opening_hours:description']);
    add('Website', tags.website || tags['contact:website'] || tags.url, 'website');
    add('Email', tags.email || tags['contact:email'], 'email');
    add('Wheelchair access', ({ yes: 'Yes', no: 'No', limited: 'Limited', designated: 'Designated' })[tags.wheelchair] || tags.wheelchair);
    add('Cuisine', tags.cuisine?.replaceAll('_', ' ').replaceAll(';', ', '));
    add('Operator', tags.operator);
    return rows;
  }
  return { query, readPlaces, fallbackURL, readFallback, addressURL, readAddress, facts, safeLink, readHours };
});
