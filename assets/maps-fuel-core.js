((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleFuelCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const fuels = {regular: 'Regular', midgrade: 'Mid-grade', premium: 'Premium', diesel: 'Diesel'};
  const sourceURL = 'https://charting.kalibrate.com/WPPS_Public/DPPS_Public.htm';
  const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
  const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const text = value => typeof value === 'string' ? value.trim().slice(0, 180) : '';
  const price = value => typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 500 ? value : null;
  function today(now = Date.now()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function age(date, now = Date.now()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return Infinity;
    const stamp = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) return Infinity;
    return (Date.parse(today(now) + 'T00:00:00Z') - stamp) / 86400000;
  }
  function read(data, now = Date.now()) {
    const days = age(data?.date, now);
    if (days < 0 || days > 4 || data?.source !== 'Kalibrate Canada' || data?.unit !== 'CAD cents/litre' || !Array.isArray(data.markets) || data.markets.length > 150) throw Error('Current daily survey unavailable');
    const seen = new Set(), markets = [];
    for (const item of data.markets) {
      const name = text(item?.name), province = text(item?.province);
      if (!name || !/^[A-Z]{2}(\/[A-Z]{2})?$/.test(province) || !valid(item.lat, item.lng) || item.lat < 41 || item.lat > 70 || item.lng < -142 || item.lng > -52 || seen.has(name + province)) continue;
      markets.push({name, province, lat: item.lat, lng: item.lng, prices: Object.fromEntries(Object.keys(fuels).map(key => [key, price(item.prices?.[key])]))});
      seen.add(name + province);
    }
    if (!markets.length) throw Error('Daily survey has no valid markets');
    return {date: data.date, markets, delayed: data.delayed === true};
  }
  function distance(a, b) {
    const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = wrap(b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }
  function contains(box, point) {
    const [west, south, east, north] = box;
    return point.lat >= south && point.lat <= north && (east - west >= 360 || ((point.lng - west) % 360 + 360) % 360 <= east - west);
  }
  function select(markets, center, box, fuel) {
    const ordered = markets.filter(item => price(item.prices[fuel]) !== null).map(item => ({...item, distance: distance(center, item)})).sort((a, b) => a.distance - b.distance);
    return ordered.find(item => contains(box, item)) || (ordered[0]?.distance <= 50 ? ordered[0] : null);
  }
  function stations(data, box) {
    if (!Array.isArray(data?.elements) || data.elements.length > 751) throw Error('Invalid station response');
    const seen = new Set(), result = [];
    for (const item of data.elements) {
      const lat = item?.type === 'node' ? item.lat : item?.center?.lat, lng = item?.type === 'node' ? item.lon : item?.center?.lon;
      if (!['node', 'way', 'relation'].includes(item?.type) || !Number.isSafeInteger(item.id) || item.id <= 0 || !valid(lat, lng) || item.tags?.amenity !== 'fuel' || !contains(box, {lat, lng}) || seen.has(item.type + item.id)) continue;
      const tags = item.tags;
      result.push({id: `${item.type}/${item.id}`, lat, lng, name: text(tags.name) || text(tags.brand) || text(tags.operator) || 'Petrol station', address: [text(tags['addr:housenumber']), text(tags['addr:street']), text(tags['addr:city'])].filter(Boolean).join(' '), hours: text(tags.opening_hours), access: text(tags.access)});
      seen.add(item.type + item.id);
    }
    return result;
  }
  function stationArea(box, zoom) {
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || zoom < 10) return null;
    const [w, s, e, n] = box, west = wrap(w), width = e - w;
    if (width <= 0 || width > 2.3 || s < -90 || n > 90 || n <= s || n - s > 1.1) return null;
    return [west, s, west + width, n];
  }
  function covers(outer, inner) {
    const offset = ((inner[0] - outer[0]) % 360 + 360) % 360;
    return inner[1] >= outer[1] && inner[3] <= outer[3] && offset + inner[2] - inner[0] <= outer[2] - outer[0] + 1e-7;
  }
  function stationCache(data, now = Date.now()) {
    const area = data?.area;
    if (!Array.isArray(area) || area.length !== 4 || !area.every(Number.isFinite) || area[0] < -180 || area[0] >= 180 || area[2] <= area[0] || area[2] - area[0] > 2.4 || area[1] < -90 || area[3] > 90 || area[3] <= area[1] || area[3] - area[1] > 1.2 || !Number.isFinite(data.fetchedAt) || data.fetchedAt > now || now - data.fetchedAt >= 7 * 86400000) throw Error('Invalid station cache');
    const items = stations(data, area);
    if (data.elements.length && !items.length) throw Error('Invalid cached station locations');
    // Keep only the public location fields used by the map, bounding saved browser data.
    const elements = items.map(point => { const [type, id] = point.id.split('/'); return {type, id: Number(id), ...(type === 'node' ? {lat: point.lat, lon: point.lng} : {center: {lat: point.lat, lon: point.lng}}), tags: {amenity: 'fuel', name: point.name, 'addr:street': point.address, opening_hours: point.hours, access: point.access}}; });
    return {area, elements, fetchedAt: data.fetchedAt, truncated: data.truncated === true, gregle: {stale: data.gregle?.stale === true}};
  }
  return {fuels, sourceURL, today, age, read, distance, contains, select, stations, stationArea, covers, stationCache, format: cents => price(cents) === null ? 'Unavailable' : `$${(cents / 100).toFixed(3)}`};
});
