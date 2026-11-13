(function (win) {
  'use strict';
  const chip = win.document.getElementById('weatherChip');
  const badge = chip?.querySelector('.weather-alert-indicator');
  const core = win.GregleWeatherAlertsCore;
  if (!badge || !core) return;
  let location, key, version = 0, request, timer, expiry, directory, station, alerts = [], baseLabel, baseTitle;
  function render() {
    if (!baseLabel) return;
    alerts = alerts.filter(alert => alert.expires > win.Date.now());
    badge.hidden = !alerts.length;
    badge.dataset.colour = alerts[0]?.colour || 'neutral';
    const summary = alerts.map(alert => alert.title).join('; ');
    chip.title = baseTitle + (summary ? ' · ' + summary : '');
    chip.setAttribute('aria-label', baseLabel + (summary ? ' · Weather alerts: ' + summary : ''));
    win.clearTimeout(expiry);
    if (alerts.length) expiry = win.setTimeout(render, Math.max(1, Math.min(...alerts.map(alert => alert.expires - win.Date.now()))));
  }
  function stop() {
    version++; request?.abort(); request = null; win.clearTimeout(timer); win.clearTimeout(expiry);
  }
  async function json(url, signal) {
    const response = await win.fetch(url, {signal, cache:'no-store'});
    if (!response.ok) throw Error('Weather alerts unavailable');
    return response.json();
  }
  async function refresh() {
    stop(); alerts = []; render();
    if (!location || win.document.hidden) return;
    const token = version, selected = location;
    const controller = new win.AbortController(); request = controller; const signal = controller.signal;
    const timeout = win.setTimeout(() => controller.abort(), 15000);
    try {
      if (!selected.country) {
        const data = await json('https://api.bigdatacloud.net/data/reverse-geocode-client?' + new URLSearchParams({latitude:selected.latitude, longitude:selected.longitude, localityLanguage:'en'}), signal);
        if (token !== version) return;
        selected.country = data.countryCode;
      }
      let active;
      if (selected.country === 'GB') active = core.ukAlerts(await json(core.ukAlertsURL(selected), signal), win.Date.now());
      else if (selected.country === 'CA') {
        if (!station) {
          const cities = directory || await json('https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&limit=1000&properties=identifier,name.en,name.fr', signal);
          if (token !== version) return;
          directory = cities; station = win.GregleWeather.nearestStation(cities, selected);
          if (station.id === 'bc-85') station = {...station, id:'bc-75'};
        }
        active = core.activeAlerts(await json('https://api.weather.gc.ca/collections/citypageweather-realtime/items/' + station.id + '?f=json', signal), win.Date.now());
      } else return;
      if (token === version) { alerts = active; render(); }
    } catch (_) { if (token === version) { alerts = []; render(); } }
    finally {
      win.clearTimeout(timeout);
      if (token === version) {
        request = null;
        if (['CA','GB'].includes(selected.country) || !selected.country) timer = win.setTimeout(refresh, selected.country === 'GB' ? core.UK_REFRESH_MS : core.REFRESH_MS);
      }
    }
  }
  win.GregleHomeWeatherAlerts = {setLocation(selected) {
    baseLabel = chip.getAttribute('aria-label'); baseTitle = chip.title;
    const next = [selected.latitude, selected.longitude].join(',');
    if (next === key) { render(); return; }
    key = next; location = {...selected}; station = null;
    return refresh();
  }};
  win.document.addEventListener('visibilitychange', () => {
    if (win.document.hidden) { stop(); alerts = []; render(); }
    else refresh();
  });
  win.addEventListener('pagehide', stop);
  win.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
})(window);
