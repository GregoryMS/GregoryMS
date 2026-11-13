'use strict';
window.GregleMapNavigation = ({ map, config, getSelected, onOpen = () => {}, onConnectTraffic = () => {}, onDriveStart = () => false, notify = () => {} }) => {
  const $ = id => document.getElementById(id), core = window.GregleNavigation;
  const routing = window.GregleMapRouting.create({defaultAvailable: config.serverTomTom === true});
  const panel = $('map-directions'), toggle = $('map-directions-toggle');
  const stopFields = ['stop', 'stop2', 'stop3', 'stop4'], fields = ['from', ...stopFields, 'to'];
  const inputs = Object.fromEntries(fields.map(field => [field, $('directions-' + field)]));
  const points = Object.fromEntries(fields.map(field => [field, null]));
  let stopCount = 0;
  const isStop = field => stopFields.includes(field);
  const stopRow = field => $('directions-' + field + '-row');
  const removeStopButton = field => $('directions-remove-' + field);
  const hasStop = () => stopCount > 0 && mode !== 'transit';
  const activeStops = () => hasStop() ? stopFields.slice(0, stopCount) : [];
  const stops = () => activeStops().map(field => ({...points[field]}));
  const canRoute = () => core.valid(points.from) && core.valid(points.to) && activeStops().every(field => core.valid(points[field]));
  const nextField = field => { const order = ['from', ...activeStops(), 'to']; return order[(order.indexOf(field) + 1) % order.length]; };
  function syncStop() {
    $('directions-add-stop').hidden = stopCount >= 4 || mode === 'transit';
    $('directions-add-stop').setAttribute('aria-expanded', String(hasStop()));
    stopFields.forEach((field, index) => { stopRow(field).hidden = mode === 'transit' || index >= stopCount; });
  }
  function resetStops() {
    stopCount = 0;
    for (const field of stopFields) { points[field] = null; inputs[field].value = ''; }
    stopRow('stop4').after?.($('directions-results')); syncStop();
  }
  function syncHandoff() {
    const urls = canRoute() ? core.links(points.from, points.to, mode, stops()) : null;
    $('directions-handoff').hidden = !urls;
    $('directions-apple').hidden = hasStop();
    if (urls) { $('directions-google').href = urls.google; $('directions-apple').href = urls.apple; }
  }
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
  let suggestionTimer,lookupField=null,resultsField=null;const composing=new Set(),searchCache=new Map();
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
  // Persist the route before Tesla replaces the browser with its reversing camera.
  const resumeKey = 'gregle.maps.activeNavigation.v1';
  let unloading = false, restoring = false;
  const saveJourney = (threeD = false) => {
    try {
      if (mode === 'transit' || !currentRoute || !canRoute()) return;
      localStorage.setItem(resumeKey, JSON.stringify({
        savedAt: Date.now(), mode, threeD, stops: stops(),
        from: points.from, to: points.to
      }));
    } catch {}
  };
  const clearJourney = () => { try { localStorage.removeItem(resumeKey); } catch {} };
  window.addEventListener?.('pagehide', () => { unloading = true; });
  const navigationStopped = (message, {freeDrive = false} = {}) => {
    if (!unloading && !restoring) clearJourney();
    if (freeDrive) { notify(message); $('map-car-drive')?.focus({preventScroll:true}); return; }
    showNavigationResult(message);
  };
  const live = window.GregleLiveNavigation?.({ map, routing, onRoute: renderRoute, onStop: navigationStopped });
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
  function invalidate(message = 'Choose locations, then show your route.', keepResults = false) {
    clearTimeout(suggestionTimer);suggestionTimer=null;lookupField=null;if(!keepResults)resultsField=null;
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
    $('directions-steps').replaceChildren(); if(!keepResults)$('directions-results').replaceChildren();
    $('directions-route').disabled = !canRoute();
    syncHandoff();
    status(message);
  }
  function setPoint(field, point) {
    points[field] = { lat: point.lat, lng: point.lng, name: point.name, detail: point.detail };
    inputs[field].value = [point.name, point.detail].filter(Boolean).join(' · ');
    invalidate(canRoute() ? `Ready to find a ${mode} route.` : hasStop() && !activeStops().every(field => core.valid(points[field])) ? 'Search and choose each stop.' : 'Choose the other end of your journey.');
  }
  // Car mode opens the keyboard only after a field itself is tapped.
  const focusField = field => { if (!document.body?.classList.contains('vehicle-layout')) inputs[field].focus(); };
  const defaultStart = () => { if (!points.from && !inputs.from.value && !locating) useLocation(); };
  function open() {
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    document.querySelector('.map-stage').classList.add('directions-open');
    if ($('map-layers-toggle').getAttribute('aria-expanded') === 'true') $('close-map-layers').click();
    onOpen();
  }
  function choosePoint(field, point, locate = true) {
    if (!fields.includes(field) || !core.valid(point)) return;
    if (isStop(field)) { stopCount = Math.max(stopCount, stopFields.indexOf(field) + 1); syncStop(); }
    open(); setPoint(field, point);
    active = nextField(field); focusField(active);
    if (locate && field === 'to') defaultStart();
  }
  function navigateTo(point) {
    if (!core.valid(point)) return;
    choosePoint('to', point, false);
    if (points.from) return calculateRoute();
    else useLocation(true);
  }
  function navigateSaved(point, {threeD = false} = {}) {
    if (!core.valid(point)) return;
    if (threeD) {
      mode = 'driving';
      for (const travel of ['driving', 'walking', 'transit']) $('directions-' + travel)?.setAttribute('aria-pressed', String(travel === mode));
    }
    resetStops();
    open(); setPoint('to', point);
    // Saved shortcuts always start at the device, even after a manually planned route.
    points.from = null; inputs.from.value = '';
    useLocation(true, true, threeD);
  }
  function close() {
    clearJourney();
    invalidate('Directions paused. Show route to calculate again.');
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    document.querySelector('.map-stage').classList.remove('directions-open'); toggle.focus();
  }
  toggle.disabled = false;
  for (const travel of ['driving', 'walking', 'transit']) $('directions-' + travel)?.addEventListener('click', () => {
    if (travel === mode) return;
    mode = travel;
    for (const choice of ['driving', 'walking', 'transit']) $('directions-' + choice)?.setAttribute('aria-pressed', String(choice === mode));
    syncStop(); if (isStop(active) && mode === 'transit') active = 'to';
    invalidate(mode === 'transit' && stopCount ? 'Transit uses the start and destination. Your stops are kept for driving or walking.' : `Choose locations, then show your ${mode} route.`);
  });
  function startNavigation(threeD = false) {
    const engine=mode==='transit'?transitLive:live;
    if (!currentRoute || !engine) return;
    onDriveStart();
    try {
      if(mode==='transit'){transitVehicles?.clear();transitLive.start(currentRoute);}else live.start(currentRoute, mode, points.to, {threeD});
      if (engine.active) {
        if (mode !== 'transit') saveJourney(threeD);
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
  function startDrive({threeD = false} = {}) {
    if (!live?.startDrive) return;
    invalidate(); clearJourney();
    const base3D = onDriveStart();
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    document.querySelector('.map-stage').classList.remove('directions-open');
    try {
      live.startDrive({threeD: threeD || base3D});
      if (live.active) $('navigation-stop').focus({preventScroll:true});
    } catch { live.stop('Driving could not start. Check location access for this site, then try again.'); }
  }
  const driveButton = $('map-car-drive');
  if (driveButton && live?.startDrive) {
    driveButton.disabled = false;
    driveButton.addEventListener('click', () => startDrive());
  }
  function startCar3D() {
    if (currentRoute && mode === 'driving') { onDriveStart(); startNavigation(true); }
    else startDrive({threeD:true});
  }
  $('directions-start').addEventListener('click', () => startNavigation());
  $('directions-3d')?.addEventListener('click', () => startNavigation(true));
  toggle.addEventListener('click', () => {
    if (panel.hidden || panel.inert || panel.closest?.('.map-drawer.is-compact')) {
      open();
      defaultStart();
      if (!panel.closest?.('.map-drawer')) focusField(active);
    } else close();
  });
  $('close-directions').addEventListener('click', close);
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  for (const field of fields) {
    inputs[field].addEventListener('focus', () => {if(active!==field){clearTimeout(suggestionTimer);suggestionTimer=null;if(lookupField)invalidate();else if(resultsField!==field){$('directions-results').replaceChildren();resultsField=null;}} active = field; $('directions-search').textContent = `Find ${field === 'from' ? 'starting point' : isStop(field) ? 'stop ' + (stopFields.indexOf(field) + 1) : 'destination'}`; });
    const suggest=(schedule=true)=>{active=field;points[field]=null;const eligible=inputs[field].value.trim().length>=3;invalidate(eligible?'Updating suggestions…':'Search and choose a matching place.',eligible&&resultsField===field);if(schedule&&!composing.has(field)&&eligible)suggestionTimer=setTimeout(()=>searchPlaces(field,true),450);};
    inputs[field].addEventListener('input',event=>suggest(!event.isComposing));
    inputs[field].addEventListener('compositionstart',()=>{composing.add(field);suggest(false);});
    inputs[field].addEventListener('compositionend',()=>{composing.delete(field);suggest();});
    inputs[field].addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'&&resultsField===field){const first=$('directions-results').querySelector('button');if(first){event.preventDefault();first.focus();}}
      if(event.key==='Escape'&&(suggestionTimer||lookupField||resultsField)){event.preventDefault();event.stopPropagation();invalidate('Suggestions dismissed. Keep typing to search.');}
    });
    $(`directions-${field}-pin`)?.addEventListener('click', () => {
      choosePoint(field, getSelected());
    });
  }
  $('directions-add-stop').addEventListener('click', () => {
    if (stopCount >= 4 || mode === 'transit') return;
    const field = stopFields[stopCount++];
    syncStop(); invalidate('Search and choose stop ' + stopCount + '.'); active = field;
    $('directions-search').textContent = 'Find stop ' + stopCount; focusField(field);
  });
  for (const field of stopFields) removeStopButton(field).addEventListener('click', () => {
    const index = stopFields.indexOf(field); if (index >= stopCount) return;
    for (let i = index; i < stopCount - 1; i++) {
      points[stopFields[i]] = points[stopFields[i + 1]];
      inputs[stopFields[i]].value = inputs[stopFields[i + 1]].value;
    }
    const last = stopFields[--stopCount]; points[last] = null; inputs[last].value = '';
    stopRow('stop4').after?.($('directions-results'));
    syncStop(); invalidate(); active = index < stopCount ? field : 'to';
    $('directions-search').textContent = active === 'to' ? 'Find destination' : 'Find stop ' + (index + 1);
    $('directions-add-stop').focus({preventScroll:true});
  });
  $('directions-swap').addEventListener('click', () => {
    [points.from, points.to] = [points.to, points.from];
    [inputs.from.value, inputs.to.value] = [inputs.to.value, inputs.from.value];
    const reversed = stopFields.slice(0, stopCount).map(field => ({point:points[field],value:inputs[field].value})).reverse();
    reversed.forEach((item,index) => { points[stopFields[index]] = item.point; inputs[stopFields[index]].value = item.value; });
    invalidate();
  });
  $('directions-clear').addEventListener('click', () => {
    clearJourney();
    resetStops(); points.from = points.to = null; inputs.from.value = inputs.to.value = '';
    invalidate(); active = 'from'; focusField('from');
  });
  function useLocation(routeAfter = false, startAfter = false, threeD = false) {
    invalidate();
    if (!navigator.geolocation) { status('Location is unavailable. Search for a starting point instead.'); return; }
    const token = version; locating = true; $('directions-location').disabled = true; status('Finding your starting location…');
    navigator.geolocation.getCurrentPosition(position => {
      if (token !== version || !locating) return;
      const p = { lat: position.coords.latitude, lng: position.coords.longitude, name: 'My location' };
      if (!core.valid(p)) { invalidate('Your location was invalid. Search for a starting point.'); return; }
      setPoint('from', p); active = 'to'; if (!startAfter) focusField('to');
      if (routeAfter && points.to) calculateRoute(false, startAfter, threeD);
    }, () => { if (token === version) invalidate('Location could not be shared. Allow location access or search for a starting point.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: startAfter ? 0 : 30000 });
  }
  $('directions-location').addEventListener('click', () => useLocation());
  async function searchPlaces(field=active,automatic=false) {
    if(automatic&&(document.hidden||panel.hidden||composing.has(field)||active!==field))return;
    const term = inputs[field].value.trim();
    invalidate(undefined, automatic && resultsField === field);
    if (term.length < (automatic?3:2)) { if(!automatic){status('Enter at least two characters to search.');focusField(field);}return; }
    const token = version;let timer,current;
    try {
      const url = new URL(window.GregleMaps.searchURL(config.searchURL, term));
      const center = map.getCenter(); url.searchParams.set('lat', center.lat); url.searchParams.set('lon', window.GregleMaps.wrapLongitude(center.lng));
      const key=url.href;let results=searchCache.get(key);
      if(!results){
        if(Date.now()<nextSearch){if(automatic)suggestionTimer=setTimeout(()=>searchPlaces(field,true),nextSearch-Date.now());else status('Please wait a moment, then search again.');return;}
        nextSearch=Date.now()+1000;controller=new AbortController();current=controller;lookupField=field;timer=setTimeout(()=>current.abort(),10000);
        panel.setAttribute('aria-busy','true');status(`Finding ${field==='from'?'starting points':isStop(field)?'stops':'destinations'}…`);
        const response=await fetch(url,{signal:current.signal});if(!response.ok)throw Error('Search unavailable');
        results=window.GregleMaps.readResults(await response.json());if(token!==version||active!==field)return;
        searchCache.set(key,results);while(searchCache.size>20)searchCache.delete(searchCache.keys().next().value);
      }
      if(token!==version||active!==field)return;resultsField=field;
      inputs[field].closest?.('.directions-field')?.after?.($('directions-results'));
      $('directions-results').replaceChildren();
      status(results.length ? 'Choose the matching place below.' : 'No matching places. Try a fuller address or nearby town.');
      for (const point of results) {
        const li = document.createElement('li'), button = document.createElement('button'), name = document.createElement('strong'), detail = document.createElement('span');
        button.type = 'button'; name.textContent = point.name; detail.textContent = point.detail; button.append(name, detail); li.append(button); $('directions-results').append(li);
        button.addEventListener('click', () => { setPoint(field, point); active = nextField(field); focusField(active); if (field === 'to') defaultStart(); });
      }
    } catch { if (token === version) status('Place search is unavailable. Try again, or select a map pin and choose Start here / Directions here.'); }
    finally { clearTimeout(timer); if (token === version) { controller = null;lookupField=null;panel.removeAttribute('aria-busy'); } }
  }
  $('directions-search-form').addEventListener('submit',e=>{e.preventDefault();return searchPlaces();});
  $('directions-results').addEventListener('keydown',event=>{
    const buttons=Array.from($('directions-results').querySelectorAll('button')),i=buttons.indexOf(event.target);if(i<0)return;
    if(event.key==='ArrowDown'){event.preventDefault();buttons[(i+1)%buttons.length].focus();}
    if(event.key==='ArrowUp'){event.preventDefault();if(i===0)focusField(resultsField||active);else buttons[i-1].focus();}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();const field=resultsField||active;invalidate('Suggestions dismissed. Keep typing to search.');focusField(field);}
  });
  document.addEventListener?.('visibilitychange',()=>{if(document.hidden&&(suggestionTimer||lookupField)){clearTimeout(suggestionTimer);suggestionTimer=null;if(lookupField)invalidate();}});
  window.addEventListener?.('pagehide',()=>{clearTimeout(suggestionTimer);controller?.abort();});
  async function calculateRoute(refresh = false, startAfter = false, threeD = false) {
    if (!canRoute()) { status(hasStop() ? 'Choose a starting point, every stop and a destination.' : 'Choose a starting point and destination.'); return; }
    if (refresh) { version++; controller?.abort(); }
    else invalidate();
    if (!refresh && Date.now() < nextRoute) { status('Please wait a moment, then show the route again.'); return; }
    nextRoute = Date.now() + 1100;
    const token = version, from = { ...points.from }, to = { ...points.to };
    controller = new AbortController(); const current = controller, timer = setTimeout(() => current.abort(), mode==='transit'?25000:15000 * (activeStops().length + 1));
    panel.setAttribute('aria-busy', 'true'); $('directions-route').disabled = true; $('directions-start').disabled = true; $('directions-3d').disabled = true;
    status(mode === 'driving' && routing.enabled && routing.connected ? 'Finding a route with live traffic…' : `Finding a ${mode} route…`);
    try {
      const route = mode==='transit'?await transitCore.request(from,to,{signal:current.signal}):await routing.request(from, to, mode, { signal: current.signal, via: stops() });
      if (token !== version) return;
      if(mode==='transit')showJourneys(route,from,to);else renderRoute(route, from, to, !refresh);
      status(`${mode==='transit'?'Transit journey':mode === 'walking' ? 'Walking route' : 'Driving route'} ready. Start navigation for live guidance.`);
      if (startAfter) startNavigation(threeD);
    } catch (error) { if (token === version) status(error.name === 'AbortError' ? 'Routing timed out. Try again, or use your navigation app below.' : error.message || 'Routing is unavailable. Try again.'); }
    finally { clearTimeout(timer); if (token === version) { controller = null; panel.removeAttribute('aria-busy'); $('directions-route').disabled = !canRoute(); $('directions-start').disabled = !currentRoute || !(mode==='transit'?transitLive:live); $('directions-3d').disabled = !currentRoute || !live; } }
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
      const remaining = route.stops || []; resetStops(); stopCount = Math.min(4, remaining.length);
      remaining.slice(0,4).forEach((point,index) => { const field=stopFields[index]; points[field]={...point}; inputs[field].value=[point.name,point.detail].filter(Boolean).join(' · '); });
      syncStop();
      syncHandoff();
    }
    currentRoute = route; routeLayers.clearLayers(); $('directions-steps').replaceChildren();
    routeCredit(route.provider === 'tomtom' || route.providers?.includes('tomtom'));
    L.polyline(route.points, { color: '#fff', weight: 10, opacity: .9, interactive: false }).addTo(routeLayers);
    const line = L.polyline(route.points, { color: '#7637cc', weight: 6, opacity: .95, interactive: false, dashArray: mode === 'walking' ? '3 10' : null }).addTo(routeLayers);
    for (const [label, p] of [['A', from], ...(route.stops || []).map((point, index) => [String(index + 1), point]), ['B', to]]) {
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
  syncStop(); syncTraffic();
  // A fresh browser session can reconstruct the route from its endpoints.
  // Re-request routing rather than storing stale geometry, traffic or GPS fixes.
  try {
    const saved = JSON.parse(localStorage.getItem(resumeKey) || 'null');
    const savedStops = Array.isArray(saved?.stops) ? saved.stops : saved?.stopEnabled ? [saved.stop] : [];
    if (saved && Date.now() - saved.savedAt > 0 && Date.now() - saved.savedAt < 12 * 60 * 60 * 1000 &&
        ['driving', 'walking'].includes(saved.mode) && core.valid(saved.from) && core.valid(saved.to) &&
        savedStops.length <= 4 && savedStops.every(core.valid)) {
      restoring = true;
      mode = saved.mode;
      for (const choice of ['driving', 'walking', 'transit'])
        $('directions-' + choice)?.setAttribute('aria-pressed', String(choice === mode));
      stopCount = savedStops.length;
      syncStop();
      for (const field of fields) {
        const point = isStop(field) ? savedStops[stopFields.indexOf(field)] : saved[field];
        points[field] = point && core.valid(point) ? point : null;
        inputs[field].value = points[field] ? [point.name, point.detail].filter(Boolean).join(' · ') : '';
      }
      open();
      status('Restoring your previous navigation route…');
      // Delay until the map and controls have completed initialisation.
      setTimeout(async () => {
        try { await calculateRoute(false, false); }
        finally {
          restoring = false;
          if (currentRoute) {
            status('Previous route restored. Tap Start navigation to resume live GPS guidance.');
          } else status('Could not restore the previous route. Tap Show route to retry.');
        }
      }, 400);
    } else if (saved) clearJourney();
  } catch { clearJourney(); }
  return { close, refreshTraffic, choosePoint, navigateTo, navigateSaved, startDrive, startCar3D };
};
