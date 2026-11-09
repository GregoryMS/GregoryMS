'use strict';
window.GregleMapNavigation = ({ map, config, getSelected, onOpen = () => {}, onConnectTraffic = () => {} }) => {
  const $ = id => document.getElementById(id), core = window.GregleNavigation;
  const routing = window.GregleMapRouting.create({defaultAvailable: config.serverTomTom === true});
  const panel = $('map-directions'), toggle = $('map-directions-toggle');
  const inputs = { from: $('directions-from'), to: $('directions-to') }, points = { from: null, to: null };
  const routeLayers = L.layerGroup().addTo(map);
  const trafficCredit = '&copy; <a href="https://www.tomtom.com/" target="_blank" rel="noopener">TomTom</a>';
  let routeHasTrafficCredit = false;
  function routeCredit(enabled) {
    if (routeHasTrafficCredit === enabled) return;
    if (enabled) map.attributionControl?.addAttribution(trafficCredit);
    else map.attributionControl?.removeAttribution(trafficCredit);
    routeHasTrafficCredit = enabled;
  }
  let active = 'from', version = 0, controller, locating = false, nextSearch = 0, nextRoute = 0, mode = 'driving', currentRoute = null;
  const status = text => { $('directions-status').textContent = text; };
  function showNavigationResult(message) {
    open(); status(message);
    const notice = $('directions-status');
    notice.setAttribute('tabindex', '-1');
    notice.focus({ preventScroll: true });
    // The phone drawer restores its scroll position in a mutation observer.
    // Reveal the notice after that restoration, rather than focusing Start below it.
    const reveal = () => { if (!panel.hidden) notice.scrollIntoView?.({ block: 'center', inline: 'nearest' }); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(reveal);
    else reveal();
  }
  const live = window.GregleLiveNavigation?.({ map, routing, onRoute: renderRoute, onStop: showNavigationResult });
  const transitCore=window.GregleTransitJourneyCore;
  const transitVehicles=window.GregleTransitVehicles?.({map,statusElement:$('journey-vehicle-status'),creditElement:$('journey-vehicle-credit')});
  const transitLive=window.GregleTransitJourneyLive?.({map,onStop:showNavigationResult,onReplan:point=>{open();if(point)setPoint('from',{...point,name:'My location'});calculateRoute();}});
  let journeyAlignment,journeyAlignmentVersion=0;
  const journeyRoadCredit='Transit alignment: © <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> © OpenStreetMap';
  const transitCredit='Transit journeys: <a href="https://transitous.org/" target="_blank" rel="noopener">Transitous</a> · <a href="https://transitous.org/sources/" target="_blank" rel="noopener">sources &amp; licences</a>';
  function syncTraffic() {
    for (const id of ['directions-traffic', 'navigation-traffic']) {
      $(id).setAttribute('aria-checked', String(routing.enabled));
      $(id).disabled = !routing.connected;
    }
    $('directions-traffic-row').hidden = !currentRoute || mode !== 'driving';
    $('directions-traffic-connect').hidden = !currentRoute || mode !== 'driving' || routing.hasOwnKey;
    $('directions-traffic-connect').textContent = config.serverTomTom ? 'Add your own TomTom key' : 'Connect TomTom';
    $('directions-estimate-note').textContent = mode==='transit'?'Times are local to each stop. Live estimates are labelled; other times are scheduled. Keep this page open for GPS stop alerts.':window.GregleMapRouting.note(currentRoute, mode);
  }
  async function refreshTraffic() {
    syncTraffic();
    if (live?.active) return live.refreshTraffic();
    if (currentRoute) return calculateRoute(true);
  }
  for (const id of ['directions-traffic', 'navigation-traffic']) $(id).addEventListener('click', () => {
    routing.setEnabled(!routing.enabled); refreshTraffic();
  });
  $('directions-traffic-connect').addEventListener('click', event => {
    event.stopPropagation();
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    document.querySelector('.map-stage').classList.remove('directions-open');
    onConnectTraffic();
  });
  function invalidate(message = 'Choose locations, then show your route.') {
    if (live?.active) live.stop();
    if(transitLive?.active)transitLive.stop();
    journeyAlignmentVersion++;journeyAlignment?.abort();journeyAlignment=null;
    transitVehicles?.clear();map.attributionControl?.removeAttribution(transitCredit);map.attributionControl?.removeAttribution(journeyRoadCredit);
    if($('directions-transit-options')){$('directions-transit-options').replaceChildren();$('directions-transit-options').hidden=true;}
    currentRoute = null; $('directions-start').disabled = true; $('directions-3d').disabled = true;
    version++; controller?.abort(); controller = null; locating = false;
    $('directions-location').disabled = false;
    panel.removeAttribute('aria-busy');
    routeLayers.clearLayers(); $('directions-summary').hidden = true;
    routeCredit(false);
    syncTraffic();
    $('directions-steps').replaceChildren(); $('directions-results').replaceChildren();
    $('directions-route').disabled = !points.from || !points.to;
    const urls = core.links(points.from, points.to, mode);
    $('directions-handoff').hidden = !urls;
    if (urls) { $('directions-google').href = urls.google; $('directions-apple').href = urls.apple; }
    status(message);
  }
  function setPoint(field, point) {
    points[field] = { lat: point.lat, lng: point.lng, name: point.name, detail: point.detail };
    inputs[field].value = [point.name, point.detail].filter(Boolean).join(' · ');
    invalidate(points.from && points.to ? `Ready to find a ${mode} route.` : 'Choose the other end of your journey.');
  }
  function open() {
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    document.querySelector('.map-stage').classList.add('directions-open');
    if ($('map-layers-toggle').getAttribute('aria-expanded') === 'true') $('close-map-layers').click();
    onOpen();
  }
  function choosePoint(field, point) {
    if (!['from', 'to'].includes(field) || !core.valid(point)) return;
    open(); setPoint(field, point);
    active = field === 'from' ? 'to' : 'from'; inputs[active].focus();
  }
  function navigateTo(point) {
    if (!core.valid(point)) return;
    choosePoint('to', point);
    if (points.from) return calculateRoute();
    else useLocation(true);
  }
  function close() {
    invalidate('Directions paused. Show route to calculate again.');
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    document.querySelector('.map-stage').classList.remove('directions-open'); toggle.focus();
  }
  toggle.disabled = false;
  for (const travel of ['driving', 'walking', 'transit']) $('directions-' + travel)?.addEventListener('click', () => {
    if (travel === mode) return;
    mode = travel;
    for (const choice of ['driving', 'walking', 'transit']) $('directions-' + choice)?.setAttribute('aria-pressed', String(choice === mode));
    invalidate(`Choose locations, then show your ${mode} route.`);
  });
  function startNavigation(threeD = false) {
    const engine=mode==='transit'?transitLive:live;
    if (!currentRoute || !engine) return;
    try {
      if(mode==='transit'){transitVehicles?.clear();transitLive.start(currentRoute);}else live.start(currentRoute, mode, points.to, {threeD});
      if (engine.active) {
        panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
        document.querySelector('.map-stage').classList.remove('directions-open');
        $(mode==='transit'?'transit-guidance-next':'navigation-stop').focus({ preventScroll: true });
      }
    } catch {
      const message = 'Navigation could not start. Check location access for this site in your browser settings, then try again.';
      try { engine.stop(message); } catch {}
      showNavigationResult(message);
    }
  }
  $('directions-start').addEventListener('click', () => startNavigation());
  $('directions-3d')?.addEventListener('click', () => startNavigation(true));
  toggle.addEventListener('click', () => {
    if (panel.hidden || panel.inert || panel.closest?.('.map-drawer.is-compact')) {
      open();
      if (!panel.closest?.('.map-drawer')) inputs[active].focus();
    } else close();
  });
  $('close-directions').addEventListener('click', close);
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  for (const field of ['from', 'to']) {
    inputs[field].addEventListener('focus', () => { active = field; $('directions-search').textContent = `Find ${field === 'from' ? 'starting point' : 'destination'}`; });
    inputs[field].addEventListener('input', () => { points[field] = null; invalidate('Search and choose a matching place.'); });
    $(`directions-${field}-pin`).addEventListener('click', () => {
      choosePoint(field, getSelected());
    });
  }
  $('directions-swap').addEventListener('click', () => {
    [points.from, points.to] = [points.to, points.from];
    [inputs.from.value, inputs.to.value] = [inputs.to.value, inputs.from.value]; invalidate();
  });
  $('directions-clear').addEventListener('click', () => {
    points.from = points.to = null; inputs.from.value = inputs.to.value = ''; invalidate(); active = 'from'; inputs.from.focus();
  });
  function useLocation(routeAfter = false) {
    invalidate();
    if (!navigator.geolocation) { status('Location is unavailable. Search for a starting point instead.'); return; }
    const token = version; locating = true; $('directions-location').disabled = true; status('Finding your starting location…');
    navigator.geolocation.getCurrentPosition(position => {
      if (token !== version || !locating) return;
      const p = { lat: position.coords.latitude, lng: position.coords.longitude, name: 'My location' };
      if (!core.valid(p)) { invalidate('Your location was invalid. Search for a starting point.'); return; }
      setPoint('from', p); active = 'to'; inputs.to.focus();
      if (routeAfter && points.to) calculateRoute();
    }, () => { if (token === version) invalidate('Location could not be shared. Allow location access or search for a starting point.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }
  $('directions-location').addEventListener('click', () => useLocation());
  $('directions-search-form').addEventListener('submit', async e => {
    e.preventDefault(); const field = active, term = inputs[field].value.trim();
    invalidate();
    if (term.length < 2) { status('Enter at least two characters to search.'); inputs[field].focus(); return; }
    if (Date.now() < nextSearch) { status('Please wait a moment, then search again.'); return; }
    nextSearch = Date.now() + 1000;
    const token = version; controller = new AbortController(); const current = controller;
    const timer = setTimeout(() => current.abort(), 10000);
    panel.setAttribute('aria-busy', 'true'); status(`Finding ${field === 'from' ? 'starting points' : 'destinations'}…`);
    try {
      const url = new URL(window.GregleMaps.searchURL(config.searchURL, term));
      const center = map.getCenter(); url.searchParams.set('lat', center.lat); url.searchParams.set('lon', window.GregleMaps.wrapLongitude(center.lng));
      const response = await fetch(url, { signal: current.signal }); if (!response.ok) throw new Error();
      const results = window.GregleMaps.readResults(await response.json()); if (token !== version) return;
      status(results.length ? 'Choose the matching place below.' : 'No matching places. Try a fuller address or nearby town.');
      for (const point of results) {
        const li = document.createElement('li'), button = document.createElement('button'), name = document.createElement('strong'), detail = document.createElement('span');
        button.type = 'button'; name.textContent = point.name; detail.textContent = point.detail; button.append(name, detail); li.append(button); $('directions-results').append(li);
        button.addEventListener('click', () => { setPoint(field, point); active = field === 'from' ? 'to' : 'from'; inputs[active].focus(); });
      }
    } catch { if (token === version) status('Place search is unavailable. Try again, or select a map pin and choose Start here / Directions here.'); }
    finally { clearTimeout(timer); if (token === version) { controller = null; panel.removeAttribute('aria-busy'); } }
  });
  async function calculateRoute(refresh = false) {
    if (!core.valid(points.from) || !core.valid(points.to)) return;
    if (refresh) { version++; controller?.abort(); }
    else invalidate();
    if (!refresh && Date.now() < nextRoute) { status('Please wait a moment, then show the route again.'); return; }
    nextRoute = Date.now() + 1100;
    const token = version, from = { ...points.from }, to = { ...points.to };
    controller = new AbortController(); const current = controller, timer = setTimeout(() => current.abort(), mode==='transit'?25000:15000);
    panel.setAttribute('aria-busy', 'true'); $('directions-route').disabled = true; $('directions-start').disabled = true; $('directions-3d').disabled = true;
    status(mode === 'driving' && routing.enabled && routing.connected ? 'Finding a route with live traffic…' : `Finding a ${mode} route…`);
    try {
      const route = mode==='transit'?await transitCore.request(from,to,{signal:current.signal}):await routing.request(from, to, mode, { signal: current.signal });
      if (token !== version) return;
      if(mode==='transit')showJourneys(route,from,to);else renderRoute(route, from, to, !refresh);
      status(`${mode==='transit'?'Transit journey':mode === 'walking' ? 'Walking route' : 'Driving route'} ready. Start navigation for live guidance.`);
    } catch (error) { if (token === version) status(error.name === 'AbortError' ? 'Routing timed out. Try again, or use your navigation app below.' : error.message || 'Routing is unavailable. Try again.'); }
    finally { clearTimeout(timer); if (token === version) { controller = null; panel.removeAttribute('aria-busy'); $('directions-route').disabled = !points.from || !points.to; $('directions-start').disabled = !currentRoute || !(mode==='transit'?transitLive:live); $('directions-3d').disabled = !currentRoute || !live; } }
  }
  $('directions-route').addEventListener('click', () => calculateRoute());
  function showJourneys(journeys,from,to){
    const options=$('directions-transit-options');options.replaceChildren();options.hidden=false;
    const heading=document.createElement('p');heading.textContent='Leave now · choose a journey';options.append(heading);
    journeys.forEach((journey,i)=>{
      const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(i===0));
      const rides=journey.legs.filter(l=>!l.walk).map(l=>l.route).join(' → ');
      button.textContent=`${transitCore.clock(journey.start,journey.zone)} → ${transitCore.clock(journey.end,journey.zone)} · ${core.duration(journey.duration)} · ${journey.transfers} transfer${journey.transfers===1?'':'s'} · ${rides}`;
      button.addEventListener('click',()=>{for(const b of options.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));renderJourney(journey,from,to);});options.append(button);
    });
    renderJourney(journeys[0],from,to);
  }
  function renderJourney(journey,from,to){
    journeyAlignment?.abort();journeyAlignment=new AbortController();const alignment=journeyAlignment,alignmentVersion=++journeyAlignmentVersion;
    if(window.dispatchEvent)window.dispatchEvent(new Event('gregle:transit-journey'));
    map.attributionControl?.removeAttribution(journeyRoadCredit);
    currentRoute=journey;routeLayers.clearLayers();$('directions-steps').replaceChildren();transitVehicles?.clear();routeCredit(false);map.attributionControl?.removeAttribution(transitCredit);map.attributionControl?.addAttribution(transitCredit);
    let line;
    for(const leg of journey.legs){
      const casing=L.polyline(leg.points,{color:'#fff',weight:10,opacity:.9,interactive:false}).addTo(routeLayers);
      line=L.polyline(leg.points,{color:leg.walk?'#7637cc':'#b68bea',weight:leg.walk?5:6,opacity:1,dashArray:leg.walk?'3 10':null,interactive:false,smoothFactor:0}).addTo(routeLayers);
      const trace=line;
      if(!leg.walk&&window.GregleTransitRoads)window.GregleTransitRoads.match(leg,{signal:alignment.signal}).then(result=>{if(result.roadMatched&&alignmentVersion===journeyAlignmentVersion&&!alignment.signal.aborted&&currentRoute===journey){trace.setLatLngs(result.points);casing.setLatLngs(result.points);map.attributionControl?.addAttribution(journeyRoadCredit);}}).catch(()=>{});
      if(!leg.walk)for(const p of [leg.from,leg.to]){const dot=L.circleMarker([p.lat,p.lng],{radius:6,color:'#194b96',weight:2,fillColor:'#fff',fillOpacity:1});const label=document.createElement('span');label.textContent=p.name;dot.bindTooltip(label).addTo(routeLayers);}
      const li=document.createElement('li');li.textContent=transitCore.stepText(leg);$('directions-steps').append(li);
      for(const alert of leg.alerts){const note=document.createElement('li');note.textContent=alert;note.className='transit-alert';$('directions-steps').append(note);}
    }
    const small=window.innerWidth<=700,size=map.getSize(),width=panel.getBoundingClientRect?.().width||380;
    map.fitBounds(L.latLngBounds(journey.points),{paddingTopLeft:small?[25,25]:[Math.min(width+40,size.x*.48),30],paddingBottomRight:small?[55,Math.min(340,(size.y||700)*.45)]:[80,30],maxZoom:16});
    $('directions-total').textContent=`${core.duration(journey.duration)} · ${journey.transfers} transfer${journey.transfers===1?'':'s'} · walk ${core.distance(journey.walkDistance)}`;
    $('directions-summary').hidden=false;$('directions-start').disabled=!transitLive;$('directions-3d').hidden=true;$('directions-steps').closest('details').open=true;
    const firstRide=journey.legs.find(l=>!l.walk);if(firstRide)transitVehicles?.show({routeId:firstRide.routeId,route:firstRide.route});syncTraffic();
  }
  function renderRoute(route, from, to, fit = true) {
    if (!fit && live?.active) {
      points.from = { ...from, name: 'My location' }; inputs.from.value = 'My location';
      const urls = core.links(points.from, points.to, mode);
      if (urls) { $('directions-google').href = urls.google; $('directions-apple').href = urls.apple; }
    }
    currentRoute = route; routeLayers.clearLayers(); $('directions-steps').replaceChildren();
    routeCredit(!!route.traffic && route.provider === 'tomtom');
    L.polyline(route.points, { color: '#fff', weight: 10, opacity: .9, interactive: false }).addTo(routeLayers);
    const line = L.polyline(route.points, { color: '#7637cc', weight: 6, opacity: .95, interactive: false, dashArray: mode === 'walking' ? '3 10' : null }).addTo(routeLayers);
    for (const [label, p] of [['A', from], ['B', to]]) {
      const icon = L.divIcon({ className: 'directions-marker', html: label, iconSize: [28, 28], iconAnchor: [14, 14] });
      L.marker([p.lat, p.lng], { icon, title: `${label}: ${p.name || 'Location'}`, alt: `${label}: ${p.name || 'Location'}` }).addTo(routeLayers);
    }
    if (fit) {
      const small = window.innerWidth <= 700, size = map.getSize();
      const panelWidth = panel.getBoundingClientRect?.().width || 380;
      map.fitBounds(line.getBounds(), { paddingTopLeft: small ? [25, 25] : [Math.min(panelWidth + 40, size.x * .48), 30], paddingBottomRight: small ? [55, Math.min(340, (size.y || 700) * .45)] : [80, 30], maxZoom: 16 });
    }
    $('directions-total').textContent = `${core.duration(route.duration)} · ${core.distance(route.distance)}`;
    for (const step of route.steps) { const li = document.createElement('li'); li.textContent = `${step.text} · ${core.distance(step.distance)}`; $('directions-steps').append(li); }
    $('directions-summary').hidden = false; $('directions-start').disabled = !live;
    $('directions-3d').hidden = mode !== 'driving'; $('directions-3d').disabled = !live;
    syncTraffic();
  }
  syncTraffic();
  return { close, refreshTraffic, choosePoint, navigateTo };
};
