((root, factory) => {
  const api = factory(typeof module === 'object' && module.exports ? require('./maps-navigation-core.js') : root.GregleNavigation);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleMapRouting = api;
})(typeof window === 'object' ? window : globalThis, core => {
  'use strict';
  const endpoint = 'https://api.tomtom.com/maps/orbis/routing/routes/calculate?apiVersion=3';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const mapboxEndpoint = 'https://gregle-mapbox.square-rain-5ded.workers.dev';
  function readMapboxRoute(data, traffic = false) {
    const route = core.readRoute(data), raw = data.routes[0];
    const steps = (raw.legs || []).flatMap(leg => leg.steps || []).filter(s => s && number(s.distance));
    if (!steps.length) throw new Error('Mapbox returned no usable guidance.');
    route.steps.forEach((step, i) => {
      const text = steps[i]?.maneuver?.instruction;
      if (typeof text === 'string' && text.trim()) step.text = text.slice(0, 1000);
    });
    const indications = new Set(['left', 'slight left', 'sharp left', 'straight', 'right', 'slight right', 'sharp right', 'uturn']);
    route.laneGuidance = [];
    // Two endpoints produce one leg; geometry_index addresses the full geometry.
    for (const step of steps) for (const junction of step.intersections || []) {
      const index = junction.geometry_index;
      if (!Number.isInteger(index) || index < 0 || index >= route.points.length || !Array.isArray(junction.lanes) || junction.lanes.length > 12) continue;
      const lanes = junction.lanes.map(lane => ({
        indications: Array.isArray(lane.indications) ? lane.indications.filter(x => indications.has(x)) : [],
        valid: lane.valid === true, active: lane.active === true, preferred: indications.has(lane.valid_indication) ? lane.valid_indication : null
      }));
      if (!lanes.length || lanes.some(lane => !lane.indications.length) || !lanes.some(lane => lane.valid)) continue;
      route.laneGuidance.push({at: route.cumulative[index], lanes});
    }
    route.laneGuidance.sort((a, b) => a.at - b.at);
    const annotation = raw.legs?.[0]?.annotation;
    if (Array.isArray(annotation?.maxspeed) && annotation.maxspeed.length === route.points.length - 1) {
      route.speedLimits = annotation.maxspeed.map(limit => number(limit?.speed) && limit.speed > 0 && ['km/h', 'mph'].includes(limit.unit) ? {speed: limit.speed, unit: limit.unit} : null);
    }
    if (Array.isArray(annotation?.duration) && annotation.duration.length === route.points.length - 1 && annotation.duration.every(number)) {
      const times = [0]; for (const seconds of annotation.duration) times.push(times.at(-1) + seconds);
      if (times.at(-1) > 0) route.timings = times.map(time => time / times.at(-1) * route.duration);
    }
    return {...route, provider: 'mapbox', traffic, fetchedAt: Date.now()};
  }
  function trafficRequest(from, to, key) {
    core.routeURL(from, to);
    return { url: endpoint, options: {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'TomTom-Api-Key': key, Attributes: 'routes', 'Accept-Language': 'en-GB' },
      body: JSON.stringify({ routePlanningLocations: {
        origin: { type: 'Point', coordinates: [from.lng, from.lat] },
        destination: { type: 'Point', coordinates: [to.lng, to.lat] }
      }, traffic: 'live', departureDateTime: 'now', travelMode: 'car', routeType: 'fast', guidance: 'instructions', instructionPhonetics: 'ipa' })
    } };
  }
  function readTrafficRoute(data) {
    const r = data?.routes?.[0], summary = r?.summary;
    // This planner requests exactly two endpoints, hence one leg.
    const path = r?.legs?.length === 1 && r.legs[0]?.path;
    if (!path || !number(summary?.lengthInMeters) || !number(summary?.travelDurationInSeconds)) throw new Error('Invalid traffic route.');
    const route = core.readRoute({ code: 'Ok', routes: [{ geometry: path, distance: summary.lengthInMeters, duration: summary.travelDurationInSeconds, legs: [] }] });
    if (!Array.isArray(r.instructions) || !r.instructions.length || r.instructions.length > 3000) throw new Error('Traffic route has no usable guidance.');
    let previousOffset = -1;
    route.steps = r.instructions.map((step, index, instructions) => {
      const offset = step?.routeOffsetInMeters;
      if (!number(offset) || offset < previousOffset || offset > route.distance + 10 || typeof step.message !== 'string' || !step.message.trim() || step.message.length > 1000) throw new Error('Invalid traffic guidance.');
      previousOffset = offset;
      const maneuver = typeof step.maneuver === 'string' ? step.maneuver : '';
      return { text: step.message.trim(), start: route.distance ? route.length * Math.min(offset, route.distance) / route.distance : 0,
        distance: Math.max(0, (instructions[index + 1]?.routeOffsetInMeters ?? route.distance) - offset),
        type: /^arrive/.test(maneuver) ? 'arrive' : maneuver === 'depart' ? 'depart' : 'turn',
        modifier: /UTurn/.test(maneuver) ? 'uturn' : /Left/.test(maneuver) ? 'left' : /Right/.test(maneuver) ? 'right' : '' };
    });
    if (route.steps.at(-1).type !== 'arrive') route.steps.push({ text: 'Arrive at your destination', start: route.length, distance: 0, type: 'arrive', modifier: '' });
    // Preserve the provider's non-uniform travel times through congested sections.
    const progress = r.progressPoints;
    if (Array.isArray(progress) && progress.length >= 2 && progress.length <= route.points.length && progress.every((p, i) =>
      Number.isInteger(p?.pathIndex) && p.pathIndex >= 0 && p.pathIndex < route.points.length && number(p.travelDurationInSeconds) && p.travelDurationInSeconds <= route.duration &&
      (!i || p.pathIndex > progress[i - 1].pathIndex && p.travelDurationInSeconds >= progress[i - 1].travelDurationInSeconds)) &&
      progress[0].pathIndex === 0 && progress[0].travelDurationInSeconds === 0 && progress.at(-1).pathIndex === route.points.length - 1 && progress.at(-1).travelDurationInSeconds === route.duration) {
      let segment = 1;
      route.timings = route.points.map((_, index) => {
        while (segment < progress.length - 1 && index > progress[segment].pathIndex) segment++;
        const a = progress[segment - 1], b = progress[segment];
        const span = route.cumulative[b.pathIndex] - route.cumulative[a.pathIndex];
        const ratio = span ? (route.cumulative[index] - route.cumulative[a.pathIndex]) / span : 0;
        return a.travelDurationInSeconds + ratio * (b.travelDurationInSeconds - a.travelDurationInSeconds);
      });
    }
    return { ...route, traffic: true, provider: 'tomtom', trafficDelay: number(summary.trafficDelayDurationInSeconds) ? summary.trafficDelayDurationInSeconds : 0, fetchedAt: Date.now() };
  }
  // Compose ordinary provider legs so stops work with OSRM, TomTom and 3D Mapbox.
  function combineRoutes(legs, stops) {
    const points = [], cumulative = [], timings = [], steps = [], laneGuidance = [], speedLimits = [], markers = [];
    let length = 0, elapsed = 0;
    legs.forEach((leg, legIndex) => {
      const previous = points.at(-1), first = leg.points[0];
      const gap = previous ? core.meters({lat: previous[0], lng: previous[1]}, {lat: first[0], lng: first[1]}) : 0;
      const offset = length + gap;
      leg.points.forEach((point, index) => {
        if (points.length && index === 0 && !gap) return;
        if (points.length) speedLimits.push(index ? leg.speedLimits?.[index - 1] || null : null);
        points.push(point); cumulative.push(offset + leg.cumulative[index]);
        timings.push(elapsed + (leg.timings?.[index] ?? (leg.length ? leg.duration * leg.cumulative[index] / leg.length : 0)));
      });
      for (const step of leg.steps) steps.push({...step, start: offset + step.start,
        ...(legIndex < legs.length - 1 && step.type === 'arrive' ? {type: 'stop', text: `Arrive at stop: ${stops[legIndex].name || 'Stop'}`} : {})});
      for (const lane of leg.laneGuidance || []) laneGuidance.push({...lane, at: offset + lane.at});
      length = offset + leg.length; elapsed += leg.duration;
      if (legIndex < stops.length) markers.push({...stops[legIndex], at: length});
    });
    const providers = [...new Set(legs.map(leg => leg.provider))], traffic = legs.every(leg => leg.traffic);
    return {points, cumulative, timings, steps, laneGuidance, speedLimits, length, duration: elapsed,
      distance: legs.reduce((sum, leg) => sum + leg.distance, 0), stops: markers, providers,
      provider: providers.length === 1 ? providers[0] : 'mixed', traffic,
      trafficPartial: !traffic && legs.some(leg => leg.traffic), trafficReason: legs.find(leg => !leg.traffic)?.trafficReason,
      trafficDelay: legs.reduce((sum, leg) => sum + (leg.trafficDelay || 0), 0), fetchedAt: Math.min(...legs.map(leg => leg.fetchedAt))};
  }
  function create({ fetch: send = globalThis.fetch, storage, defaultAvailable = false } = {}) {
    try { storage ??= globalThis.localStorage; } catch {}
    let enabled = false, blockedKey = '', mapbox = false;
    try { enabled = storage?.getItem('gregle-maps-route-traffic') === 'on'; } catch {}
    function key() {
      try { const value = storage?.getItem('gregle-maps-tomtom-key'); return typeof value === 'string' ? value.trim() : ''; } catch { return ''; }
    }
    async function request(from, to, mode = 'driving', { signal, via = [] } = {}) {
      if (!Array.isArray(via) || via.length > 1 || !via.every(core.valid)) throw new Error('Choose a valid stop.');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (via.length) {
        const places = [from, ...via, to], legs = [];
        for (let index = 1; index < places.length; index++) {
          legs.push(await request(places[index - 1], places[index], mode, {signal}));
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        }
        return combineRoutes(legs, via);
      }
      const standardURL = core.routeURL(from, to, mode), apiKey = key();
      if (mapbox && mode === 'driving') {
        const response = await send(mapboxEndpoint + '/route', {method: 'POST', credentials: 'omit', cache: 'no-store', signal,
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify({from: {lat: from.lat, lng: from.lng}, to: {lat: to.lat, lng: to.lng}, traffic: enabled})});
        if (!response.ok) throw new Error('3D route update unavailable. Try again shortly.');
        const data = await response.json();
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return readMapboxRoute(data, enabled);
      }
      const identity = apiKey || (defaultAvailable ? 'default' : '');
      let reason = mode === 'walking' ? 'off' : !identity ? 'missing-key' : !enabled ? 'off' : 'unavailable';
      if (mode === 'driving' && enabled && identity && identity !== blockedKey) {
        const controller = new AbortController(), abort = () => controller.abort();
        if (signal?.aborted) controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 8000);
        try {
          // A visitor's key replaces the private default, including on failure.
          const request = apiKey ? trafficRequest(from, to, apiKey) : {url: '/api/maps/tomtom/route', options: {
            method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({from: {lat: from.lat, lng: from.lng}, to: {lat: to.lat, lng: to.lng}}),
          }};
          const response = await send(request.url, { ...request.options, signal: controller.signal });
          if ([401, 403, 429].includes(response.status)) blockedKey = identity;
          if (!response.ok) throw new Error('Traffic unavailable.');
          const route = readTrafficRoute(await response.json());
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          return route;
        } catch (error) { if (signal?.aborted) throw error; }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      }
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await send(standardURL, { signal, cache: 'no-store', credentials: 'omit' });
      const data = await response.json();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!response.ok && !['NoRoute', 'NoSegment'].includes(data?.code)) throw new Error('Routing is unavailable. Try again, or open your navigation app below.');
      return { ...core.readRoute(data, mode), traffic: false, trafficReason: reason, provider: mode === 'walking' ? 'fossgis' : 'osrm', fetchedAt: Date.now() };
    }
    return { request, setMapbox(value) { mapbox = !!value; }, get enabled() { return enabled && (mapbox || !!key() || defaultAvailable); }, get connected() { return mapbox || !!key() || defaultAvailable; }, get hasOwnKey() { return !!key(); }, setEnabled(value) {
      enabled = !!value; if (enabled) blockedKey = '';
      try { storage?.setItem('gregle-maps-route-traffic', enabled ? 'on' : 'off'); } catch {}
    } };
  }
  function note(route, mode = 'driving') {
    if (mode === 'walking') return 'Estimated walking time. Routes follow mapped pedestrian access.';
    if (route?.trafficPartial) return 'Live traffic is unavailable for part of this route. Ferry waits may vary.';
    if (route?.provider === 'mapbox') return route.traffic ? 'Mapbox traffic included where available. Ferry waits may vary.' : 'Mapbox route · Live traffic off. Ferry waits may vary.';
    if (route?.traffic) return `Live traffic included${route.trafficDelay >= 60 ? ` · ${core.duration(route.trafficDelay)} traffic delay` : ''}. Ferry waits may vary.`;
    if (route?.trafficReason === 'missing-key') return 'Live traffic off. Connect TomTom to enable it. This estimate excludes live traffic and ferry waits.';
    if (route?.trafficReason === 'unavailable') return 'Live traffic unavailable. This route excludes live traffic and ferry waits.';
    return 'Live traffic off. Estimated driving time excludes live traffic and ferry waits.';
  }
  return { create, combineRoutes, trafficRequest, readTrafficRoute, readMapboxRoute, mapboxEndpoint, note };
});
