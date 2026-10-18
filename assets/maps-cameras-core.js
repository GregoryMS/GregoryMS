((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleCamerasCore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const clean = (value, limit = 180) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  function readCatalogue(csv) {
    if (typeof csv !== 'string' || csv.length > 2000000) throw new Error('Invalid camera catalogue');
    csv = csv.replace(/^\uFEFF/, '');
    const rows = []; let row = [], field = '', quoted = false, closed = false;
    const cell = () => { row.push(field); field = ''; closed = false; };
    const endRow = () => { cell(); if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > 5001) throw new Error('Camera catalogue too large'); };
    for (let i = 0; i < csv.length; i++) {
      const char = csv[i];
      if (quoted) {
        if (char === '"' && csv[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else field += char;
      } else if (char === ',' || char === '\n' || char === '\r') {
        if (char === ',') cell();
        else { endRow(); if (char === '\r' && csv[i + 1] === '\n') i++; }
      } else if (char === '"' && !field && !closed) quoted = true;
      else { if (closed || char === '"') throw new Error('Invalid camera CSV'); field += char; }
    }
    if (quoted) throw new Error('Incomplete camera CSV');
    if (field || row.length || closed) endRow();
    const headers = rows.shift() || [];
    const required = ['id', 'cam_group', 'camName', 'links_imageURL', 'links_camDetailsPage', 'latitude', 'longitude'];
    if (new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) throw new Error('Invalid camera columns');
    const groups = new Map(), seen = new Set();
    for (const values of rows) {
      if (values.length !== headers.length) continue;
      const value = Object.fromEntries(headers.map((key, index) => [key, values[index]]));
      const id = clean(value.id), groupID = clean(value.cam_group);
      const lat = Number(value.latitude), lng = Number(value.longitude);
      if (!/^[1-9]\d{0,8}$/.test(id) || !/^[1-9]\d{0,8}$/.test(groupID) || seen.has(id) || !value.latitude.trim() || !value.longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 48 || lat > 60.1 || lng < -139.1 || lng > -114) continue;
      // Accept only the official per-camera image and detail URLs, never arbitrary CSV links.
      const imageURL = `https://www.drivebc.ca/images/${id}.jpg`, pageURL = `https://www.drivebc.ca/cameras/${id}`;
      if (clean(value.links_imageURL, 500) !== imageURL || clean(value.links_camDetailsPage, 500) !== pageURL) continue;
      const name = clean(value.camName) || `Camera ${id}`;
      const camera = { id, name, imageURL, pageURL, caption: clean(value.caption, 1000), highway: clean(value.highway_number), orientation: clean(value.orientation, 20), credit: clean(value.credit, 1000).replace(/<[^>]*>/g, '').replaceAll('&amp;', '&') };
      const key = `${groupID}/${lat}/${lng}`;
      if (!groups.has(key)) groups.set(key, { id: key, point: [lat, lng], name: name.replace(/ - (N|NE|E|SE|S|SW|W|NW)$/, ''), cameras: [] });
      groups.get(key).cameras.push(camera); seen.add(id);
    }
    if (rows.length && !seen.size) throw new Error('No valid cameras');
    for (const group of groups.values()) group.cameras.sort((a, b) => a.name.localeCompare(b.name));
    return [...groups.values()];
  }
  return { readCatalogue };
});
