/* Shared IndexedDB/package reader, used by the page and the routing worker. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleOfflineStore = api;
})(globalThis, () => {
  'use strict';
  const DB = 'gregle-maps-offline-v1', stores = ['packages', 'settings', 'chunks'];
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const size = pack => pack?.bytes ?? pack?.blob?.size ?? 0;
  const presets = [
    ['victoria', 'Victoria'], ['greater-victoria', 'Greater Victoria'],
    ['vancouver-island', 'Vancouver Island'], ['greater-vancouver', 'Greater Vancouver'],
    ['british-columbia', 'British Columbia']
  ];
  const inside = (p, b) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lng >= b[0] && p.lat >= b[1] && p.lng <= b[2] && p.lat <= b[3];
  const tile = (lat, lng) => `${Math.floor(lng * 4)}_${Math.floor(lat * 4)}`;
  function catalog(data) {
    if (![1, 2].includes(data?.schema) || !/^offline-\d{8,14}$/.test(data.version) || !Array.isArray(data.regions) || data.regions.length !== presets.length) throw Error('Invalid offline catalog.');
    for (const [id, name] of presets) {
      const region = data.regions.find(r => r.id === id);
      if (!region || region.name !== name || !Array.isArray(region.bounds) || region.bounds.length !== 4 || !region.bounds.every(Number.isFinite) || region.bounds[0] >= region.bounds[2] || region.bounds[1] >= region.bounds[3] || Math.abs(region.bounds[0]) > 180 || Math.abs(region.bounds[2]) > 180 || Math.abs(region.bounds[1]) > 90 || Math.abs(region.bounds[3]) > 90) throw Error('Invalid offline region.');
      for (const component of ['maps', 'routing']) {
        const part = region.components?.[component];
        const vector = component === 'maps' && data.schema === 2 && part?.format === 'pmtiles';
        if (part?.file !== `${id}-${component}.${vector ? 'pmtiles' : 'bin'}` || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes >= 2147483648 || !part.entries || Object.keys(part.entries).length > 40000 || part.version && !/^offline-\d{8,14}$/.test(part.version)) throw Error('Invalid offline package.');
        if (vector && (part.schema !== 'shortbread' || part.minZoom !== 0 || part.maxZoom !== 14)) throw Error('Unsupported offline map.');
        let cursor = 0;
        for (const [key, entry] of Object.entries(part.entries)) {
          if ((vector ? key !== 'chunk-' + Math.floor(cursor / CHUNK_SIZE) || entry?.[1] !== Math.min(CHUNK_SIZE, part.bytes - cursor) : key !== 'overview' && !/^-?\d+_-?\d+$/.test(key)) || !Array.isArray(entry) || entry.length !== 3 || entry[0] !== cursor || !Number.isSafeInteger(entry[1]) || entry[1] < 1 || entry[1] > 64000000 || !/^[a-f0-9]{64}$/.test(entry[2])) throw Error('Invalid offline index.');
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
      const request = indexedDB.open(DB, 2);
      request.onupgradeneeded = () => stores.forEach(name => {if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);});
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
  const list = () => transaction('packages', 'readonly', s => s.getAll());
  const pending = async () => (await transaction('settings', 'readonly', s => s.getAll())).filter(p => p?.format === 'chunks-v1');
  const prefix = generation => IDBKeyRange.bound(generation + '/', generation + '/\uffff');
  async function atomic(names, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || Error('Offline storage is unavailable.'));
      action(tx);
    });
  }
  async function remove(key) {
    await atomic(['packages', 'settings', 'chunks'], tx => {
      for (const [name, id] of [['packages', key], ['settings', 'download:' + key]]) {
        const request = tx.objectStore(name).get(id);
        request.onsuccess = () => {if (request.result?.generation) tx.objectStore('chunks').delete(prefix(request.result.generation));};
        tx.objectStore(name).delete(id);
      }
    });
  }
  async function cleanup() {
    await atomic(['packages', 'settings', 'chunks'], tx => {
      const references = new Set(); let remaining = 2;
      for (const name of ['packages', 'settings']) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => {
          for (const p of request.result) if (p?.generation) references.add(p.generation);
          if (--remaining) return;
          const cursor = tx.objectStore('chunks').openKeyCursor();
          cursor.onsuccess = () => {const c = cursor.result; if (!c) return; if (!references.has(String(c.key).split('/')[0])) tx.objectStore('chunks').delete(c.key); c.continue();};
        };
      }
    });
  }
  async function rangeBlob(pack, offset, length, cache = new Map()) {
    if (pack.blob) return pack.blob.slice(offset, offset + length); // Existing downloads remain readable.
    if (pack.format !== 'chunks-v1') throw Error('Unsupported offline download.');
    const pieces = [], end = offset + length;
    for (let i = Math.floor(offset / pack.chunkSize); i <= Math.floor((end - 1) / pack.chunkSize); i++) {
      let buffer = cache.get(i);
      if (!buffer) {buffer = get(pack.generation + '/' + i, 'chunks'); cache.set(i, buffer); while (cache.size > 2) cache.delete(cache.keys().next().value);}
      buffer = await buffer; if (!buffer) throw Error('Offline download is incomplete.');
      const start = i * pack.chunkSize;
      pieces.push(new Uint8Array(buffer, Math.max(0, offset - start), Math.min(buffer.byteLength, end - start) - Math.max(0, offset - start)));
    }
    return new Blob(pieces);
  }
  async function range(pack, offset, length, signal, cache) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > 16 * 1024 * 1024 || offset + length > size(pack)) throw Error('Invalid offline map range.');
    const data = await (await rangeBlob(pack, offset, length, cache)).arrayBuffer();
    signal?.throwIfAborted(); return data;
  }
  async function read(pack, key) {
    const entry = pack?.index?.entries[key];
    if (!entry) return null;
    const compressed = await rangeBlob(pack, entry[0], entry[1]);
    return new Response(compressed.stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }
  // Parse one GeoJSON-like feature at a time. A BC cell can inflate to tens of
  // megabytes; never turn the entire decompressed map cell into a JS object.
  async function scanFeatures(stream, consume, check = () => {}) {
    const reader = stream.getReader(), decoder = new TextDecoder();
    let depth = 0, quoted = false, escaped = false, reading = false, closed = false, pieces = [], length = 0, chunks = 0;
    try {
      while (true) {
        check(); const {done, value} = await reader.read();
        const text = done ? decoder.decode() : decoder.decode(value, {stream:true});
        let start = reading ? 0 : -1;
        for (let i=0;i<text.length;i++) {
          const c=text[i];
          if (closed) {if (!/\s/.test(c)) throw Error('Invalid map data.'); continue;}
          if (!depth) {if (/\s/.test(c)) continue; if(c!=='[')throw Error('Invalid map data.');depth=1;continue;}
          if (!reading && depth===1) {
            if(c===']'){closed=true;depth=0;continue;}
            if(c===','||/\s/.test(c))continue;
            if(c!=='[')throw Error('Invalid map feature.');reading=true;start=i;
          }
          if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
          else if(c==='"')quoted=true;
          else if(c==='['||c==='{')depth++;
          else if(c===']'||c==='}')depth--;
          if(reading&&depth===1&&!quoted){
            pieces.push(text.slice(start,i+1));length+=i+1-start;
            if(length>2000000)throw Error('Map feature is too large.');
            check();if(consume(JSON.parse(pieces.join('')))===false)return;
            pieces=[];length=0;reading=false;start=-1;
          }
        }
        if(reading&&start>=0){pieces.push(text.slice(start));length+=text.length-start;if(length>2000000)throw Error('Map feature is too large.');}
        if(done)break;
        if(++chunks%16===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(!closed||reading||quoted)throw Error('Incomplete map data.');
    } finally {await reader.cancel().catch(()=>{});}
  }
  async function eachFeature(pack,key,consume,check) {
    const entry=pack.index.entries[key];if(!entry)return;
    const blob=await rangeBlob(pack,entry[0],entry[1]);
    return scanFeatures(blob.stream().pipeThrough(new DecompressionStream('gzip')),consume,check);
  }
  async function verify(packOrBlob, index, signal, progress = () => {}) {
    const pack = packOrBlob instanceof Blob ? {blob: packOrBlob} : packOrBlob;
    if (size(pack) !== index.bytes) throw Error('The download is incomplete. Please try again.');
    let checked = 0; const cache = new Map();
    for (const entry of Object.values(index.entries)) {
      signal?.throwIfAborted();
      const bytes = await (await rangeBlob(pack, entry[0], entry[1], cache)).arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== entry[2]) {
        if (pack.generation) await atomic(['chunks'], tx => {for(let i=Math.floor(entry[0]/pack.chunkSize);i<=Math.floor((entry[0]+entry[1]-1)/pack.chunkSize);i++)tx.objectStore('chunks').delete(pack.generation+'/'+i);});
        throw Error('The download failed its integrity check. Select Resume to retry the damaged section.');
      }
      checked += entry[1]; progress(checked / index.bytes);
    }
  }
  async function limitedBody(response, expected) {
    if (!response.body) throw Error('Download unavailable.');
    const reader = response.body.getReader(), bytes = new Uint8Array(expected); let offset = 0;
    try {while (true) {const {done, value} = await reader.read(); if (done) break; if (offset + value.byteLength > expected) throw Error('Unexpected download size.'); bytes.set(value, offset); offset += value.byteLength;}}
    finally {await reader.cancel().catch(() => {});}
    if (offset !== expected) throw Error('Connection interrupted. Select Resume to continue downloading.');
    return bytes.buffer;
  }
  async function install(meta, url, {signal, fetch: send = globalThis.fetch, progress = () => {}} = {}) {
    signal?.throwIfAborted();
    let stage = await get('download:' + meta.key, 'settings');
    const previous = await get(meta.key);
    if (!stage || stage.version !== meta.version || stage.bytes !== meta.index.bytes) {
      const obsolete = stage;
      stage = {...meta, bytes: meta.index.bytes, format: 'chunks-v1', chunkSize: CHUNK_SIZE, generation: crypto.randomUUID()};
      await atomic(['settings', 'chunks'], tx => {
        tx.objectStore('settings').put(stage, 'download:' + meta.key);
        if (obsolete?.generation && obsolete.generation !== previous?.generation) tx.objectStore('chunks').delete(prefix(obsolete.generation));
      });
    }
    const keys = new Set(await transaction('chunks', 'readonly', s => s.getAllKeys(prefix(stage.generation))));
    let received = 0;
    for (let i = 0; i < Math.ceil(stage.bytes / CHUNK_SIZE); i++) if (keys.has(stage.generation + '/' + i)) received += Math.min(CHUNK_SIZE, stage.bytes - i * CHUNK_SIZE);
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    // Safari can count deleted SQLite pages as usage even though new records
    // can reuse them. Let actual writes decide whether remaining space is full.
    if (estimate?.quota && estimate.quota < stage.bytes + CHUNK_SIZE) throw Error('This region exceeds the browser storage limit. Choose a smaller region.');
    progress(received / stage.bytes * .9, 'download');
    for (let i = 0; i < Math.ceil(stage.bytes / CHUNK_SIZE); i++) {
      signal?.throwIfAborted();
      const key = stage.generation + '/' + i, start = i * CHUNK_SIZE, end = Math.min(stage.bytes, start + CHUNK_SIZE) - 1;
      if (keys.has(key)) continue;
      const partial = stage.bytes > CHUNK_SIZE;
      const response = await send(url, {signal, cache: 'no-store', credentials: 'omit', headers: partial ? {Range: `bytes=${start}-${end}`} : {}});
      if (!response.ok) {await response.body?.cancel(); throw Error('Download unavailable. Select Resume to try again.');}
      if (partial && (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${start}-${end}/${stage.bytes}`)) {
        await response.body?.cancel(); throw Error('The download server needs an update. Refresh Maps and try again.');
      }
      const buffer = await limitedBody(response, end - start + 1);
      signal?.throwIfAborted(); await put(key, buffer, 'chunks');
      received += buffer.byteLength; progress(received / stage.bytes * .9, 'download');
      // Yield between writes so Safari can release temporary network buffers.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await verify(stage, stage.index, signal, f => progress(.9 + .1 * f, 'verify'));
    signal?.throwIfAborted();
    await atomic(['packages', 'settings', 'chunks'], tx => {
      const current = tx.objectStore('settings').get('download:' + meta.key);
      current.onsuccess = () => {
        if (current.result?.generation !== stage.generation) {tx.abort(); return;}
        tx.objectStore('packages').put({...stage, savedAt: Date.now()}, meta.key);
        tx.objectStore('settings').delete('download:' + meta.key);
        if (previous?.generation && previous.generation !== stage.generation) tx.objectStore('chunks').delete(prefix(previous.generation));
      };
    });
    return stage;
  }
  return {DB, CHUNK_SIZE, presets, inside, tile, catalog, get, put, remove, list, pending, cleanup, range, read, eachFeature, scanFeatures, verify, install, size};
});
