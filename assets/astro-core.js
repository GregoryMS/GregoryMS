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
  function chartRegion(place) {
    if (!coordinates(place.latitude, place.longitude) || place.latitude < 15 || place.latitude > 75 || place.longitude < -165 || place.longitude > -50) return null;
    return (place.latitude >= 49 ? 'north' : 'south') + (place.longitude < -100 ? 'west' : 'east');
  }
  function chartCandidates(place, kind, offset = 0, now = Date.now()) {
    const region = chartRegion(place);
    if (!region || !['cloud', 'seeing', 'transparency'].includes(kind) || !Number.isFinite(offset) || offset < 0 || offset > 48) return [];
    const valid = Math.ceil(now / HOUR) * HOUR + offset * HOUR;
    const latest = Math.floor((now - 3 * HOUR) / (6 * HOUR)) * 6 * HOUR;
    return Array.from({length: 4}, (_, i) => {
      const run = latest - i * 6 * HOUR, lead = Math.round((valid - run) / HOUR);
      const stamp = new Date(run).toISOString().slice(0, 13).replace(/[-T]/g, '');
      const area = kind === 'cloud' ? region : 'astro';
      const variable = {cloud: 'nt', seeing: 'seeing', transparency: 'transp'}[kind];
      return {run, valid, lead, url: `https://weather.gc.ca/data/prog/regional/${stamp}/${stamp}_054_R1_north@america@${area}_I_ASTRO_${variable}_${String(lead).padStart(3, '0')}.png`};
    }).filter(x => x.lead > 0 && x.lead <= 84);
  }
  function mapURL(place) {
    if (!coordinates(place.latitude, place.longitude)) throw Error('Invalid coordinates');
    return `https://www.lightpollutionmap.info/#zoom=8&lat=${place.latitude.toFixed(4)}&lon=${place.longitude.toFixed(4)}`;
  }
  const api = {HOUR, fields, coordinates, forecastURL, parseForecast, dewRisk, outlook, chartRegion, chartCandidates, mapURL};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GregleAstro = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
