((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleNavigation = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const valid = p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  const coords = p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  function routeURL(from, to, mode = 'driving') {
    if (!valid(from) || !valid(to)) throw new Error('Choose two valid locations.');
    if (!['driving', 'walking'].includes(mode)) throw new Error('Choose driving or walking.');
    const base = mode === 'walking' ? 'https://routing.openstreetmap.de/routed-foot/route/v1/foot' : 'https://router.project-osrm.org/route/v1/driving';
    return `${base}/${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}?overview=full&geometries=geojson&steps=true&radiuses=${mode === 'walking' ? '250;250' : '1000;1000'}`;
  }
  function links(from, to, mode = 'driving') {
    if (!valid(from) || !valid(to)) return null;
    const google = new URL('https://www.google.com/maps/dir/');
    for (const [key, value] of Object.entries({ api: '1', origin: coords(from), destination: coords(to), travelmode: mode, dir_action: 'navigate' })) google.searchParams.set(key, value);
    const apple = new URL('https://maps.apple.com/');
    apple.searchParams.set('saddr', coords(from)); apple.searchParams.set('daddr', coords(to)); apple.searchParams.set('dirflg', mode === 'walking' ? 'w' : 'd');
    return { google: google.href, apple: apple.href };
  }
  const distance = meters => meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
  function duration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  }
  function instruction(step) {
    const m = step.maneuver || {}, modifier = typeof m.modifier === 'string' ? m.modifier.replace(/-/g, ' ') : '';
    const road = typeof step.name === 'string' && step.name.trim() ? ` onto ${step.name.slice(0, 180)}` : '';
    if (m.type === 'depart') return `Start${road}`;
    if (m.type === 'arrive') return 'Arrive at your destination';
    if (['roundabout', 'rotary'].includes(m.type)) return `Enter the roundabout${Number.isInteger(m.exit) && m.exit > 0 ? ` and take exit ${m.exit}` : ''}${road}`;
    const verb = ({ turn: 'Turn', 'new name': 'Continue', continue: 'Continue', merge: 'Merge', fork: 'Keep', 'on ramp': 'Take the ramp', 'off ramp': 'Take the exit', 'end of road': 'At the end of the road, turn', 'exit roundabout': 'Exit the roundabout', 'exit rotary': 'Exit the roundabout', 'use lane': 'Follow the lane' })[m.type] || 'Continue';
    return `${verb}${modifier ? ' ' + modifier : ''}${road}`;
  }
  const radians = n => n * Math.PI / 180;
  function meters(a, b) {
    const lat = radians(b.lat - a.lat), lng = radians(b.lng - a.lng);
    const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
  }
  function readRoute(data, mode = 'driving') {
    if (data?.code === 'NoRoute' || data?.code === 'NoSegment') throw new Error(`No ${mode} route found near these locations. Try points closer to a ${mode === 'walking' ? 'path' : 'road'}.`);
    const r = data?.routes?.[0], points = r?.geometry?.coordinates;
    if (data?.code !== 'Ok' || r?.geometry?.type !== 'LineString' || !Array.isArray(points) || points.length < 2 || points.length > 200000 || !points.every(p => Array.isArray(p) && valid({ lat: p[1], lng: p[0] })) || !Number.isFinite(r.distance) || r.distance < 0 || !Number.isFinite(r.duration) || r.duration < 0) throw new Error('The routing service returned an invalid route. Try again.');
    const steps = (r.legs || []).flatMap(leg => Array.isArray(leg.steps) ? leg.steps : []);
    if (steps.length > 3000) throw new Error('This route has too many steps. Try a shorter journey.');
    const cumulative = [0], indices = new Map();
    const key = p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    for (let i = 0; i < points.length; i++) {
      if (i) cumulative.push(cumulative[i - 1] + meters({ lat: points[i - 1][1], lng: points[i - 1][0] }, { lat: points[i][1], lng: points[i][0] }));
      const k = key(points[i]); if (!indices.has(k)) indices.set(k, []); indices.get(k).push(i);
    }
    let traveled = 0, cursor = 0;
    const total = cumulative[cumulative.length - 1];
    const directions = steps.filter(s => s && Number.isFinite(s.distance) && s.distance >= 0).map(s => {
      const location = s.maneuver?.location;
      const index = Array.isArray(location) && valid({ lat: location[1], lng: location[0] }) ? indices.get(key(location))?.find(i => i >= cursor) : undefined;
      if (index !== undefined) cursor = index;
      const start = index === undefined ? (r.distance ? total * traveled / r.distance : 0) : cumulative[index];
      traveled += s.distance;
      return { text: instruction(s), distance: s.distance, start, type: s.maneuver?.type || 'continue', modifier: s.maneuver?.modifier || '' };
    });
    return { points: points.map(p => [p[1], p[0]]), distance: r.distance, duration: r.duration, steps: directions, cumulative, length: total };
  }
  function progress(route, point, previous = null, mode = 'driving') {
    if (!valid(point) || !route?.points?.length) return null;
    let best = null;
    const search = (from, to) => {
      const scale = Math.max(.0001, Math.cos(radians(point.lat)));
      const relative = lng => ((lng - point.lng + 540) % 360 - 180) * scale * 111195;
      for (let i = from; i < to; i++) {
        const a = route.points[i], b = route.points[i + 1];
        const ax = relative(a[1]), ay = (a[0] - point.lat) * 111195, bx = relative(b[1]), by = (b[0] - point.lat) * 111195;
        const dx = bx - ax, dy = by - ay, norm = dx * dx + dy * dy;
        const t = norm ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / norm)) : 0;
        const away = Math.hypot(ax + t * dx, ay + t * dy);
        const along = route.cumulative[i] + t * (route.cumulative[i + 1] - route.cumulative[i]);
        const score = away + (previous ? Math.min(30, Math.abs(along - previous.along) / 100) : 0);
        if (!best || score < best.score) best = { index: i, along, away, score };
      }
    };
    const end = route.points.length - 1;
    search(previous ? Math.max(0, previous.index - 40) : 0, previous ? Math.min(end, previous.index + 400) : end);
    if (previous && best.away > 200) search(0, end);
    const ratio = route.length ? Math.min(1, best.along / route.length) : 1;
    const next = route.steps.find(s => s.start > best.along + 8) || route.steps[route.steps.length - 1];
    const last = route.points[end], endDistance = meters(point, { lat: last[0], lng: last[1] });
    return { ...best, next, turnDistance: Math.max(0, (next?.start ?? route.length) - best.along), remaining: route.distance * (1 - ratio), seconds: route.duration * (1 - ratio), arrived: ratio > .92 && endDistance < (mode === 'walking' ? 20 : 35) };
  }
  return { valid, routeURL, links, distance, duration, readRoute, instruction, meters, progress };
});
