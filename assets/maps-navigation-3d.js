'use strict';
// Loaded cheaply with the page; GL JS and its styles load only on entering 3D.
window.GregleNavigation3D = ({onBrowse, onError, onStatus = () => {}}) => {
  const $ = id => document.getElementById(id), stage = document.querySelector('.map-stage');
  const container = $('navigation-map-3d'), core = window.GregleNavigation;
  let view = null, arrow = null, target = null, route = null, latest = null, heading = 0, generation = 0, follow = true;
  let loader, cancelLoad, recoveryTimer, contextLost = false, losses = 0, lastCamera = 0;
  const lightweight = /Tesla/i.test(navigator.userAgent);
  const pitch = lightweight ? 35 : 58;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function loadLibrary() {
    if (window.mapboxgl) return Promise.resolve();
    if (loader) return loader;
    loader = new Promise((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.css'; document.head.append(link);
      const script = document.createElement('script'); script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js';
      const timeout = setTimeout(() => { script.remove(); loader = null; reject(Error('Map download timed out')); }, 20000);
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); loader = null; script.remove(); reject(Error('Map download failed')); };
      document.head.append(script);
    });
    return loader;
  }
  function padding() {
    const bounds = stage.getBoundingClientRect(), card = $('navigation-live').getBoundingClientRect();
    return bounds.width > 700 ? {left: Math.min(card.width + 36, bounds.width * .45), right: 30, top: 40, bottom: 60} :
      {top: Math.min(card.height + 30, bounds.height * .54), bottom: 65, left: 20, right: 20};
  }
  function camera(animate = true) {
    if (!view || !latest || !follow || document.hidden || contextLost) return;
    const now = Date.now();
    if (lightweight && animate && now - lastCamera < 1000) return;
    lastCamera = now;
    const options = {center: [latest.lng, latest.lat], bearing: heading, pitch, zoom: lightweight ? (latest.speed > 22 ? 15.5 : 16) : (latest.speed > 22 ? 16 : 17), padding: padding()};
    // Avoid continuous render loops on the in-car GPU; GPS still updates the camera.
    if (lightweight || !animate || reduced()) view.jumpTo(options);
    else view.easeTo({...options, duration: 850, essential: false});
  }
  function lineData() {
    return {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: route.points.map(p => [p[1], p[0]])}};
  }
  function setRoute(value) {
    route = value;
    if (!view?.isStyleLoaded()) return;
    const source = view.getSource('navigation-route');
    if (source) source.setData(lineData());
    else {
      view.addSource('navigation-route', {type: 'geojson', data: lineData(), ...(lightweight ? {tolerance: .75, buffer:64, maxzoom:16} : {})});
      view.addLayer({id: 'navigation-route-casing', type: 'line', source: 'navigation-route', ...(lightweight ? {} : {slot: 'middle'}), layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': '#fff', 'line-width': 12, 'line-opacity': .9}});
      view.addLayer({id: 'navigation-route-line', type: 'line', source: 'navigation-route', ...(lightweight ? {} : {slot: 'middle'}), layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': '#7637cc', 'line-width': 7}});
    }
    target?.remove();
    target = new window.mapboxgl.Marker({color: '#7637cc'}).setLngLat(route.points.at(-1).slice().reverse()).addTo(view);
  }
  function update(point, coords = {}) {
    const previous = latest;
    latest = {...point, speed: Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null};
    if (Number.isFinite(coords.heading) && coords.heading >= 0 && coords.heading < 360 && (latest.speed === null || latest.speed > 1)) heading = coords.heading;
    else if (previous && core.meters(previous, point) > 8) {
      const rad = Math.PI / 180, delta = (point.lng - previous.lng) * rad;
      heading = (Math.atan2(Math.sin(delta) * Math.cos(point.lat * rad), Math.cos(previous.lat * rad) * Math.sin(point.lat * rad) - Math.sin(previous.lat * rad) * Math.cos(point.lat * rad) * Math.cos(delta)) / rad + 360) % 360;
    }
    arrow?.setLngLat([point.lng, point.lat]).setRotation(heading);
    camera();
    $('navigation-speed').hidden = latest.speed === null;
    $('navigation-speed-value').textContent = latest.speed === null ? '' : Math.round(latest.speed * 3.6);
  }
  function clearGuidance() {
    $('navigation-lanes').hidden = true; $('navigation-speed-limit').hidden = true; $('navigation-speed').hidden = true;
  }
  function guidance(result) {
    clearGuidance();
    if (!result || result.arrived || result.away > 65) return;
    $('navigation-speed').hidden = latest?.speed == null;
    const limit = route?.speedLimits?.[result.index];
    if (limit) {
      $('navigation-speed-limit').hidden = false;
      $('navigation-limit-value').textContent = limit.speed;
      $('navigation-limit-unit').textContent = limit.unit;
    }
    const junction = route?.laneGuidance?.find(item => item.at > result.along + 8 && item.at - result.along <= 800);
    if (!junction) return;
    const host = $('navigation-lane-arrows'); host.replaceChildren();
    const hasActive = junction.lanes.some(lane => lane.active && lane.valid);
    const symbols = {'left': '←', 'slight left': '↖', 'sharp left': '↰', straight: '↑', right: '→', 'slight right': '↗', 'sharp right': '↱', uturn: '↶'};
    junction.lanes.forEach((lane, index) => {
      const recommended = hasActive ? lane.active && lane.valid : lane.valid;
      const item = document.createElement('span'); item.className = 'navigation-lane' + (recommended ? ' recommended' : '');
      item.setAttribute('role', 'img'); item.setAttribute('aria-label', `Lane ${index + 1}: ${lane.indications.join(' or ')}${recommended ? ', recommended' : ''}`);
      for (const direction of lane.indications) {
        const arrow = document.createElement('span'); arrow.textContent = symbols[direction]; arrow.setAttribute('aria-hidden', 'true');
        if (recommended && (!lane.preferred || lane.preferred === direction)) arrow.className = 'lane-chosen';
        item.append(arrow);
      }
      host.append(item);
    });
    $('navigation-lane-distance').textContent = `Lanes in ${core.distance(junction.at - result.along)}`;
    $('navigation-lanes').hidden = false;
  }
  async function enter(value) {
    const token = ++generation;
    await loadLibrary();
    if (token !== generation) return false;
    if (!window.mapboxgl.supported()) throw Error('3D maps are unavailable in this browser');
    const response = await fetch(window.GregleMapRouting.mapboxEndpoint + '/config', {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw Error('3D map configuration unavailable');
    const config = await response.json();
    if (token !== generation) return false;
    if (typeof config.publicToken !== 'string' || !config.publicToken.startsWith('pk.')) throw Error('3D map configuration unavailable');
    contextLost = false; losses = 0; lastCamera = 0;
    route = value; latest = null; heading = 0; follow = true;
    const first = route.points[0], next = route.points.find(p => core.meters({lat: first[0], lng: first[1]}, {lat: p[0], lng: p[1]}) > 10);
    latest = {lat: first[0], lng: first[1]};
    if (next) {
      const rad = Math.PI / 180, delta = (next[1] - first[1]) * rad;
      heading = (Math.atan2(Math.sin(delta) * Math.cos(next[0] * rad), Math.cos(first[0] * rad) * Math.sin(next[0] * rad) - Math.sin(first[0] * rad) * Math.cos(next[0] * rad) * Math.cos(delta)) / rad + 360) % 360;
    }
    if (lightweight) { window.mapboxgl.workerCount = 1; window.mapboxgl.maxParallelImageRequests = 4; }
    container.hidden = false;
    view = new window.mapboxgl.Map({container, accessToken: config.publicToken, style: lightweight ? (document.documentElement.classList.contains('dark-mode') ? 'mapbox://styles/mapbox/navigation-night-v1' : 'mapbox://styles/mapbox/navigation-day-v1') : 'mapbox://styles/mapbox/standard',
      ...(lightweight ? {maxTileCacheSize: 16, maxPitch: 40, maxZoom: 17, renderWorldCopies: false, projection: 'mercator', failIfMajorPerformanceCaveat: true} : {config: {basemap: {lightPreset: document.documentElement.classList.contains('dark-mode') ? 'night' : 'day', show3dObjects: true}}}),
      center: [first[1], first[0]], zoom: lightweight ? 16 : 16.5, pitch, bearing: heading, attributionControl: true, logoPosition: 'bottom-left',
      cooperativeGestures: false, antialias: false, fadeDuration: lightweight || reduced() ? 0 : 150});
    stage.classList.add('navigation-3d'); $('gregle-map').inert = true;
    const currentView = view; let ready = false;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cancelLoad = null; reject(Error('3D map timed out')); }, 20000);
      cancelLoad = () => { clearTimeout(timeout); cancelLoad = null; resolve(); };
      currentView.once('load', () => { ready = true; clearTimeout(timeout); cancelLoad = null; resolve(); });
      currentView.on('error', () => {
        if (token !== generation) return;
        // GL error events include recoverable tile/network failures. Keep guidance
        // running and let GL retry; the startup timeout still bounds a failed load.
        if (ready && !contextLost) onStatus('Some 3D map data is unavailable. Navigation is continuing.');
      });
      currentView.on('webglcontextlost', event => {
        if (token !== generation) return;
        event?.originalEvent?.preventDefault?.();
        contextLost = true;
        if (!ready) { clearTimeout(timeout); cancelLoad = null; reject(Error('3D graphics context lost')); return; }
        clearTimeout(recoveryTimer);
        if (++losses > 2) { onError('3D graphics repeatedly reset. Continuing navigation in 2D.'); return; }
        onStatus('3D graphics paused. Waiting for the browser to restore them…');
        recoveryTimer = setTimeout(() => {
          if (token === generation && contextLost) onError('3D graphics did not recover. Continuing navigation in 2D.');
        }, 12000);
      });
      currentView.on('webglcontextrestored', () => {
        if (token !== generation || !ready) return;
        clearTimeout(recoveryTimer); contextLost = false;
        currentView.resize(); camera(false);
        onStatus('3D graphics restored. Navigation is continuing.');
      });
    });
    if (token !== generation) return false;
    if (lightweight) {
      for (const layer of view.getStyle?.()?.layers || []) {
        if (layer.type === 'fill-extrusion' || /poi|transit.*label/i.test(layer.id)) view.setLayoutProperty(layer.id,'visibility','none');
      }
    }
    window.dispatchEvent?.(new CustomEvent('gregle-navigation-3d',{detail:true}));
    setRoute(route);
    view.addControl(new window.mapboxgl.NavigationControl({showCompass: true, visualizePitch: true}), 'bottom-right');
    const element = document.createElement('div'); element.className = 'navigation-position navigation-3d-position'; element.innerHTML = '<span aria-hidden="true">▲</span>';
    arrow = new window.mapboxgl.Marker({element, rotationAlignment: 'map', pitchAlignment: 'map'}).setLngLat([first[1], first[0]]).addTo(view);
    view.on('dragstart', () => { follow = false; onBrowse(); });
    view.on('zoomstart', event => { if (event.originalEvent) { follow = false; onBrowse(); } });
    camera(false);
    return true;
  }
  function exit() {
    generation++; clearTimeout(recoveryTimer); contextLost = false; cancelLoad?.(); view?.remove(); view = arrow = target = null; latest = null;
    container.hidden = true; stage.classList.remove('navigation-3d'); $('gregle-map').inert = false;
    clearGuidance();
    window.dispatchEvent?.(new CustomEvent('gregle-navigation-3d',{detail:false}));
  }
  let lastWidth = 0, lastHeight = 0;
  const resize = () => {
    if (!view) return;
    const {width, height} = stage.getBoundingClientRect();
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width; lastHeight = height; view.resize(); camera(false);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) camera(false); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize);
  return {enter, exit, setRoute, update, guidance, clearGuidance, setFollow(value) { follow = value; camera(false); }, get active() { return !!view; }};
};
