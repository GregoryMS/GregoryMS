((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleNavigation = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const valid = p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  const coords = p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  function routeURL(from, to) {
    if (!valid(from) || !valid(to)) throw new Error('Choose two valid locations.');
    return `https://router.project-osrm.org/route/v1/driving/${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}?overview=full&geometries=geojson&steps=true&radiuses=1000;1000`;
  }
  function links(from, to) {
    if (!valid(from) || !valid(to)) return null;
    const google = new URL('https://www.google.com/maps/dir/');
    for (const [key, value] of Object.entries({ api: '1', origin: coords(from), destination: coords(to), travelmode: 'driving', dir_action: 'navigate' })) google.searchParams.set(key, value);
    const apple = new URL('https://maps.apple.com/');
    apple.searchParams.set('saddr', coords(from)); apple.searchParams.set('daddr', coords(to)); apple.searchParams.set('dirflg', 'd');
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
  function readRoute(data) {
    if (data?.code === 'NoRoute' || data?.code === 'NoSegment') throw new Error('No driving route found near these locations. Try points closer to a road.');
    const r = data?.routes?.[0], points = r?.geometry?.coordinates;
    if (data?.code !== 'Ok' || r?.geometry?.type !== 'LineString' || !Array.isArray(points) || points.length < 2 || points.length > 200000 || !points.every(p => Array.isArray(p) && valid({ lat: p[1], lng: p[0] })) || !Number.isFinite(r.distance) || r.distance < 0 || !Number.isFinite(r.duration) || r.duration < 0) throw new Error('The routing service returned an invalid route. Try again.');
    const steps = (r.legs || []).flatMap(leg => Array.isArray(leg.steps) ? leg.steps : []);
    if (steps.length > 3000) throw new Error('This route has too many steps. Try a shorter journey.');
    return { points: points.map(p => [p[1], p[0]]), distance: r.distance, duration: r.duration, steps: steps.filter(s => s && Number.isFinite(s.distance) && s.distance >= 0).map(s => ({ text: instruction(s), distance: s.distance })) };
  }
  return { valid, routeURL, links, distance, duration, readRoute, instruction };
});
