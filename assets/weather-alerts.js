(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleWeatherAlerts = api.createController(root);
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const REFRESH_MS = 5 * 60 * 1000;
  const UK_REFRESH_MS = 2 * 60 * 1000;
  const UK_WARNINGS_URL = 'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings';
  const UK_SERVICE = 'https://services.arcgis.com/Lq3V5RFuTBC9I7kv/arcgis/rest/services/Met_Office_National_Severe_Weather_Warning_Service_Live/FeatureServer/0/query';
  const UK_FIELDS = ['OBJECTID', 'weathertype', 'warninglevel', 'warningheadline', 'issuedDate', 'validfromdate', 'validtodate', 'affectedAreas', 'whatToExpect', 'warningFurtherDetails', 'warningUpdateDescription'];
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

  function ukAlertsURL(location) {
    if (!Number.isFinite(location?.latitude) || Math.abs(location.latitude) > 90 ||
        !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) throw Error('Invalid warning location');
    return UK_SERVICE + '?' + new URLSearchParams({
      f:'json', where:'1=1', geometry:`${location.longitude},${location.latitude}`,
      geometryType:'esriGeometryPoint', inSR:'4326', spatialRel:'esriSpatialRelIntersects',
      outFields:UK_FIELDS.join(','), returnGeometry:'false'
    });
  }
  function ukAlerts(data, now = Date.now()) {
    if (data?.error || data?.exceededTransferLimit || !Array.isArray(data?.features) ||
        data.objectIdFieldName !== 'OBJECTID') throw Error('UK warning data unavailable');
    // ArcGIS omits field definitions when the spatial query matches no warnings.
    if (!data.features.length) return [];
    if (!Array.isArray(data.fields) || !UK_FIELDS.every(name => data.fields.some(field => field.name === name))) throw Error('UK warning fields unavailable');
    const seen = new Set(), colours = {yellow:1, amber:2, red:3};
    return data.features.flatMap(feature => {
      const item = feature?.attributes;
      const colour = typeof item?.warninglevel === 'string' ? item.warninglevel.toLowerCase() : '';
      const title = item?.warningheadline, weatherType = item?.weathertype;
      const issued = item?.issuedDate, starts = item?.validfromdate, expires = item?.validtodate;
      if (!Object.hasOwn(colours, colour) || typeof title !== 'string' || !title.trim() ||
          typeof weatherType !== 'string' || !weatherType.trim()) throw Error('Unrecognised UK warning');
      if (![issued, starts, expires].every(value => Number.isFinite(value) && value > 0) ||
          expires <= starts || expires <= issued || issued - now > 5 * 60 * 1000) throw Error('Invalid UK warning dates');
      const details = [['What to expect', item.whatToExpect], ['Further details', item.warningFurtherDetails],
        ['Affected areas', item.affectedAreas], ['Why this warning was updated', item.warningUpdateDescription]];
      if (details.some(([, text]) => text != null && typeof text !== 'string')) throw Error('Invalid UK warning details');
      if (expires <= now) return [];
      const key = [title, colour, weatherType, issued, starts, expires].join('|');
      if (seen.has(key)) return [];
      seen.add(key);
      return [{title, type:'warning', colour, weatherType, issued, starts, expires,
        url:UK_WARNINGS_URL, details:details.filter(([, text]) => text?.trim())}];
    }).sort((a, b) => colours[b.colour] - colours[a.colour] || b.issued - a.issued);
  }

  function createController(win) {
    const doc = win.document, section = doc.getElementById('weatherAlerts');
    const list = doc.getElementById('weatherAlertList'), note = doc.getElementById('weatherAlertStatus');
    let location, station, directory, alerts = [], version = 0, controller, timer, lastCheck = 0;
    const now = () => win.Date.now();
    const isUK = () => location?.country === 'GB';
    const supported = () => ['CA', 'GB'].includes(location?.country);
    const refreshPeriod = () => isUK() ? UK_REFRESH_MS : REFRESH_MS;
    const locationURL = () => isUK() ? UK_WARNINGS_URL : 'https://weather.gc.ca/en/location/index.html?coords=' + encodeURIComponent(`${location.latitude},${location.longitude}`);
    function clear() { alerts = []; list.replaceChildren(); section.hidden = true; }
    function stop() { version++; controller?.abort(); controller = null; win.clearTimeout(timer); }
    function timestamp(value) {
      return new win.Date(value).toLocaleString('en-CA', {month:'short', day:'numeric', hour:'2-digit',hourCycle:'h23', minute:'2-digit', timeZoneName:'short', timeZone:location.timezone || (isUK() ? 'Europe/London' : 'America/Vancouver')});
    }
    function render() {
      alerts = alerts.filter(alert => alert.expires > now());
      const cards = alerts.map(alert => {
        const card = doc.createElement('article'); card.className = 'weather-alert weather-alert--' + alert.colour;
        const badge = doc.createElement('p'); badge.className = 'weather-alert-badge';
        badge.textContent = (alert.colour === 'neutral' ? '' : alert.colour + ' ') + alert.type;
        if (alert.weatherType) badge.textContent += ' · ' + alert.weatherType;
        const title = doc.createElement('h3'); title.textContent = alert.title;
        const dates = doc.createElement('p'); dates.className = 'weather-alert-dates'; dates.textContent = 'Issued ' + timestamp(alert.issued);
        if (alert.starts) dates.textContent += ' · Valid ' + timestamp(alert.starts) + ' – ' + timestamp(alert.expires);
        const link = doc.createElement('a'); link.className = 'weather-alert-link'; link.href = alert.url || locationURL();
        link.textContent = isUK() ? 'Read the Met Office warning ↗' : 'Read the Environment Canada alert ↗';
        card.append(badge, title, dates, link);
        if (alert.details?.length) {
          const details = doc.createElement('details'), summary = doc.createElement('summary');
          details.className = 'weather-alert-details'; summary.textContent = 'Warning details'; details.append(summary);
          for (const [label, text] of alert.details) {
            const heading = doc.createElement('h4'), content = doc.createElement('p');
            heading.textContent = label; content.textContent = text; details.append(heading, content);
          }
          card.append(details);
        }
        return card;
      });
      list.replaceChildren(...cards); section.hidden = cards.length === 0;
      doc.getElementById('weatherAlertLocation').textContent = (isUK() ? 'Met Office Weather Warnings' : 'Environment Canada') + ' · ' + (station?.name || location.name);
      doc.getElementById('weatherAlertChecked').textContent = lastCheck ? 'Checked ' + timestamp(lastCheck) : '';
      doc.getElementById('ukWarningSource').hidden = !isUK();
      if (isUK()) {
        const years = [...new Set(alerts.map(alert => new win.Date(alert.issued).getUTCFullYear()))].sort().join(', ');
        doc.getElementById('ukWarningCopyright').textContent = years ? 'UK: © Crown copyright ' + years + ', Met Office. Outside the UK: © British Crown copyright ' + years + ', Met Office.' : '';
      }
    }
    function unavailable() {
      clear();
      note.replaceChildren(); note.hidden = false;
      const message = doc.createElement('span'); message.textContent = 'Weather alerts could not be checked. ';
      const link = doc.createElement('a'); link.href = locationURL(); link.textContent = isUK() ? 'Check Met Office warnings ↗' : 'Check Environment Canada ↗';
      note.append(message, link);
    }
    function schedule() {
      win.clearTimeout(timer);
      if (doc.hidden || !supported()) return;
      // Wake at the first expiry as well as the provider's refresh interval, including when offline.
      const period = refreshPeriod();
      const untilExpiry = alerts.length ? Math.min(...alerts.map(alert => alert.expires - now())) : period;
      timer = win.setTimeout(refresh, Math.max(1, Math.min(period, untilExpiry)));
    }
    async function fetchJSON(url, signal) {
      const response = await win.fetch(url, {signal, cache:'no-store'});
      if (!response.ok) throw Error('Warning service unavailable');
      return response.json();
    }
    async function refresh() {
      stop();
      if (!supported() || doc.hidden) return;
      const current = version, selected = location;
      if (lastCheck && now() - lastCheck > refreshPeriod()) clear(); else render();
      const request = new win.AbortController(); controller = request;
      const timeout = win.setTimeout(() => request.abort(), 15000);
      try {
        let forecastStation = station;
        let active;
        if (isUK()) {
          const data = await fetchJSON(ukAlertsURL(selected), request.signal);
          if (current !== version) return;
          active = ukAlerts(data, now());
        } else {
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
          active = activeAlerts(data, now());
        }
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
  return {activeAlerts, officialURL, ukAlerts, ukAlertsURL, createController, REFRESH_MS, UK_REFRESH_MS};
});
