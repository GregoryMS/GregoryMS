'use strict';
window.GregleLiveNavigation = ({ map, onRoute, onStop }) => {
  const $ = id => document.getElementById(id), core = window.GregleNavigation;
  const stage = document.querySelector('.map-stage'), card = $('navigation-live');
  let running = false, session = 0, watch = null, timer, route, mode, destination, lastFix = 0;
  let previous = null, marker, halo, follow = true, voice = false, spoken = '', controller, lastReroute = 0, offSince = 0, firstFix = true, ended = false;
  const liveStatus = text => { $('navigation-status').textContent = text; };
  function say(text) {
    if (!voice || !window.speechSynthesis || !window.SpeechSynthesisUtterance || document.hidden) return;
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text); utterance.lang = 'en';
    window.speechSynthesis.speak(utterance);
  }
  function cleanup() {
    session++; running = false; ended = false;
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
      if (!offSince) offSince = Date.now();
      $('navigation-instruction').textContent = 'Checking your route…'; $('navigation-distance').textContent = 'Off route';
      liveStatus('Waiting for a consistent location before rerouting.');
      if (Date.now() - offSince >= 3000 && !controller) reroute(point);
      return;
    }
    offSince = 0; previous = result;
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
    }
  }
  async function reroute(point, initial = false) {
    if (controller || (!initial && Date.now() - lastReroute < 20000)) return;
    lastReroute = Date.now(); const token = session;
    const current = new AbortController(); controller = current;
    const timeout = setTimeout(() => current.abort(), 15000);
    liveStatus('Recalculating from your location…');
    try {
      const response = await fetch(core.routeURL(point, destination, mode), { signal: current.signal });
      const data = await response.json();
      if (!running || token !== session) return;
      if (!response.ok) throw new Error('Routing is unavailable.');
      route = core.readRoute(data, mode); previous = null; offSince = 0; spoken = '';
      onRoute(route, point, destination, false);
      // A newer GPS fix may have arrived during the request.
      const currentPoint = marker?.getLatLng() || point;
      if (Date.now() - lastFix < 15000) guidance(currentPoint);
    } catch (error) {
      if (token === session && running) {
        liveStatus('Could not update the route. Retrying when location is available.');
        $('navigation-instruction').textContent = 'Route update unavailable'; $('navigation-distance').textContent = 'Check route';
      }
    } finally { clearTimeout(timeout); if (controller === current) controller = null; }
  }
  function position(position, token) {
    if (!running || token !== session) return;
    const point = { lat: position.coords.latitude, lng: position.coords.longitude };
    if (!core.valid(point) || (position.timestamp && Date.now() - position.timestamp > 15000)) return;
    const accuracy = position.coords.accuracy;
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > (mode === 'walking' ? 60 : 100)) {
      liveStatus('GPS accuracy is low. Waiting for a clearer location.');
      $('navigation-distance').textContent = 'Weak GPS'; $('navigation-instruction').textContent = 'Waiting for an accurate location'; return;
    }
    lastFix = Date.now();
    if (!marker) {
      const icon = L.divIcon({ className: 'navigation-position', html: '<span aria-hidden="true">▲</span>', iconSize: [36, 36], iconAnchor: [18, 18] });
      marker = L.marker([point.lat, point.lng], { icon, title: 'Your live location', alt: 'Your live location', zIndexOffset: 1000 }).addTo(map);
      halo = L.circle([point.lat, point.lng], { radius: accuracy, color: '#2476e8', weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
    } else { marker.setLatLng([point.lat, point.lng]); halo.setLatLng([point.lat, point.lng]); halo.setRadius(accuracy); }
    const heading = position.coords.heading;
    const arrow = marker.getElement?.()?.firstElementChild;
    if (arrow) arrow.style.transform = `rotate(${Number.isFinite(heading) ? heading : 0}deg)`;
    if (follow) {
      // Padding keeps the location out from underneath the guidance card, including half-screen views.
      const height = card.getBoundingClientRect().height, size = map.getSize();
      const location = map.project([point.lat, point.lng], mode === 'walking' ? 17 : 16);
      location.y -= Math.min(height / 2, size.y / 4);
      map.setView(map.unproject(location, mode === 'walking' ? 17 : 16), mode === 'walking' ? 17 : 16, { animate: false });
    }
    if (firstFix) {
      firstFix = false;
      const start = route.points[0];
      if (core.meters(point, { lat: start[0], lng: start[1] }) > 35) { reroute(point, true); return; }
    }
    if (!controller) guidance(point);
  }
  function start(nextRoute, nextMode, to) {
    if (!navigator.geolocation?.watchPosition) { onStop('Live location is unavailable in this browser. You can still use the route steps.'); return; }
    cleanup(); route = nextRoute; mode = nextMode; destination = { ...to }; previous = null; offSince = 0; lastReroute = 0; firstFix = true; lastFix = 0; spoken = '';
    running = true; const token = session; setFollow(true); card.hidden = false;
    stage.classList.add('navigating'); $('navigation-stop').textContent = 'Stop';
    $('navigation-distance').textContent = 'Starting'; $('navigation-instruction').textContent = 'Finding your location…';
    $('navigation-remaining').textContent = `${core.distance(route.distance)} · ${core.duration(route.duration)}`;
    $('navigation-eta').textContent = ''; $('navigation-arrow').textContent = '↑'; liveStatus('Allow location access to start live guidance.');
    timer = setInterval(() => {
      if (running && (!lastFix || Date.now() - lastFix > 15000)) {
        liveStatus(document.hidden ? 'Location may pause while the browser is in the background.' : 'GPS signal lost. Guidance resumes with a fresh location.');
        $('navigation-distance').textContent = 'Waiting for GPS'; $('navigation-instruction').textContent = 'Waiting for your location';
        $('navigation-eta').textContent = ''; window.speechSynthesis?.cancel();
      }
    }, 3000);
    try {
      watch = navigator.geolocation.watchPosition(p => position(p, token), error => {
        if (token !== session || !running) return;
        if (error.code === 1) stop('Location access was denied. Allow location for this site in your browser settings, then start navigation again.');
        else { liveStatus('Location is unavailable. Waiting for GPS to recover.'); $('navigation-distance').textContent = 'Waiting for GPS'; $('navigation-instruction').textContent = 'Waiting for your location'; }
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    } catch { stop('Live location could not start. Check this site’s location permission.'); }
  }
  window.addEventListener('pagehide', () => { if (running || ended) stop(); });
  return { start, stop, get active() { return running || ended; } };
};
