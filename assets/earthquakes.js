(() => {
  'use strict';
  const core = window.GregleEarthquakes;
  const $ = id => document.getElementById(id);
  const date = value => new Date(value).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' });
  const relative = value => { const min = Math.max(0, Math.floor((Date.now() - value) / 60000)); return min < 1 ? 'Just now' : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.floor(min / 60)} hr ago` : `${Math.floor(min / 1440)} days ago`; };
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  const state = { events:[], period:'day', selected:null, quakeChecked:null, generated:null, tsunamiChecked:null, tsunami:null, quakeError:false, tsunamiError:false };
  let map, quakeLayer, tsunamiLayer, tiles, controller, quakeRequest = 0, tsunamiPending = false;
  const markers = new Map(), tsunamiCache = new Map();
  const colours = magnitude => magnitude >= 6 ? '#b94c3e' : magnitude >= 4.5 ? '#b38128' : '#6288a1';

  function initialiseMap() {
    if (!window.L) { $('map-message').hidden = false; $('map-message').textContent = 'The map could not load. Earthquake details remain available in the list and on USGS.'; $('coast-view').disabled = true; $('world-view').disabled = true; return; }
    map = L.map('quake-map', { scrollWheelZoom:false, worldCopyJump:true, minZoom:2 }).setView([46,-129],4);
    quakeLayer = L.layerGroup().addTo(map); tsunamiLayer = L.layerGroup().addTo(map);
    function mapTheme() {
      if (tiles) map.removeLayer(tiles);
      tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom:19
      }).addTo(map);
      let loaded = 0;
      tiles.on('tileload', () => { loaded++; $('map-message').hidden = true; });
      tiles.on('tileerror', () => { if (!loaded) { $('map-message').hidden = false; $('map-message').textContent = 'Map background unavailable. You can still use the earthquake list.'; } });
    }
    mapTheme();
    $('coast-view').addEventListener('click', () => map.setView([46,-129],4));
    $('world-view').addEventListener('click', () => map.setView([18,0],2));
  }
  function quakeDetails(event) {
    const box = el('div'); box.append(el('strong', `M${event.magnitude.toFixed(1)} · ${event.place}`), el('p', `${date(event.time)} · ${event.depth === null ? 'Depth not reported' : `${event.depth.toFixed(1)} km deep`}`));
    const link = el('a','View on USGS ↗'); link.href = event.url; box.append(link); return box;
  }
  function selectEvent(event) {
    state.selected = event.id;
    $('event-list').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.id === event.id)));
    if (map) { map.setView([event.latitude,event.longitude],Math.max(5,map.getZoom())); markers.get(event.id)?.openPopup(); }
    else window.location.assign(event.url);
  }
  function renderEarthquakes() {
    const events = core.filterEarthquakes(state.events,Number($('magnitude').value),state.period);
    quakeLayer?.clearLayers(); markers.clear();
    if (map) for (const event of events) {
      const marker = L.circleMarker([event.latitude,event.longitude], { radius:Math.max(5,event.magnitude * 2), color:colours(event.magnitude), fillColor:colours(event.magnitude), fillOpacity:.55, weight:1.5 }).bindPopup(quakeDetails(event)).addTo(quakeLayer);
      marker.on('click', () => { state.selected = event.id; $('event-list').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.id === event.id))); });
      markers.set(event.id,marker);
    }
    const list = events.map(event => {
      const item = el('li'), button = el('button',undefined,'event-button'); button.type = 'button'; button.dataset.id = event.id;
      button.setAttribute('aria-pressed',String(state.selected === event.id));
      button.setAttribute('aria-label',`Magnitude ${event.magnitude.toFixed(1)}, ${event.place}, ${date(event.time)}. ${map ? 'Show on map' : 'Open USGS details'}`);
      const text = el('span'); text.append(el('span',event.place,'event-place'),el('span',`${relative(event.time)} · ${event.depth === null ? 'Depth unknown' : `${Math.round(event.depth)} km deep`}`,'meta'));
      button.append(el('span',event.magnitude.toFixed(1),'event-mag'),text); button.addEventListener('click',() => selectEvent(event)); item.append(button); return item;
    });
    $('event-list').replaceChildren(...list);
    if (!list.length) $('event-list').append(el('li',state.quakeChecked ? 'No earthquakes match these filters.' : state.quakeError ? 'Earthquake data is unavailable. Try Refresh or open USGS.' : 'Loading earthquake reports…','event-empty'));
    $('event-count').textContent = `${events.length} worldwide · ${state.period === 'day' ? 'past 24 hours' : 'past 7 days'}`;
    const latest = core.filterEarthquakes(state.events,2.5,'day')[0];
    if (latest) {
      const reading = el('div',undefined,'latest-reading'), text = el('div');
      text.append(el('span',latest.place,'latest-place'),el('span',`${date(latest.time)} · ${relative(latest.time)}`,'meta'));
      reading.append(el('span',`M${latest.magnitude.toFixed(1)}`,'magnitude'),text); $('latest-content').replaceChildren(reading); $('latest-link').href = latest.url;
    } else { $('latest-content').textContent = state.quakeChecked ? 'No M2.5+ earthquakes reported in the past 24 hours.' : state.quakeError ? 'Recent earthquake data is unavailable.' : 'Checking USGS…'; $('latest-link').href = 'https://earthquake.usgs.gov/earthquakes/map/'; }
    renderFreshness();
  }
  function renderTsunamis() {
    const data = state.tsunami; tsunamiLayer?.clearLayers(); $('tsunami-alerts').replaceChildren();
    if (data) for (const bulletin of data.active) {
      const card = el('article',undefined,'alert-card'), heading = el('h3',`Tsunami ${bulletin.kind.toLowerCase()}`,'alert-kind');
      card.append(heading,el('p',`Source earthquake: ${bulletin.place}`),el('p',`Bulletin issued ${date(bulletin.issued)}`,'meta'));
      for (const area of bulletin.areas) card.append(el('p',area));
      for (const instruction of bulletin.instructions) card.append(el('p',instruction));
      const links = el('div',undefined,'alert-links');
      for (const b of bulletin.links) { const link = el('a',`${b.label} bulletin ↗`); link.href = b.url; links.append(link); }
      if (!bulletin.links.length) { const link = el('a','Read official affected areas and instructions ↗'); link.href = 'https://www.tsunami.gov/'; links.append(link); }
      card.append(links); $('tsunami-alerts').append(card);
      if (map && bulletin.latitude !== null && bulletin.longitude !== null) {
        const popup = el('div'); popup.append(el('strong',`Tsunami ${bulletin.kind.toLowerCase()}`),el('p',`Source earthquake: ${bulletin.place}`));
        const link = el('a','Official bulletin ↗'); link.href = bulletin.links[0]?.url || 'https://www.tsunami.gov/'; popup.append(link);
        L.marker([bulletin.latitude,bulletin.longitude], { icon:L.divIcon({ className:'tsunami-marker', html:'◆', iconSize:[28,28], iconAnchor:[14,14] }), title:`Tsunami ${bulletin.kind}: source earthquake`, keyboard:true }).bindPopup(popup).addTo(tsunamiLayer);
      }
    }
    renderFreshness();
  }
  function renderFreshness() {
    const quakeFresh = core.fresh(state.quakeChecked) && core.fresh(state.generated) && !state.quakeError;
    $('latest-heading').textContent = `Most recent earthquake · worldwide M2.5+${state.quakeChecked && !quakeFresh ? ' · updates delayed' : ''}`;
    $('quake-status').textContent = state.quakeChecked ? `${quakeFresh ? 'USGS updated' : 'Earthquake updates unavailable or delayed — showing last received reports'} · feed generated ${date(state.generated)} · last checked ${date(state.quakeChecked)}` : state.quakeError ? 'Could not load USGS. Try Refresh or open the USGS link above.' : 'Loading earthquakes…';
    const tsunamiFresh = core.fresh(state.tsunamiChecked) && !state.tsunamiError;
    const active = state.tsunami?.active || [];
    $('tsunami-panel').dataset.state = !tsunamiFresh ? 'unknown' : active.length ? 'active' : 'quiet';
    $('tsunami-status').textContent = !tsunamiFresh ? (state.tsunamiChecked || state.tsunamiError ? 'Current tsunami status cannot be confirmed. Check NOAA for the latest warnings.' : 'Checking warning, advisory, watch and threat bulletins…') : active.length ? `${active.length} tsunami ${active.length === 1 ? 'bulletin requires' : 'bulletins require'} attention. Read the official bulletins for affected coasts and instructions.` : 'No tsunami warning, advisory, watch or threat listed by NOAA.';
    if (!tsunamiFresh && active.length) $('tsunami-status').textContent += ' Previously received bulletins remain below; their status may have changed.';
    $('tsunami-checked').textContent = state.tsunamiChecked ? `Last checked ${date(state.tsunamiChecked)} · Canada, U.S. & international bulletins` : 'Canada, U.S. and international NOAA bulletins';
  }
  async function loadEarthquakes() {
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal, id = ++quakeRequest, period = $('period').value;
    $('quake-status').textContent = 'Checking USGS…';
    const controllerForRequest = controller;
    const timeout = setTimeout(() => controllerForRequest.abort(),15000);
    try {
      const response = await fetch(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_${period}.geojson`,{ signal, cache:'no-cache' });
      if (!response.ok) throw new Error('USGS unavailable');
      const data = await response.json(), events = core.earthquakes(data);
      if (id !== quakeRequest) return;
      state.events = events; state.period = period; state.generated = data.metadata.generated; state.quakeChecked = Date.now(); state.quakeError = false;
      renderEarthquakes();
    } catch (_) {
      if (id !== quakeRequest) return;
      state.quakeError = true; $('period').value = state.period; renderEarthquakes();
    } finally { clearTimeout(timeout); }
  }
  function tsunamiRequest(product) {
    // NOAA's .js products are browser-loadable. Its PHP JSONP endpoint sends
    // text/html with nosniff, so it cannot be used as a cross-origin script.
    return new Promise((resolve,reject) => {
      const script = document.createElement('script');
      let done = false;
      function finish(error,data) {
        if (done) return; done = true; clearTimeout(timeout); script.remove();
        if (error) reject(error); else resolve(data);
      }
      const timeout = setTimeout(() => finish(new Error('NOAA timeout')),15000);
      window[product] = undefined;
      script.onload = () => {
        try { finish(null,core.tsunamiBulletin(window[product],product)); }
        catch (error) { finish(error); }
      };
      script.onerror = () => finish(new Error('NOAA unavailable'));
      script.src = `https://www.tsunami.gov/events/js/${product}.js?_=${Date.now()}`;
      document.head.append(script);
    });
  }
  async function loadTsunamis() {
    if (tsunamiPending) return; tsunamiPending = true;
    try {
      const results = await Promise.allSettled(core.tsunamiProducts.map(async product => {
        const bulletin = await tsunamiRequest(product); tsunamiCache.set(product,bulletin);
      }));
      state.tsunamiError = results.some(result => result.status === 'rejected');
      state.tsunami = { active:[...tsunamiCache.values()].filter(b => b.kind).sort((a,b) => b.issued - a.issued) };
      if (!state.tsunamiError) state.tsunamiChecked = Date.now();
    } finally { tsunamiPending = false; renderTsunamis(); }
  }
  async function refresh() {
    $('refresh').disabled = true; $('refresh').textContent = 'Refreshing…';
    await Promise.allSettled([loadEarthquakes(),loadTsunamis()]);
    $('refresh').disabled = false; $('refresh').textContent = '↻ Refresh';
  }
  $('refresh').addEventListener('click',refresh);
  $('period').addEventListener('change',loadEarthquakes);
  $('magnitude').addEventListener('change',renderEarthquakes);
  initialiseMap(); refresh();
  setInterval(() => { renderFreshness(); if (!document.hidden) refresh(); },60000);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) { renderFreshness(); refresh(); } });
})();
