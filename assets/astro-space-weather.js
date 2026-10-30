(() => {
  'use strict';
  const C = window.GregleSpaceWeatherCore;
  const $ = id => document.getElementById(id);
  if (!C || !$('space-weather')) return;
  const base = 'https://services.swpc.noaa.gov/';
  const refreshEvery = 5 * 60000;
  const endpoints = {
    kp:'json/planetary_k_index_1m.json',
    wind:'json/rtsw/rtsw_wind_1m.json',
    magnetic:'json/rtsw/rtsw_mag_1m.json',
    forecast:'products/noaa-planetary-k-index-forecast.json'
  };
  let lastAttempt = 0, running = false, controllers = [], hemisphere = 'north', mapVersion = 0;
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function utc(time, date = true) {
    return new Intl.DateTimeFormat('en-GB', {timeZone:'UTC', ...(date ? {month:'short', day:'numeric'} : {}), hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(time) + ' UTC';
  }
  function metric(id, value, detail) { $('sw-' + id).textContent = value; $('sw-' + id + '-detail').textContent = detail; }
  function unavailable(key) {
    const ids = {kp:['kp'], wind:['speed','density'], magnetic:['bz']}[key];
    for (const id of ids || []) metric(id, '—', 'Recent reading unavailable');
    if (key === 'forecast') {
      $('aurora-days').replaceChildren();
      $('aurora-intervals').replaceChildren(el('p', 'Forecast unavailable. Open NOAA’s full forecast using the link above.', 'empty'));
      $('aurora-forecast-status').textContent = 'Current NOAA forecast unavailable. Please try refreshing.';
    }
  }
  function renderForecast(data) {
    const parsed = C.forecast(data);
    const cards = parsed.days.map(day => {
      const card = el('div', undefined, 'aurora-day');
      card.append(el('h4', new Intl.DateTimeFormat('en-GB', {timeZone:'UTC', weekday:'short', month:'short', day:'numeric'}).format(new Date(day.date + 'T12:00:00Z')) + ' · UTC'));
      card.append(el('strong', 'Kp ' + day.peak.toFixed(2)), el('p', C.activity(day.peak)), el('p', 'Peak interval starts ' + utc(day.peakTime, false)));
      return card;
    });
    $('aurora-days').replaceChildren(...cards);
    const table = el('table');
    table.append(el('caption', 'Global Kp estimates and predictions · each interval lasts three hours.'));
    const head = el('thead'), body = el('tbody'), headings = el('tr');
    for (const text of ['Interval starts · UTC','Kp','Guidance']) { const cell = el('th', text); cell.scope = 'col'; headings.append(cell); }
    head.append(headings);
    for (const row of parsed.rows) {
      const tr = el('tr'), time = el('th', utc(row.time)); time.scope = 'row';
      const value = el('td', row.kp.toFixed(2)); value.dataset.storm = String(row.kp >= 5 - 1 / 3);
      tr.append(time, value, el('td', row.kind === 'predicted' ? 'Forecast' : 'Estimate')); body.append(tr);
    }
    table.append(head, body); $('aurora-intervals').replaceChildren(table);
    $('aurora-forecast-status').textContent = 'Retrieved ' + utc(Date.now()) + ' · dates and intervals shown in UTC.';
  }
  async function read(key) {
    const controller = new AbortController(); controllers.push(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(base + endpoints[key], {signal:controller.signal, credentials:'omit'});
      if (!response.ok) throw new Error('NOAA data unavailable');
      const data = await response.json();
      if (document.hidden || controller.signal.aborted) throw new Error('Refresh interrupted');
      if (key === 'forecast') { renderForecast(data); return; }
      const row = C[key](data), time = utc(row.time);
      if (key === 'kp') metric('kp', row.estimated_kp.toFixed(2), C.activity(row.estimated_kp) + ' · ' + time);
      if (key === 'wind') {
        metric('speed', Math.round(row.proton_speed) + ' km/s', time);
        metric('density', row.proton_density.toFixed(1) + ' /cm³', time);
      }
      if (key === 'magnetic') metric('bz', row.bz_gsm.toFixed(1) + ' nT', (row.bz_gsm < 0 ? 'Southward' : row.bz_gsm > 0 ? 'Northward' : 'Neutral') + ' · ' + time);
    } catch (error) { unavailable(key); throw error; }
    finally { clearTimeout(timer); }
  }
  function loadMap() {
    const version = ++mapVersion, image = $('aurora-map-image');
    const name = hemisphere === 'north' ? 'Northern' : 'Southern';
    const url = base + 'images/animations/ovation/' + hemisphere + '/latest.jpg';
    image.hidden = false;
    image.alt = 'NOAA OVATION short-term aurora forecast for the ' + name + ' hemisphere; forecast time and colour scale are printed on the map';
    $('aurora-map-link').href = url;
    $('aurora-map-status').textContent = 'Loading ' + name.toLowerCase() + ' auroral oval…';
    image.onload = () => {
      if (version !== mapVersion) return;
      image.hidden = false;
      $('aurora-map-status').textContent = 'NOAA OVATION · ' + name + ' hemisphere. Forecast time and colour scale are printed on the map.';
    };
    image.onerror = () => {
      if (version !== mapVersion) return;
      image.hidden = true;
      $('aurora-map-status').textContent = 'Aurora map unavailable. Open the NOAA aurora forecast using the link above.';
    };
    image.src = url + '?v=' + Math.floor(Date.now() / refreshEvery);
  }
  async function refresh(force = false) {
    if (document.hidden || running || (!force && Date.now() - lastAttempt < refreshEvery)) return;
    lastAttempt = Date.now(); running = true;
    $('space-weather-refresh').disabled = true;
    $('space-weather-status').textContent = 'Refreshing NOAA observations…';
    loadMap();
    const results = await Promise.allSettled(Object.keys(endpoints).map(read));
    const failed = results.slice(0, 3).filter(result => result.status === 'rejected').length;
    $('space-weather-status').textContent = failed === 3 ? 'Recent NOAA readings unavailable. Try refreshing or open the source links below.' :
      (failed ? 'Some readings are unavailable. ' : 'NOAA observations · ') + 'Checked ' + utc(Date.now()) + '. Times below are observation times.';
    running = false; controllers = []; $('space-weather-refresh').disabled = false;
    if (!document.hidden && lastAttempt === 0) refresh();
  }
  $('space-weather-refresh').addEventListener('click', () => refresh(true));
  $('aurora-hemisphere').addEventListener('change', event => {
    hemisphere = event.target.value === 'south' ? 'south' : 'north'; loadMap();
  });
  window.GregleSpaceWeather = {setLocation(place) {
    const next = place.latitude < 0 ? 'south' : 'north';
    if (next === hemisphere) return;
    hemisphere = next; $('aurora-hemisphere').value = next; loadMap();
  }};
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { controllers.forEach(controller => controller.abort()); lastAttempt = 0; }
    else refresh();
  });
  setInterval(() => refresh(), refreshEvery);
  refresh();
})();
