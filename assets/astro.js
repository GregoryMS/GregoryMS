(() => {
  'use strict';
  const A = window.GregleAstro, W = window.GregleWeather, S = window.SunCalc;
  const $ = id => document.getElementById(id);
  const presets = {
    vancouver: {name:'Vancouver', region:'British Columbia, Canada', latitude:49.28, longitude:-123.12, timezone:'America/Vancouver', country:'CA'},
    victoria: {name:'Victoria', region:'British Columbia, Canada', latitude:48.43, longitude:-123.37, timezone:'America/Vancouver', country:'CA'},
    chilliwack: {name:'Chilliwack', region:'British Columbia, Canada', latitude:49.16, longitude:-121.95, timezone:'America/Vancouver', country:'CA'}
  };
  let place = presets.vancouver, forecast = null, forecastController, searchController;
  let selection = 0, searchVersion = 0, chartVersion = 0, geoVersion = 0, checkedAt = 0;
  const number = (value, suffix = '', decimals = 0) => Number.isFinite(value) ? value.toFixed(decimals) + suffix : '—';
  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function localTime(time, options = {}) {
    return new Intl.DateTimeFormat('en-CA', {timeZone: forecast?.timezone || place.timezone || 'UTC', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', ...options}).format(new Date(time));
  }
  function altitude(time) { return S.getPosition(new Date(time), place.latitude, place.longitude).altitude * 180 / Math.PI; }
  function updateWeatherLink() {
    $('weather-link').href = 'weather.html?' + new URLSearchParams({lat:place.latitude, lon:place.longitude, name:place.name, country:place.country || '', tz:forecast?.timezone || place.timezone || 'UTC'});
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
    $('sky-now').textContent = sun < -18 ? 'Astronomical darkness' : sun < -0.833 ? 'Twilight' : 'Daylight';
    $('moon').textContent = number(moon.fraction * 100, '%') + (moon.phase < 0.5 ? ' · waxing' : ' · waning');
    $('moon-up').textContent = S.getMoonPosition(new Date(now), place.latitude, place.longitude).altitude > 0 ? 'Yes' : 'No';
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
    const version = ++chartVersion, kind = $('chart-kind').value;
    const sources = {cloud:'clds_vis_e.html', seeing:'seeing_e.html', transparency:'transparence_e.html'};
    $('chart-source').href = 'https://weather.gc.ca/astro/' + sources[kind];
    $('chart-image').replaceChildren();
    const candidates = A.chartCandidates(place, kind, Number($('chart-offset').value));
    if (!candidates.length) { $('chart-status').textContent = 'This location is outside the supported North American chart area. Worldwide conditions and the dark sky map are still available.'; return; }
    $('chart-status').textContent = 'Loading the official Environment Canada chart…';
    for (const candidate of candidates) {
      try {
        const img = await loadImage(candidate.url);
        if (version !== chartVersion) return;
        const region = kind === 'cloud' ? ({northwest:'Northwestern', northeast:'Northeastern', southwest:'Southwestern', southeast:'Southeastern'}[A.chartRegion(place)]) + ' North America' : 'North America';
        img.alt = `Environment Canada ${kind} forecast for ${region}, valid ${localTime(candidate.valid)}. Open the official chart for its explanation.`;
        const link = element('a'); link.href = candidate.url; link.target = '_blank'; link.rel = 'noopener'; link.append(img);
        $('chart-image').replaceChildren(link);
        $('chart-status').textContent = `${region} · Valid ${localTime(candidate.valid)} · Model run ${new Date(candidate.run).toISOString().slice(0, 16).replace('T', ' ')} UTC. Select the image to enlarge.`;
        return;
      } catch (_) { if (version !== chartVersion) return; }
    }
    $('chart-status').textContent = 'Chart image unavailable for this time. Try another time or open the official chart above.';
  }
  function updateMap() {
    const url = A.mapURL(place); $('map-link').href = url; $('map-place').textContent = place.name;
    const iframe = element('iframe'); iframe.title = 'Interactive light pollution map around ' + place.name;
    iframe.loading = 'lazy'; iframe.referrerPolicy = 'no-referrer'; iframe.src = url;
    $('map-container').replaceChildren(iframe);
  }
  function cancelSearch() { ++searchVersion; searchController?.abort(); $('location-results').replaceChildren(); $('location-results').hidden = true; }
  function selectPlace(next) {
    ++geoVersion; cancelSearch(); $('search-status').textContent = '';
    place = next; forecast = null;
    $('place-name').textContent = place.name;
    $('place-detail').textContent = [place.region, `${place.latitude.toFixed(2)}°, ${place.longitude.toFixed(2)}°`].filter(Boolean).join(' · ');
    updateWeatherLink();
    skySummary(); updateMap(); loadForecast(); loadChart();
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
  $('chart-kind').addEventListener('change', loadChart); $('chart-offset').addEventListener('change', loadChart);
  function refresh() { skySummary(); loadForecast(); loadChart(); }
  $('refresh').addEventListener('click', refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - checkedAt > 15 * 60 * 1000) refresh(); });
  selectPlace(place);
})();
