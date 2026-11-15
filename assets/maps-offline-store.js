/* Shared IndexedDB/package reader, used by the page and the routing worker. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleOfflineStore = api;
})(globalThis, () => {
  'use strict';
  const DB = 'gregle-maps-offline-v1', stores = ['packages', 'settings'];
  const presets = [
    ['victoria', 'Victoria'], ['greater-victoria', 'Greater Victoria'],
    ['vancouver-island', 'Vancouver Island'], ['greater-vancouver', 'Greater Vancouver'],
    ['british-columbia', 'British Columbia']
  ];
  const inside = (p, b) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lng >= b[0] && p.lat >= b[1] && p.lng <= b[2] && p.lat <= b[3];
  const tile = (lat, lng) => `${Math.floor(lng * 4)}_${Math.floor(lat * 4)}`;
  function catalog(data) {
    if (data?.schema !== 1 || !/^offline-\d{8,14}$/.test(data.version) || !Array.isArray(data.regions) || data.regions.length !== presets.length) throw Error('Invalid offline catalog.');
    for (const [id, name] of presets) {
      const region = data.regions.find(r => r.id === id);
      if (!region || region.name !== name || !Array.isArray(region.bounds) || region.bounds.length !== 4 || !region.bounds.every(Number.isFinite) || region.bounds[0] >= region.bounds[2] || region.bounds[1] >= region.bounds[3] || Math.abs(region.bounds[0]) > 180 || Math.abs(region.bounds[2]) > 180 || Math.abs(region.bounds[1]) > 90 || Math.abs(region.bounds[3]) > 90) throw Error('Invalid offline region.');
      for (const component of ['maps', 'routing']) {
        const part = region.components?.[component];
        if (part?.file !== `${id}-${component}.bin` || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > 2000000000 || !part.entries || Object.keys(part.entries).length > 40000) throw Error('Invalid offline package.');
        let cursor = 0;
        for (const [key, entry] of Object.entries(part.entries)) {
          if ((key !== 'overview' && !/^-?\d+_-?\d+$/.test(key)) || !Array.isArray(entry) || entry.length !== 3 || entry[0] !== cursor || !Number.isSafeInteger(entry[1]) || entry[1] < 1 || entry[1] > 64000000 || !/^[a-f0-9]{64}$/.test(entry[2])) throw Error('Invalid offline index.');
          cursor += entry[1];
        }
        if (cursor !== part.bytes) throw Error('Incomplete offline index.');
      }
    }
    return data;
  }
  let connection;
  function database() {
    return connection ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => stores.forEach(name => request.result.createObjectStore(name));
      request.onsuccess = () => { request.result.onversionchange = () => {request.result.close(); connection = null;}; resolve(request.result); };
      request.onerror = () => {connection = null; reject(request.error);};
      request.onblocked = () => {connection = null; reject(Error('Close other Gregle Maps tabs and try again.'));};
    });
  }
  async function transaction(name, mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode), request = action(tx.objectStore(name));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error('Offline storage is unavailable.'));
    });
  }
  const get = (key, store = 'packages') => transaction(store, 'readonly', s => s.get(key));
  const put = (key, value, store = 'packages') => transaction(store, 'readwrite', s => s.put(value, key));
  const remove = key => transaction('packages', 'readwrite', s => s.delete(key));
  const list = () => transaction('packages', 'readonly', s => s.getAll());
  async function read(pack, key) {
    const entry = pack?.index?.entries[key];
    if (!entry) return null;
    const compressed = pack.blob.slice(entry[0], entry[0] + entry[1]);
    const stream = compressed.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json();
  }
  async function verify(blob, index, signal, progress = () => {}) {
    if (blob.size !== index.bytes) throw Error('The download is incomplete. Please try again.');
    let checked = 0;
    for (const entry of Object.values(index.entries)) {
      signal?.throwIfAborted();
      const bytes = await blob.slice(entry[0], entry[0] + entry[1]).arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== entry[2]) throw Error('The download failed its integrity check. Please try again.');
      checked += entry[1]; progress(checked / index.bytes);
    }
  }
  return {DB, presets, inside, tile, catalog, get, put, remove, list, read, verify};
});
