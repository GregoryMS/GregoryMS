((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleEVCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const limit = 750;
  const clean = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const wrap = lng => ((lng + 180) % 360 + 360) % 360 - 180;
  const point = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  function area(bounds, zoom) {
    if (zoom < 12 || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return null;
    const [west, south, east, north] = bounds, width = east - west, height = north - south;
    if (width <= 0 || width > 1.5 || height <= 0 || height > .7 || south < -90 || north > 90) return null;
    const padX = width * .25, padY = height * .25, w = wrap(west - padX);
    return [w, Math.max(-90, south - padY), w + width + padX * 2, Math.min(90, north + padY)].map(n => Number(n.toFixed(6)));
  }
  function contains(outer, inner) {
    if (!outer || !inner || inner[1] < outer[1] || inner[3] > outer[3]) return false;
    const west = outer[0] + ((inner[0] - outer[0]) % 360 + 360) % 360;
    return west + inner[2] - inner[0] <= outer[2] + .000001;
  }
  function query(bounds) {
    const [west, south, east, north] = bounds;
    const select = (w, e) => `nwr[amenity=charging_station](${south},${w},${north},${e});`;
    const body = east > 180 ? `(${select(west, 180)}${select(-180, east - 360)});` : select(west, east);
    return `[out:json][timeout:12][maxsize:16777216];${body}out center ${limit + 1};`;
  }
  function read(data) {
    if (!Array.isArray(data?.elements) || data.remark) throw new Error('Charging data is incomplete');
    const seen = new Set(), stations = [];
    for (const item of data.elements.slice(0, limit)) {
      if (!['node', 'way', 'relation'].includes(item?.type) || !Number.isSafeInteger(item.id) || item.id <= 0 || item.tags?.amenity !== 'charging_station') continue;
      const lat = item.type === 'node' ? item.lat : item.center?.lat, lng = item.type === 'node' ? item.lon : item.center?.lon;
      const id = `${item.type}/${item.id}`;
      if (!point(lat, lng) || seen.has(id) || item.tags.motorcar === 'no' || item.tags.motor_vehicle === 'no') continue;
      const tags = {};
      for (const [key, value] of Object.entries(item.tags).slice(0, 200)) if (typeof value === 'string') tags[clean(key, 100)] = clean(value, 2000);
      const connectors = [];
      const names = { type1: 'J1772 (Type 1)', type1_combo: 'CCS1', type2: 'Type 2', type2_combo: 'CCS2', chademo: 'CHAdeMO', nacs: 'NACS', tesla_supercharger: 'Tesla Supercharger / NACS', tesla_destination: 'Tesla Destination', tesla_roadster: 'Tesla Roadster', schuko: 'Schuko', nema_5_15: 'NEMA 5-15', nema_5_20: 'NEMA 5-20', nema_14_50: 'NEMA 14-50', type3c: 'Type 3C' };
      for (const [key, value] of Object.entries(tags)) {
        const match = /^socket:([^:]+)$/.exec(key);
        if (!match || !/^(yes|[1-9]\d{0,3})$/.test(value)) continue;
        const type = match[1], output = clean(tags[`socket:${type}:output`], 80);
        connectors.push({ name: names[type] || type.replaceAll('_', ' '), count: value === 'yes' ? null : Number(value), output });
      }
      seen.add(id);
      const address = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
      stations.push({ id, point: [lat, lng], name: clean(tags.name) || clean(tags.operator) || clean(tags.network) || clean(tags.brand) || 'EV charging station', address, tags, connectors, restricted: ['private', 'no', 'customers', 'permit', 'destination'].includes(tags.access) });
    }
    const date = data.osm3s?.timestamp_osm_base;
    return { stations, truncated: data.elements.length > limit, snapshot: typeof date === 'string' && Number.isFinite(Date.parse(date)) ? date : null };
  }
  return { area, contains, query, read, limit };
});
