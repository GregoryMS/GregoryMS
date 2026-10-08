(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleWeatherAlerts = api.createController(root);
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const REFRESH_MS = 5 * 60 * 1000;
  const COLOURS = {red: 3, orange: 2, yellow: 1, neutral: 0};
  const english = value => typeof value === 'string' ? value : value?.en;
  function officialURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && /^(www\.)?(weather|meteo)\.gc\.ca$/.test(url.hostname) && !url.username && !url.password) return url.href;
    } catch (_) { /* Use the location's official forecast link instead. */ }
    return null;
  }
  function activeAlerts(data, now = Date.now()) {
    const properties = data?.properties;
    if (!Array.isArray(properties?.warnings)) throw Error('Alert data unavailable');
    const updated = Date.parse(properties.lastUpdated);
    if (!Number.isFinite(updated) || now - updated > 2 * 60 * 60 * 1000 || updated - now > 5 * 60 * 1000) throw Error('Alert feed is out of date');
    const seen = new Set();
    return properties.warnings.flatMap(item => {
      const type = String(english(item?.type) || '').toLowerCase();
      const title = english(item?.description);
      if (/^(ended|cancelled|canceled)$/.test(type) || /\b(ended|cancelled|canceled)\b/i.test(title || '')) return [];
      if (!['warning', 'watch', 'advisory', 'statement'].includes(type) || typeof title !== 'string' || !title.trim()) throw Error('Unrecognised alert');
      const issued = Date.parse(english(item.eventIssue)), expires = Date.parse(english(item.expiryTime));
      if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || issued - now > 5 * 60 * 1000) throw Error('Invalid alert dates');
      if (expires <= now) return [];
      // The official colour is independent of whether this is a watch or warning.
      const suppliedColour = String(english(item.alertColourLevel) || '').toLowerCase();
      const titleColour = title.match(/^(yellow|orange|red)\b/i)?.[1]?.toLowerCase();
      const colour = type === 'statement' ? 'neutral' :
        Object.hasOwn(COLOURS, suppliedColour) ? suppliedColour : titleColour || 'neutral';
      const url = officialURL(english(item.url));
      const key = [title, issued, url].join('|');
      if (seen.has(key)) return [];
      seen.add(key);
      return [{title, type, colour, issued, expires, url}];
    }).sort((a, b) => COLOURS[b.colour] - COLOURS[a.colour] || b.issued - a.issued);
  }

  function createController(win) {
    const doc = win.document, section = doc.getElementById('weatherAlerts');
    const list = doc.getElementById('weatherAlertList'), note = doc.getElementById('weatherAlertStatus');
    let location, station, directory, alerts = [], version = 0, controller, timer, lastCheck = 0;
    const now = () => win.Date.now();
    const locationURL = () => 'https://weather.gc.ca/en/location/index.html?coords=' + encodeURIComponent(`${location.latitude},${location.longitude}`);
    function clear() { alerts = []; list.replaceChildren(); section.hidden = true; }
    function stop() { version++; controller?.abort(); controller = null; win.clearTimeout(timer); }
    function timestamp(value) {
      return new win.Date(value).toLocaleString('en-CA', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short', timeZone:location.timezone || 'America/Vancouver'});
    }
    function render() {
      alerts = alerts.filter(alert => alert.expires > now());
      const cards = alerts.map(alert => {
        const card = doc.createElement('article'); card.className = 'weather-alert weather-alert--' + alert.colour;
        const badge = doc.createElement('p'); badge.className = 'weather-alert-badge';
        badge.textContent = (alert.colour === 'neutral' ? '' : alert.colour + ' ') + alert.type;
        const title = doc.createElement('h3'); title.textContent = alert.title;
        const dates = doc.createElement('p'); dates.className = 'weather-alert-dates'; dates.textContent = 'Issued ' + timestamp(alert.issued);
        const link = doc.createElement('a'); link.className = 'weather-alert-link'; link.href = alert.url || locationURL();
        link.textContent = 'Read the Environment Canada alert ↗';
        card.append(badge, title, dates, link); return card;
      });
      list.replaceChildren(...cards); section.hidden = cards.length === 0;
      doc.getElementById('weatherAlertLocation').textContent = 'Environment Canada · ' + (station?.name || location.name);
      doc.getElementById('weatherAlertChecked').textContent = lastCheck ? 'Checked ' + timestamp(lastCheck) : '';
    }
    function unavailable() {
      clear();
      note.replaceChildren(); note.hidden = false;
      const message = doc.createElement('span'); message.textContent = 'Weather alerts could not be checked. ';
      const link = doc.createElement('a'); link.href = locationURL(); link.textContent = 'Check Environment Canada ↗';
      note.append(message, link);
    }
    function schedule() {
      win.clearTimeout(timer);
      if (doc.hidden || location?.country !== 'CA') return;
      // Wake at the first expiry as well as every five minutes, including when offline.
      const untilExpiry = alerts.length ? Math.min(...alerts.map(alert => alert.expires - now())) : REFRESH_MS;
      timer = win.setTimeout(refresh, Math.max(1, Math.min(REFRESH_MS, untilExpiry)));
    }
    async function fetchJSON(url, signal) {
      const response = await win.fetch(url, {signal, cache:'no-store'});
      if (!response.ok) throw Error('Environment Canada unavailable');
      return response.json();
    }
    async function refresh() {
      stop();
      if (!location || location.country !== 'CA' || doc.hidden) return;
      const current = version, selected = location;
      if (lastCheck && now() - lastCheck > REFRESH_MS) clear(); else render();
      const request = new win.AbortController(); controller = request;
      const timeout = win.setTimeout(() => request.abort(), 15000);
      try {
        let forecastStation = station;
        if (!forecastStation) {
          if (selected.id) forecastStation = selected;
          else {
            let cities = directory;
            if (!cities) cities = await fetchJSON('https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&limit=1000&properties=identifier,name.en,name.fr', request.signal);
            if (current !== version) return;
            forecastStation = win.GregleWeather.nearestStation(cities, selected); directory = cities;
            if (forecastStation.id === 'bc-85') forecastStation = {...forecastStation, id:'bc-75', name:'Victoria Harbour'};
          }
        }
        const data = await fetchJSON('https://api.weather.gc.ca/collections/citypageweather-realtime/items/' + forecastStation.id + '?f=json', request.signal);
        if (current !== version) return;
        const active = activeAlerts(data, now());
        station = forecastStation; alerts = active; lastCheck = now(); note.hidden = true; note.replaceChildren(); render();
      } catch (_) { if (current === version) unavailable(); }
      finally { win.clearTimeout(timeout); if (current === version) { controller = null; schedule(); } }
    }
    function setLocation(selected) {
      stop(); clear(); note.hidden = true; note.replaceChildren(); station = null; lastCheck = 0;
      location = {...selected};
      return refresh();
    }
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) stop(); else refresh();
    });
    return {setLocation, refresh};
  }
  return {activeAlerts, officialURL, createController, REFRESH_MS};
});
