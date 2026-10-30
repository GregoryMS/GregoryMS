(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GregleSpaceWeatherCore = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const HOUR = 3600000;
  function timestamp(value) {
    // NOAA's offset-free timestamps are UTC, including in browsers west of UTC.
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return NaN;
    return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : value + 'Z');
  }
  function finite(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }
  function latest(data, valid, now = Date.now()) {
    if (!Array.isArray(data)) throw new Error('Invalid observation data');
    const rows = data.filter(row => row && typeof row === 'object' && valid(row))
      .map(row => ({...row, time:timestamp(row.time_tag)}))
      .filter(row => row.time <= now + 60000 && row.time >= now - 30 * 60000)
      .sort((a, b) => b.time - a.time);
    if (!rows.length) throw new Error('Recent observation unavailable');
    return rows[0];
  }
  function kp(data, now) { return latest(data, row => finite(row.estimated_kp, 0, 9), now); }
  function wind(data, now) {
    return latest(data, row => row.active === true && row.overall_quality === 0 && finite(row.proton_speed, 100, 3000) && finite(row.proton_density, 0, 1000), now);
  }
  function magnetic(data, now) {
    return latest(data, row => row.active === true && row.overall_quality === 0 && finite(row.bz_gsm, -500, 500), now);
  }
  function forecast(data, now = Date.now()) {
    if (!Array.isArray(data)) throw new Error('Invalid forecast data');
    const rows = data.filter(row => row && ['estimated','predicted'].includes(row.observed) && finite(row.kp, 0, 9))
      .map(row => ({time:timestamp(row.time_tag), kp:row.kp, kind:row.observed}))
      .filter(row => row.time + 3 * HOUR > now && row.time <= now + 72 * HOUR)
      .sort((a, b) => a.time - b.time);
    // Do not describe an expired or severely incomplete forecast as three days.
    if (!rows.length || rows[0].time > now + 6 * HOUR || rows.at(-1).time < now + 24 * HOUR) throw new Error('Current forecast unavailable');
    const days = [];
    for (const row of rows) {
      const date = new Date(row.time).toISOString().slice(0, 10);
      let day = days.find(item => item.date === date);
      if (!day) { day = {date, peak:row.kp, peakTime:row.time}; days.push(day); }
      if (row.kp > day.peak) { day.peak = row.kp; day.peakTime = row.time; }
    }
    return {rows, days:days.slice(0, 3)};
  }
  function activity(value) {
    if (value >= 9) return 'G5 · Extreme storm level';
    if (value >= 8 - 1 / 3) return 'G4 · Severe storm level';
    if (value >= 7 - 1 / 3) return 'G3 · Strong storm level';
    if (value >= 6 - 1 / 3) return 'G2 · Moderate storm level';
    if (value >= 5 - 1 / 3) return 'G1 · Minor storm level';
    if (value >= 4) return 'Active geomagnetic conditions';
    if (value >= 3) return 'Unsettled geomagnetic conditions';
    return 'Quiet geomagnetic conditions';
  }
  return {timestamp, kp, wind, magnetic, forecast, activity};
});
