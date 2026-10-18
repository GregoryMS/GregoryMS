((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleSignsCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const text = (value, length = 180) => typeof value === 'string' ? value.trim().slice(0, length) : '';
  const timestamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
  const point = geometry => geometry?.type === 'Point' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.slice(0, 2).every(v => typeof v === 'number' && Number.isFinite(v)) && geometry.coordinates[1] >= 48 && geometry.coordinates[1] <= 60.1 && geometry.coordinates[0] >= -139.1 && geometry.coordinates[0] <= -114 ? [geometry.coordinates[1], geometry.coordinates[0]] : null;
  const speed = value => typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 130 ? value : null;
  function readSpeed(data) {
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 2000) throw new Error('Invalid speed-sign feed');
    const seen = new Set(), signs = [];
    for (const feature of data.features) {
      const p = feature?.properties || {}, position = point(feature?.geometry), id = String(p.id ?? '').slice(0, 128);
      if (!position || !id || seen.has(id)) continue;
      seen.add(id);
      signs.push({ id, point: position, name: text(p.vslsId) || text(p.segmentName) || `Speed sign ${id}`, road: text(p.corridorName), direction: text(p.direction), status: text(p.status), enabled: p.isSegmentEnabled === true, posted: speed(p.postedSpeed), regular: speed(p.maxSpeed), received: timestamp(p.receivedDate), changed: timestamp(p.postedDate) });
    }
    return { signs };
  }
  function cleanMessage(value) {
    return text(value, 4000).replace(/\[np\]/gi, '\n\n').replace(/\[nl\]/gi, '\n').replace(/\[[^\]]*\]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
  }
  function readMessages(data) {
    const fetched = timestamp(data?.fetchedAt);
    if (!fetched || data?.source !== 'https://www.drivebc.ca/api/dms/' || !Array.isArray(data.signs) || data.signs.length > 2000) throw new Error('Invalid message-sign snapshot');
    const signs = [], seen = new Set();
    for (const item of data.signs) {
      const position = point(item?.location), id = text(String(item?.id ?? ''), 128);
      if (!position || !id || seen.has(id)) continue;
      seen.add(id);
      let pages = [1, 2, 3].map(i => cleanMessage(item[`message_display_${i}`])).filter(Boolean);
      if (!pages.length) pages = cleanMessage(item.message_text).split('\n\n').filter(Boolean).slice(0, 3);
      signs.push({ id, point: position, name: text(item.name) || text(item.description) || `Message sign ${id}`, road: text(item.roadway_name), direction: text(item.roadway_direction), status: text(item.status), enabled: item.is_on !== false, pages, fetched, received: timestamp(item.cache_datetime_utc), changed: timestamp(item.updated_datetime_utc), expires: timestamp(item.message_expiry_datetime_utc) });
    }
    return { signs, fetched };
  }
  const fresh = (value, now, maxAge) => value && now - Date.parse(value) >= -300000 && now - Date.parse(value) <= maxAge;
  function available(sign, type, now = Date.now()) {
    if (!sign.enabled) return false;
    if (type === 'speed') return sign.status.toLowerCase() === 'operational' && sign.posted !== null && fresh(sign.received, now, 900000);
    return fresh(sign.fetched, now, 2700000) && (!sign.received || fresh(sign.received, now, 2700000)) && (!sign.expires || Date.parse(sign.expires) > now) && !/connection error|unknown|offline/i.test(sign.status);
  }
  return { readSpeed, readMessages, available, cleanMessage };
});
