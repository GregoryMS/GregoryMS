(() => {
  'use strict';
  const A = window.GregleAstro, W = window.GregleWeather, S = window.SunCalc;
  const $ = id => document.getElementById(id);
  const presets = {
    vancouver: {name:'Vancouver', region:'British Columbia, Canada', latitude:49.28, longitude:-123.12, timezone:'America/Vancouver', country:'CA'},
    victoria: {name:'Victoria', region:'British Columbia, Canada', latitude:48.43, longitude:-123.37, timezone:'America/Vancouver', country:'CA'},
    chilliwack: {name:'Chilliwack', region:'British Columbia, Canada', latitude:49.16, longitude:-121.95, timezone:'America/Vancouver', country:'CA'},
    tofino: {name:'Tofino', region:'British Columbia, Canada', latitude:49.153, longitude:-125.907, timezone:'America/Vancouver', country:'CA'}
  };
  let place = window.GregleTides.locationFromURL(window.location?.href) || presets.vancouver, forecast = null, forecastController, searchController, selectedSite = null, sitesBrowser;
  let selection = 0, searchVersion = 0, chartVersion = 0, geoVersion = 0, checkedAt = 0;
  let moonEvents = null, moonController, moonDatesLoading = true;
  const number = (value, suffix = '', decimals = 0) => Number.isFinite(value) ? value.toFixed(decimals) + suffix : '—';
  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function moonSymbol(phase) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('class', 'moon-symbol');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    disc.setAttribute('cx', '32'); disc.setAttribute('cy', '32'); disc.setAttribute('r', '28'); disc.setAttribute('class', 'moon-disc');
    const light = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // Trace the lit limb and elliptical terminator; waxing is lit on the right.
    const side = phase < 0.5 ? 1 : -1, curve = Math.cos(2 * Math.PI * phase), points = [];
    for (let i = 0; i <= 64; i++) {
      const angle = i * Math.PI / 64;
      points.push([32 + side * 28 * Math.sin(angle), 32 - 28 * Math.cos(angle)]);
    }
    for (let i = 64; i >= 0; i--) {
      const angle = i * Math.PI / 64;
      points.push([32 + side * curve * 28 * Math.sin(angle), 32 - 28 * Math.cos(angle)]);
    }
    light.setAttribute('d', 'M' + points.map(p => p.map(n => n.toFixed(3)).join(',')).join('L') + 'Z');
    light.setAttribute('class', 'moon-lit');
    svg.append(disc, light); return svg;
  }
  function localTime(time, options = {}) {
    return new Intl.DateTimeFormat('en-CA', {timeZone: forecast?.timezone || place.timezone || 'UTC', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', ...options}).format(new Date(time));
  }
  function altitude(time) { return S.getPosition(new Date(time), place.latitude, place.longitude).altitude * 180 / Math.PI; }
  function updateWeatherLink() {
    window.GregleSatellite?.setLocation(place);
    window.GregleAstroCalendar?.setTimezone(forecast?.timezone || place.timezone || 'UTC');
    $('weather-link').href = 'weather.html?' + new URLSearchParams({lat:place.latitude, lon:place.longitude, name:place.name, country:place.country || '', tz:forecast?.timezone || place.timezone || 'UTC'});
    $('weather-icon-link').href = $('weather-link').href;
  }
  async function json(url, controller) {
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {signal:controller.signal});
      if (!response.ok) throw Error('Service unavailable');
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  function skySummary() {
    const now = Date.now(), sun = altitude(now), moon = S.getMoonIllumination(new Date(now));
    const timezone = forecast?.timezone || place.timezone || 'UTC';
    const events = A.riseSetTimes(now, place, timezone, S);
    for (const [id, time] of Object.entries(events)) {
      $(id).textContent = time === null ? (id.endsWith('rise') ? 'No rise today' : 'No set today') : localTime(time, {month:undefined, day:undefined});
    }
    $('rise-set-date').textContent = 'Today · ' + localTime(now, {hour:undefined, minute:undefined, year:'numeric'}) + ' · ' + timezone + ' · Approximate local times';
    $('sky-now').textContent = sun < -18 ? 'Astronomical darkness' : sun < -0.833 ? 'Twilight' : 'Daylight';
    $('moon').textContent = number(moon.fraction * 100, '%') + (moon.phase < 0.5 ? ' · waxing' : ' · waning');
    $('moon-up').textContent = S.getMoonPosition(new Date(now), place.latitude, place.longitude).altitude > 0 ? 'Yes' : 'No';
    const phase = A.moonPhase(moon.phase);
    $('moon-phase-icon').replaceChildren(moonSymbol(moon.phase));
    $('moon-phase-name').textContent = phase.name;
    $('moon-phase-detail').textContent = number(moon.fraction * 100, '% illuminated') + ' · ' + (moon.phase < 0.5 ? 'Waxing' : 'Waning');
    const verifiedDates = moonEvents?.filter(event => event.time > now);
    const hasVerifiedDates = verifiedDates?.length === 4;
    $('moon-phase-dates').replaceChildren(...(hasVerifiedDates ? verifiedDates : A.upcomingMoonPhases(now, S.getMoonIllumination)).map(event => {
      const card = element('li', undefined, 'moon-event');
      const icon = moonSymbol(event.phase);
      const date = element('time', localTime(event.time, {hour:undefined, minute:undefined, year:'numeric'}));
      date.dateTime = new Date(event.time).toISOString();
      card.append(icon, element('strong', event.name), date); return card;
    }));
    $('moon-phase-zone').textContent = (hasVerifiedDates ? 'Phase dates: US Naval Observatory' : (moonDatesLoading ? 'Loading precise phase dates · showing SunCalc estimates' : 'Estimated phase dates: SunCalc · precise dates unavailable; estimates may differ by a day')) + ' · ' + (forecast?.timezone || place.timezone || 'UTC') + '. Symbols are a phase guide; the Moon’s apparent orientation varies.';
    // Sample actual solar altitude across 48 hours: works through local midnight and polar day/night.
    const step = A.HOUR / 4, end = now + 48 * A.HOUR;
    let start = null, finish = null;
    for (let t = now; t <= end; t += step) {
      if (altitude(t) < -18) { if (start === null) start = t; }
      else if (start !== null) { finish = t; break; }
    }
    $('dark-window').textContent = start === null ? 'No astronomical darkness in the next 48h' :
      (start === now ? 'Now' : localTime(start)) + ' – ' + (finish === null ? 'beyond 48h' : localTime(finish)) + ' (approx.)';
  }
  async function loadMoonDates() {
    moonController?.abort();
    const controller = new AbortController(); moonController = controller; moonDatesLoading = true;
    try {
      const data = await json('https://aa.usno.navy.mil/api/moon/phases/date?' + new URLSearchParams({date:new Date().toISOString().slice(0,10), nump:'5'}), controller);
      if (moonController !== controller) return;
      moonEvents = A.parseMoonPhases(data); moonDatesLoading = false; skySummary();
    } catch (_) { if (moonController === controller) { moonDatesLoading = false; skySummary(); } }
  }
  function renderConditions() {
    const c = forecast?.current;
    const row = forecast?.rows.find(row => row.time <= Date.now() && row.time + A.HOUR > Date.now());
    const cards = [
      ['Cloud cover', number(c?.cloud_cover, '%'), 'Less cloud is better'],
      ['Temperature', number(c?.temperature_2m, '°C', 1), 'Modelled near the ground'],
      ['Wind', number(c?.wind_speed_10m, ' km/h'), 'Stronger wind can shake a telescope'],
      ['Humidity', number(c?.relative_humidity_2m, '%'), 'Dew risk: ' + A.dewRisk(row?.temperature_2m, row?.dew_point_2m)]
    ];
    $('conditions').replaceChildren(...cards.map(([label, value, note]) => {
      const card = element('div', undefined, 'condition panel');
      card.append(element('span', label), element('strong', value), element('small', note)); return card;
    }));
  }
  function renderHourly() {
    if (!forecast) return;
    const rows = forecast.rows.filter(row => !$('night-only').checked || altitude(row.time) < -0.833);
    if (!rows.length) { $('hourly').replaceChildren(element('p', 'No night or twilight hours in this forecast. Uncheck the filter to see daylight conditions.', 'empty')); return; }
    const table = element('table'), head = element('thead'), header = element('tr');
    const first = element('th', 'Local time'); first.scope = 'col'; header.append(first);
    rows.forEach(row => {
      const th = element('th', localTime(row.time, {month:undefined, day:undefined})); th.scope = 'col';
      th.append(element('small', localTime(row.time, {hour:undefined, minute:undefined}))); header.append(th);
    });
    head.append(header); table.append(head);
    const body = element('tbody');
    const metrics = [
      ['Outlook', row => A.outlook(row, altitude(row.time))],
      ['Cloud cover', row => number(row.cloud_cover, '%')],
      ['Rain chance', row => number(row.precipitation_probability, '%')],
      ['Wind', row => number(row.wind_speed_10m, ' km/h')],
      ['Temperature', row => number(row.temperature_2m, '°C', 1)],
      ['Dew point', row => number(row.dew_point_2m, '°C', 1)],
      ['Dew risk', row => A.dewRisk(row.temperature_2m, row.dew_point_2m)],
      ['Humidity', row => number(row.relative_humidity_2m, '%')],
      ['Visibility', row => number(Number.isFinite(row.visibility) ? row.visibility / 1000 : null, ' km', 1)],
      ['Moon above horizon', row => S.getMoonPosition(new Date(row.time), place.latitude, place.longitude).altitude > 0 ? 'Yes' : 'No']
    ];
    metrics.forEach(([label, value], i) => {
      const tr = element('tr'), th = element('th', label); th.scope = 'row'; tr.append(th);
      rows.forEach(row => { const text = value(row), td = element('td', text); if (i === 0) td.dataset.outlook = text; tr.append(td); });
      body.append(tr);
    });
    table.append(body); $('hourly').replaceChildren(table);
  }
  async function loadForecast() {
    const version = ++selection;
    forecastController?.abort(); forecastController = new AbortController();
    forecast = null; renderConditions();
    $('hourly').replaceChildren(element('p', 'Loading hourly forecast…', 'empty'));
    $('forecast-status').textContent = 'Loading modelled conditions and forecast…';
    try {
      const data = A.parseForecast(await json(A.forecastURL(place), forecastController));
      if (version !== selection) return;
      forecast = data; checkedAt = Date.now(); renderConditions(); renderHourly(); skySummary(); updateWeatherLink();
      $('forecast-status').textContent = `Open-Meteo · ${data.current ? 'Modelled conditions at ' + localTime(data.current.time * 1000) : 'Current conditions unavailable'} · Forecast retrieved ${localTime(checkedAt)} · ${data.timezone}`;
    } catch (_) {
      if (version !== selection) return;
      $('forecast-status').textContent = 'Forecast unavailable. Check your connection and try Refresh. The sky chart and map work independently.';
      $('hourly').replaceChildren(element('p', 'Hourly forecast unavailable.', 'empty'));
    }
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => done(false), 8000);
      function done(ok) { clearTimeout(timer); img.onload = null; img.onerror = null; if (ok) resolve(img); else { img.src = ''; reject(Error('Chart unavailable')); } }
      img.onload = () => done(true); img.onerror = () => done(false); img.src = url;
    });
  }
  async function loadChart() {
    const version = ++chartVersion, site = selectedSite;
    $('chart-image').replaceChildren();
    $('chart-heading').textContent = site ? site.name + ' Clear Sky Chart' : 'Clear Sky Chart';
    $('chart-site').textContent = site ? [site.bortle || 'Sky rating unavailable', site.distance > 0.1 ? site.distance.toFixed(1) + ' km from ' + place.name : 'Selected observing site'].join(' · ') : 'Choose a chart site from the map or site search.';
    $('chart-source').href = site ? A.chartURL(site) : 'https://test.cleardarksky.com/browse/map.html';
    if (!site) { $('chart-status').textContent = 'No nearby chart selected. Choose a chart site to load its forecast. Weather for your location remains available below.'; return; }
    $('chart-status').textContent = 'Loading ' + site.name + ' Clear Sky Chart…';
    try {
      const img = await loadImage(A.chartURL(site, true) + '?v=' + Math.floor(Date.now() / (15 * 60 * 1000)));
      if (version !== chartVersion) return;
      img.alt = site.name + ' Clear Sky Chart: cloud, transparency, seeing, darkness and observing weather. Open chart details for forecast explanations.';
      const link = element('a'); link.href = A.chartURL(site); link.target = '_blank'; link.rel = 'noopener'; link.append(img);
      $('chart-image').replaceChildren(link);
      $('chart-status').textContent = 'Chart image retrieved ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC. Forecast dates and time zone are printed in the image.';
    } catch (_) {
      if (version === chartVersion) $('chart-status').textContent = 'Chart image unavailable. Try Refresh or open Chart details & legend. The map and local weather work independently.';
    }
  }
  function cancelSearch() { ++searchVersion; searchController?.abort(); $('location-results').replaceChildren(); $('location-results').hidden = true; }
  function selectPlace(next) {
    ++geoVersion; cancelSearch(); $('search-status').textContent = '';
    place = next; forecast = null;
    $('place-name').textContent = place.name;
    $('place-detail').textContent = [place.region, `${place.latitude.toFixed(2)}°, ${place.longitude.toFixed(2)}°`].filter(Boolean).join(' · ');
    updateWeatherLink();
    skySummary(); sitesBrowser.setLocation(place); loadForecast();
  }
  $('location-form').addEventListener('submit', async event => {
    event.preventDefault(); ++geoVersion; cancelSearch();
    const query = $('location-query').value.trim();
    if (query.length < 2) { $('search-status').textContent = 'Enter at least two characters.'; return; }
    const version = searchVersion; searchController = new AbortController();
    $('search-status').textContent = 'Searching locations…';
    try {
      const data = await json('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({name:query, count:'8', language:'en', format:'json'}), searchController);
      if (version !== searchVersion) return;
      const results = W.searchLocations(data);
      $('search-status').textContent = results.length ? 'Choose a location below.' : 'No locations found. Try a nearby town or a different spelling.';
      $('location-results').replaceChildren(...results.map(result => {
        const li = element('li'), button = element('button', result.name + ' · ' + result.region); button.type = 'button';
        button.addEventListener('click', () => selectPlace(result)); li.append(button); return li;
      })); $('location-results').hidden = !results.length;
    } catch (_) { if (version === searchVersion) $('search-status').textContent = 'Location search unavailable. Try again or choose a shortcut.'; }
  });
  $('location-query').addEventListener('input', () => { cancelSearch(); $('search-status').textContent = ''; });
  $('location-query').addEventListener('keydown', event => { if (event.key === 'Escape') cancelSearch(); });
  $('my-location').addEventListener('click', () => {
    cancelSearch(); const version = ++geoVersion;
    if (!navigator.geolocation) { $('search-status').textContent = 'Location access is unavailable. Search for a city instead.'; return; }
    $('search-status').textContent = 'Waiting for location permission…';
    navigator.geolocation.getCurrentPosition(position => {
      if (version !== geoVersion) return;
      const latitude = Number(position.coords.latitude.toFixed(2)), longitude = Number(position.coords.longitude.toFixed(2));
      if (!A.coordinates(latitude, longitude)) { $('search-status').textContent = 'Location unavailable. Search for a city instead.'; return; }
      selectPlace({name:'My location', region:'Approximate coordinates', latitude, longitude, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
    }, () => { if (version === geoVersion) $('search-status').textContent = 'Location access was denied or unavailable. Search for a city or use a shortcut.'; }, {timeout:12000, maximumAge:300000, enableHighAccuracy:false});
  });
  document.querySelectorAll('[data-place]').forEach(button => button.addEventListener('click', () => selectPlace(presets[button.dataset.place])));
  $('night-only').addEventListener('change', renderHourly);

  function refresh() { skySummary(); loadForecast(); loadChart(); loadMoonDates(); }
  $('refresh').addEventListener('click', refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - checkedAt > 15 * 60 * 1000) refresh(); });
  sitesBrowser = window.GregleAstroSites.create({
    onSelect: site => selectPlace({name:site.name, region:'Clear Sky Chart observing site', latitude:site.latitude, longitude:site.longitude, timezone:'UTC', site}),
    onChart: site => { selectedSite = site; loadChart(); }
  });
  selectPlace(place);
  loadMoonDates();
})();
