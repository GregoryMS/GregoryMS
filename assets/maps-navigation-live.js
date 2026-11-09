'use strict';
window.GregleLiveNavigation = ({ map, routing, onRoute, onStop }) => {
  const $ = id => document.getElementById(id), core = window.GregleNavigation;
  const stage = document.querySelector('.map-stage'), card = $('navigation-live');
  let running = false, session = 0, watch = null, timer, route, mode, destination, lastFix = 0;
  let previous = null, marker, halo, follow = true, voice = false, spoken = '', controller, lastReroute = 0, offSince = 0, firstFix = true, ended = false;
  let trafficChangePending = false, lastTrafficAttempt = 0, updatingTraffic = false;
  let ownsFullscreen = false;
  function enterFullscreen() {
    document.body?.classList.add('navigation-fullscreen');
    // iPhone Safari can use the viewport layout even without element fullscreen.
    if (document.fullscreenElement || !document.fullscreenEnabled || !stage.requestFullscreen) return;
    try {
      Promise.resolve(stage.requestFullscreen()).then(() => {
        if (document.fullscreenElement !== stage) return;
        if (running || ended) ownsFullscreen = true;
        else return document.exitFullscreen();
      }).catch(() => {});
    } catch {}
  }
  const liveStatus = text => { $('navigation-status').textContent = text; };
  let wants3D = false, switchVersion = 0, lastCoords = null;
  const threeD = window.GregleNavigation3D?.({onBrowse: () => setFollow(false), onError: () => {
    disable3D(); liveStatus('3D map unavailable. Continuing navigation in 2D.');
  }});
  function disable3D() {
    switchVersion++; wants3D = false; threeD?.exit(); routing.setMapbox?.(false);
    $('navigation-3d').textContent = '3D mode'; $('navigation-3d').setAttribute('aria-pressed', 'false');
    if (route) trafficUI();
  }
  async function toggle3D() {
    if (!running || mode !== 'driving' || !threeD) return;
    if (wants3D) { disable3D(); return; }
    wants3D = true; const token = ++switchVersion, currentSession = session;
    $('navigation-3d').textContent = 'Cancel 3D'; liveStatus('Loading 3D navigation…');
    try {
      if (!await threeD.enter(route) || token !== switchVersion || currentSession !== session || !running) return;
      routing.setMapbox(true); $('navigation-3d').textContent = '2D mode'; $('navigation-3d').setAttribute('aria-pressed', 'true');
      trafficUI();
      setFollow(true);
      if (marker && lastCoords && Date.now() - lastFix < 15000) threeD.update(marker.getLatLng(), lastCoords);
      controller?.abort(); controller = null;
      const point = marker?.getLatLng() || {lat: route.points[0][0], lng: route.points[0][1]};
      await reroute(point, true);
    } catch {
      if (token !== switchVersion || currentSession !== session) return;
      disable3D(); liveStatus('3D could not load. Continuing navigation in 2D; try 3D mode again.');
    }
  }
  $('navigation-3d')?.addEventListener('click', toggle3D);
  function trafficUI() {
    $('navigation-traffic-row').hidden = mode !== 'driving' || ended;
    $('navigation-traffic').setAttribute('aria-checked', String(routing.enabled));
    $('navigation-traffic').disabled = !routing.connected;
    $('navigation-traffic-note').textContent = updatingTraffic ? 'Updating your route…' : trafficChangePending ? 'Waiting for GPS to update your route.' :
      route?.traffic && Date.now() - route.fetchedAt > 180000 ? 'Traffic estimate is over three minutes old. Waiting for an update.' : window.GregleMapRouting.note(route, mode);
  }
  function say(text) {
    if (!voice || !window.speechSynthesis || !window.SpeechSynthesisUtterance || document.hidden) return;
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text); utterance.lang = 'en';
    window.speechSynthesis.speak(utterance);
  }
  function cleanup() {
    document.body?.classList.remove('navigation-fullscreen');
    if (ownsFullscreen && document.fullscreenElement === stage) {
      try { Promise.resolve(document.exitFullscreen()).catch(() => {}); } catch {}
    }
    ownsFullscreen = false;
    disable3D(); lastCoords = null;
    session++; running = false; ended = false; trafficChangePending = false; updatingTraffic = false;
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null; clearInterval(timer); controller?.abort(); controller = null;
    window.speechSynthesis?.cancel();
    if (marker) map.removeLayer(marker); if (halo) map.removeLayer(halo); marker = halo = null;
  }
  function stop(message) {
    cleanup(); card.hidden = true; stage.classList.remove('navigating');
    onStop(message || 'Navigation stopped. Your route is still available.');
  }
  function setFollow(value) {
    follow = value; $('navigation-follow').setAttribute('aria-pressed', String(value));
    $('navigation-follow').textContent = value ? 'Following' : 'Recenter';
    threeD?.setFollow(value);
  }
  map.on('dragstart', () => { if (running) setFollow(false); });
  $('navigation-follow').addEventListener('click', () => { setFollow(true); if (marker) map.panTo(marker.getLatLng(), { animate: false }); });
  $('navigation-stop').addEventListener('click', () => stop());
  $('navigation-voice').hidden = !window.speechSynthesis || !window.SpeechSynthesisUtterance;
  $('navigation-voice').addEventListener('click', () => {
    voice = !voice; $('navigation-voice').setAttribute('aria-pressed', String(voice));
    $('navigation-voice').textContent = voice ? 'Voice on' : 'Voice off';
    if (voice) say($('navigation-instruction').textContent); else window.speechSynthesis?.cancel();
  });
  function guidance(point) {
    const result = core.progress(route, point, previous, mode);
    if (!result) return;
    const threshold = mode === 'walking' ? 40 : 65;
    if (result.away > threshold) {
      threeD?.clearGuidance();
      if (!offSince) offSince = Date.now();
      $('navigation-instruction').textContent = 'Checking your route…'; $('navigation-distance').textContent = 'Off route';
      liveStatus('Waiting for a consistent location before rerouting.');
      if (Date.now() - offSince >= 3000 && !controller) reroute(point);
      return;
    }
    offSince = 0; previous = result;
    if (threeD?.active) threeD.guidance(result);
    $('navigation-distance').textContent = result.arrived ? 'Arrived' : `In ${core.distance(result.turnDistance)}`;
    $('navigation-instruction').textContent = result.arrived ? 'You have arrived' : result.next?.text || 'Continue to your destination';
    $('navigation-remaining').textContent = `${core.distance(result.remaining)} · ${core.duration(result.seconds)} left`;
    $('navigation-eta').textContent = `Arrive ${new Date(Date.now() + result.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const modifier = result.next?.modifier || '';
    $('navigation-arrow').textContent = result.arrived ? '✓' : /uturn/.test(modifier) ? '↶' : /left/.test(modifier) ? '↰' : /right/.test(modifier) ? '↱' : '↑';
    liveStatus(mode === 'walking' ? 'Walking · Live location' : 'Driving · Live location');
    const prompt = result.arrived ? 'You have arrived at your destination.' : `${result.next?.start}:${result.turnDistance < 50 ? 'now' : result.turnDistance < 250 ? 'soon' : 'ahead'}`;
    if (prompt !== spoken) { spoken = prompt; say(result.arrived ? prompt : `In ${core.distance(result.turnDistance)}, ${result.next?.text || 'continue'}`); }
    if (result.arrived) {
      ended = true; running = false; controller?.abort(); controller = null;
      if (watch !== null) navigator.geolocation.clearWatch(watch); watch = null; clearInterval(timer);
      $('navigation-stop').textContent = 'Done';
      trafficUI();
    }
  }
  async function reroute(point, initial = false, trafficRefresh = false) {
    if (controller || (!initial && Date.now() - lastReroute < 20000)) return;
    lastReroute = Date.now(); lastTrafficAttempt = Date.now(); const token = session;
    const current = new AbortController(); controller = current;
    updatingTraffic = trafficRefresh;
    if (trafficRefresh) trafficUI();
    const timeout = setTimeout(() => current.abort(), 15000);
    liveStatus(trafficRefresh ? 'Updating your route for traffic…' : 'Recalculating from your location…');
    try {
      const updated = await routing.request(point, destination, mode, { signal: current.signal });
      if (!running || token !== session || controller !== current) return;
      route = updated; previous = null; offSince = 0; spoken = ''; trafficChangePending = false; updatingTraffic = false;
      if (threeD?.active) threeD.setRoute(route);
      onRoute(route, point, destination, false);
      trafficUI();
      // A newer GPS fix may have arrived during the request.
      const currentPoint = marker?.getLatLng() || point;
      if (Date.now() - lastFix < 15000) guidance(currentPoint);
    } catch (error) {
      if (token === session && running && controller === current) {
        if (trafficRefresh) {
          trafficChangePending = false;
          $('navigation-traffic-note').textContent = 'Route update unavailable. The previous route is still displayed; try again.';
          liveStatus('Could not refresh traffic. Following the previous route.');
        } else {
          liveStatus('Could not update the route. Retrying when location is available.');
          $('navigation-instruction').textContent = 'Route update unavailable'; $('navigation-distance').textContent = 'Check route';
        }
      }
    } finally { clearTimeout(timeout); if (controller === current) { controller = null; updatingTraffic = false; } }
  }
  function position(position, token) {
    if (!running || token !== session) return;
    const point = { lat: position.coords.latitude, lng: position.coords.longitude };
    if (!core.valid(point) || (position.timestamp && Date.now() - position.timestamp > 15000)) return;
    const accuracy = position.coords.accuracy;
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > (mode === 'walking' ? 60 : 100)) {
      threeD?.clearGuidance();
      liveStatus('GPS accuracy is low. Waiting for a clearer location.');
      $('navigation-distance').textContent = 'Weak GPS'; $('navigation-instruction').textContent = 'Waiting for an accurate location'; return;
    }
    lastFix = Date.now();
    lastCoords = position.coords;
    if (threeD?.active) threeD.update(point, position.coords);
    if (!marker) {
      const icon = L.divIcon({ className: 'navigation-position', html: '<span aria-hidden="true">▲</span>', iconSize: [36, 36], iconAnchor: [18, 18] });
      marker = L.marker([point.lat, point.lng], { icon, title: 'Your live location', alt: 'Your live location', zIndexOffset: 1000 }).addTo(map);
      halo = L.circle([point.lat, point.lng], { radius: accuracy, color: '#2476e8', weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
    } else { marker.setLatLng([point.lat, point.lng]); halo.setLatLng([point.lat, point.lng]); halo.setRadius(accuracy); }
    const heading = position.coords.heading;
    const arrow = marker.getElement?.()?.firstElementChild;
    if (arrow) arrow.style.transform = `rotate(${Number.isFinite(heading) ? heading : 0}deg)`;
    if (follow && !threeD?.active) {
      // Padding keeps the location out from underneath the guidance card, including half-screen views.
      const height = card.getBoundingClientRect().height, size = map.getSize();
      const location = map.project([point.lat, point.lng], mode === 'walking' ? 17 : 16);
      location.y -= Math.min(height / 2, size.y / 4);
      map.setView(map.unproject(location, mode === 'walking' ? 17 : 16), mode === 'walking' ? 17 : 16, { animate: false });
    }
    if (trafficChangePending && !controller) { firstFix = false; reroute(point, true, true); return; }
    if (firstFix) {
      firstFix = false;
      if (route.traffic && routing.enabled && Date.now() - route.fetchedAt >= 120000) { reroute(point, true, true); return; }
      const start = route.points[0];
      if (core.meters(point, { lat: start[0], lng: start[1] }) > 35) { reroute(point, true); return; }
    }
    if (!controller || updatingTraffic) guidance(point);
  }
  function start(nextRoute, nextMode, to, {threeD: start3D = false} = {}) {
    if (!navigator.geolocation?.watchPosition) { onStop('Live location is unavailable in this browser. You can still use the route steps.'); return; }
    cleanup(); route = nextRoute; mode = nextMode; destination = { ...to }; previous = null; offSince = 0; lastReroute = 0; firstFix = true; lastFix = 0; spoken = ''; lastTrafficAttempt = Date.now();
    running = true; const token = session; setFollow(true); card.hidden = false;
    stage.classList.add('navigating'); $('navigation-stop').textContent = 'Stop';
    enterFullscreen();
    $('navigation-distance').textContent = 'Starting'; $('navigation-instruction').textContent = 'Finding your location…';
    $('navigation-remaining').textContent = `${core.distance(route.distance)} · ${core.duration(route.duration)}`;
    $('navigation-eta').textContent = ''; $('navigation-arrow').textContent = '↑'; liveStatus('Allow location access to start live guidance.');
    trafficUI();
    $('navigation-3d').hidden = mode !== 'driving' || !threeD;
    if (start3D) toggle3D();
    timer = setInterval(() => {
      if (running && mode === 'driving' && routing.enabled && routing.connected && !document.hidden && lastFix && Date.now() - lastFix < 15000 && !controller && Date.now() - lastTrafficAttempt >= 120000) reroute(marker.getLatLng(), true, true);
      if (running && route?.traffic && Date.now() - route.fetchedAt > 180000) trafficUI();
      if (running && (!lastFix || Date.now() - lastFix > 15000)) {
        threeD?.clearGuidance();
        liveStatus(document.hidden ? 'Location may pause while the browser is in the background.' : 'GPS signal lost. Guidance resumes with a fresh location.');
        $('navigation-distance').textContent = 'Waiting for GPS'; $('navigation-instruction').textContent = 'Waiting for your location';
        $('navigation-eta').textContent = ''; window.speechSynthesis?.cancel();
      }
    }, 3000);
    try {
      watch = navigator.geolocation.watchPosition(p => position(p, token), error => {
        if (token !== session || !running) return;
        if (error.code === 1) stop('Location access was denied. Allow location for maps.gregle.uk in your browser’s website settings, then tap Start navigation again. On iPhone, also check that Location Services is enabled for Safari Websites.');
        else { threeD?.clearGuidance(); liveStatus('Location is unavailable. Waiting for GPS to recover.'); $('navigation-distance').textContent = 'Waiting for GPS'; $('navigation-instruction').textContent = 'Waiting for your location'; }
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    } catch { stop('Live location could not start. Check this site’s location permission.'); }
  }
  function refreshTraffic() {
    if (!running || mode !== 'driving') return;
    controller?.abort(); controller = null; updatingTraffic = false;
    trafficChangePending = true; trafficUI();
    if (marker && lastFix && Date.now() - lastFix < 15000) return reroute(marker.getLatLng(), true, true);
  }
  window.addEventListener('pagehide', () => { if (running || ended) stop(); });
  return { start, stop, refreshTraffic, get active() { return running || ended; } };
};
