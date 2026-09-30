(function (root) {
  'use strict';
  const HOUR = 3600000;
  const fields = ['cloud_cover', 'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m', 'precipitation_probability', 'visibility'];
  const coordinates = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  function forecastURL(place) {
    if (!coordinates(place.latitude, place.longitude)) throw Error('Invalid coordinates');
    const params = new URLSearchParams({latitude: place.latitude.toFixed(2), longitude: place.longitude.toFixed(2),
      current: 'temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m', hourly: fields.join(','),
      timeformat: 'unixtime', timezone: 'auto', forecast_days: '4'});
    return 'https://api.open-meteo.com/v1/forecast?' + params;
  }
  function parseForecast(data, now = Date.now()) {
    const h = data?.hourly;
    if (data?.error || !h || !Array.isArray(h.time) || !h.time.length || !data.timezone) throw Error('Incomplete forecast');
    new Intl.DateTimeFormat('en', {timeZone: data.timezone});
    if (fields.some(key => !Array.isArray(h[key]) || h[key].length !== h.time.length)) throw Error('Incomplete hourly data');
    if (h.time.some((t, i) => !Number.isFinite(t) || (i && t <= h.time[i - 1]))) throw Error('Invalid forecast times');
    const rows = h.time.map((t, i) => Object.fromEntries([['time', t * 1000], ...fields.map(key => [key, Number.isFinite(h[key][i]) ? h[key][i] : null])]))
      .filter(row => row.time >= Math.floor(now / HOUR) * HOUR && row.time < Math.floor(now / HOUR) * HOUR + 48 * HOUR);
    if (!rows.length) throw Error('Forecast is out of date');
    const c = data.current;
    const current = c && Number.isFinite(c.time) && Math.abs(c.time * 1000 - now) <= 2 * HOUR ? c : null;
    return {rows, current, timezone: data.timezone};
  }
  function dewRisk(temp, dew) {
    if (!Number.isFinite(temp) || !Number.isFinite(dew)) return 'Unknown';
    return temp - dew <= 2 ? 'High' : temp - dew <= 4 ? 'Moderate' : 'Low';
  }
  function outlook(row, sunAltitude) {
    if (!Number.isFinite(sunAltitude)) return 'Unknown';
    if (sunAltitude > -18) return sunAltitude >= -0.833 ? 'Daylight' : 'Twilight';
    if ([row.cloud_cover, row.wind_speed_10m, row.precipitation_probability].some(v => !Number.isFinite(v))) return 'Unknown';
    if (row.cloud_cover > 60 || row.precipitation_probability >= 50 || row.wind_speed_10m > 30) return 'Poor';
    if (row.cloud_cover > 25 || row.precipitation_probability >= 20 || row.wind_speed_10m > 15) return 'Mixed';
    return 'Promising';
  }
  function parseSites(data) {
    if (data?.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(data.updated) || !Array.isArray(data.sites) || !data.sites.length) throw Error('Invalid chart directory');
    const seen = new Set();
    return data.sites.map(row => {
      if (!Array.isArray(row) || row.length !== 6) throw Error('Invalid chart site');
      const [key, name, latitude, longitude, bortle, color] = row;
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(key) || seen.has(key) || typeof name !== 'string' || !name.trim() || !coordinates(latitude, longitude) || typeof bortle !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw Error('Invalid chart site');
      seen.add(key); return {key, name, latitude, longitude, bortle, color};
    });
  }
  function distance(a, b) {
    const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function nearbySites(sites, place, limit = 12) {
    if (!coordinates(place.latitude, place.longitude)) return [];
    return sites.map(site => ({...site, distance: distance(place, site)})).filter(site => site.distance <= 200).sort((a, b) => a.distance - b.distance).slice(0, limit);
  }
  function searchSites(sites, query) {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return sites.filter(site => tokens.every(token => (site.name + ' ' + site.key).toLowerCase().includes(token)))
      .sort((a, b) => a.name.toLowerCase().indexOf(tokens[0]) - b.name.toLowerCase().indexOf(tokens[0]) || a.name.localeCompare(b.name)).slice(0, 20);
  }
  function chartURL(site, image = false) {
    if (!site || !/^[A-Za-z0-9_-]{1,80}$/.test(site.key)) throw Error('Invalid chart key');
    return 'https://test.cleardarksky.com/c/' + site.key + (image ? '/chart.gif' : '.html');
  }
  function riseSetTimes(now, place, timezone, sunCalc) {
    const day = new Intl.DateTimeFormat('en-CA', {timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit'});
    const today = day.format(new Date(now));
    const events = {sunrise:null, sunset:null, moonrise:null, moonset:null};
    // Scan neighbouring UTC days, then keep events on the selected location's date.
    // This avoids using the browser's midnight and handles 23/25-hour local days.
    const utcDay = Math.floor(now / (24 * HOUR)) * 24 * HOUR;
    for (let offset = -2; offset <= 2; offset++) {
      const date = new Date(utcDay + offset * 24 * HOUR);
      const sun = sunCalc.getTimes(date, place.latitude, place.longitude);
      const moon = sunCalc.getMoonTimes(date, place.latitude, place.longitude, true);
      for (const [key, value] of Object.entries({sunrise:sun.sunrise, sunset:sun.sunset, moonrise:moon.rise, moonset:moon.set})) {
        const time = value?.getTime();
        if (Number.isFinite(time) && day.format(value) === today && (events[key] === null || time < events[key])) events[key] = time;
      }
    }
    return events;
  }
  const moonPhases = [
    'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'
  ];
  function moonPhase(phase) {
    const index = Math.round(((phase % 1 + 1) % 1) * 8) % 8;
    return {name:moonPhases[index], phase:index / 8};
  }
  function upcomingMoonPhases(now, illumination) {
    // Follow SunCalc's phase through the new-moon wrap, then refine each quarter crossing.
    // These are planning estimates; the bundled low-precision model is not an ephemeris.
    const phaseAt = time => illumination(new Date(time)).phase;
    const events = [], step = 6 * HOUR;
    let previous = phaseAt(now), cycle = 0, target = (Math.floor(previous * 4) + 1) / 4;
    for (let time = now + step; time <= now + 35 * 24 * HOUR && events.length < 4; time += step) {
      const phase = phaseAt(time);
      if (phase < previous - 0.5) cycle++;
      if (phase + cycle >= target) {
        let low = time - step, high = time;
        const lowPhase = previous, lowCycle = cycle - (phase < previous - 0.5 ? 1 : 0);
        while (high - low > 60000) {
          const mid = (low + high) / 2, value = phaseAt(mid);
          const unwrapped = value + lowCycle + (value < lowPhase - 0.5 ? 1 : 0);
          if (unwrapped >= target) high = mid; else low = mid;
        }
        events.push({...moonPhase(target), time:(low + high) / 2}); target += 0.25;
      }
      previous = phase;
    }
    return events;
  }
  function parseMoonPhases(data, now = Date.now()) {
    const names = {'New Moon':0, 'First Quarter':0.25, 'Full Moon':0.5, 'Last Quarter':0.75};
    if (data?.error || !Array.isArray(data?.phasedata)) throw Error('Moon dates unavailable');
    const events = data.phasedata.map(event => {
      if (!(event.phase in names) || !/^\d{2}:\d{2}$/.test(event.time) || !Number.isInteger(event.year) || !Number.isInteger(event.month) || !Number.isInteger(event.day)) throw Error('Invalid moon phase');
      const [hour, minute] = event.time.split(':').map(Number);
      const time = Date.UTC(event.year, event.month - 1, event.day, hour, minute);
      const date = new Date(time);
      if (hour > 23 || minute > 59 || date.getUTCFullYear() !== event.year || date.getUTCMonth() !== event.month - 1 || date.getUTCDate() !== event.day) throw Error('Invalid moon date');
      return {...moonPhase(names[event.phase]), time};
    }).filter(event => event.time > now).sort((a,b) => a.time-b.time).slice(0,4);
    if (events.length !== 4 || new Set(events.map(e=>e.name)).size !== 4 || events.some((e,i)=>e.time > now + 35*24*HOUR || (i && e.time <= events[i-1].time))) throw Error('Incomplete moon dates');
    return events;
  }
  const api = {HOUR, fields, coordinates, forecastURL, parseForecast, dewRisk, outlook, parseSites, distance, nearbySites, searchSites, chartURL, riseSetTimes, moonPhase, upcomingMoonPhases, parseMoonPhases};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GregleAstro = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
