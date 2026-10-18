((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleFerriesCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const text = (value, limit = 240) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  function link(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['www2.gov.bc.ca', 'www.bcferries.com', 'bcferries.com', 'www.drivebc.ca'].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : null;
    } catch { return null; }
  }
  function read(data, now = Date.now()) {
    if (data?.sources?.inland !== 'https://www.drivebc.ca/api/ferries/' || data?.sources?.coastal !== 'https://www.drivebc.ca/api/ferries/coastal/' || typeof data.fetchedAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(data.fetchedAt) || !Number.isFinite(Date.parse(data.fetchedAt)) || Date.parse(data.fetchedAt) > now + 300000 || !Array.isArray(data.ferries) || data.ferries.length > 2000) throw new Error('Invalid ferry snapshot');
    const ferries = [], seen = new Set();
    for (const item of data.ferries) {
      const point = item?.point, kind = item?.kind, id = text(item?.id, 80), name = text(item?.name);
      if (!['inland', 'coastal'].includes(kind) || !new RegExp(`^${kind}/[1-9]\\d{0,15}$`).test(id) || seen.has(id) || !name || !Array.isArray(point) || point.length !== 2 || point.some(v => typeof v !== 'number' || !Number.isFinite(v)) || point[0] < 48 || point[0] > 60.1 || point[1] < -139.1 || point[1] > -114) continue;
      const routes = (Array.isArray(item.routes) ? item.routes : []).slice(0, 100).map(route => ({ name: text(route?.name), url: link(route?.url) })).filter(route => route.name);
      const vessels = (Array.isArray(item.vessels) ? item.vessels : []).slice(0, 10).filter(vessel => vessel && typeof vessel === 'object').map(vessel => {
        const parsed = { name: text(vessel.name), schedule: text(vessel.schedule, 12000), restriction: text(vessel.restriction, 4000) };
        for (const key of ['vehicle_capacity', 'passenger_capacity', 'crossing_time_min']) if (typeof vessel[key] === 'number' && Number.isFinite(vessel[key]) && vessel[key] > 0 && vessel[key] < 100000) parsed[key] = vessel[key];
        return parsed;
      });
      const phone = text(item.phone, 80);
      ferries.push({ id, kind, name, point, description: text(item.description, 12000), url: link(item.url), operator: text(item.operator), phone, phoneURL: /^[+\d][\d ()+.-]{4,78}$/.test(phone) ? 'tel:' + phone.replace(/[^+\d]/g, '') : null, routes, vessels });
      seen.add(id);
    }
    if (!ferries.length) throw new Error('No usable ferry locations');
    return { fetched: data.fetchedAt, ferries };
  }
  return { read, link };
});
