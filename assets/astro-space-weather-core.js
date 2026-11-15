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
  function sunspots(text, now = Date.now()) {
    if (typeof text !== 'string' || !/^:Product:\s+Daily Solar Data\b/m.test(text)) throw new Error('Invalid daily solar data');
    const today = Math.floor(now / (24 * HOUR)) * 24 * HOUR;
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const date = /^(\d{4}) (\d{2}) (\d{2})\s/.exec(line);
      // NOAA's fixed-width SESC field stays blank when observations are missing.
      // Splitting on whitespace would read the following area field as a number.
      const value = line.slice(16, 22).trim();
      if (!date || !/^\d{1,4}$/.test(value)) continue;
      const iso = date.slice(1).join('-'), time = Date.parse(iso + 'T00:00:00Z'), number = Number(value);
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso || number > 1000) continue;
      if (time > today || time < today - 3 * 24 * HOUR) continue;
      rows.push({time, number});
    }
    if (!rows.length) throw new Error('Recent daily sunspot number unavailable');
    return rows.sort((a, b) => b.time - a.time)[0];
  }
  function forecast(data, now = Date.now()) {
    if (!Array.isArray(data)) throw new Error('Invalid forecast data');
    const rows = data.filter(row => row && ['estimated','predicted'].includes(row.observed) && finite(row.kp, 0, 9))
      .map(row => ({time:timestamp(row.time_tag), kp:row.kp, kind:row.observed}))
      .filter(row => row.time + 3 * HOUR > now && row.time <= now + 72 * HOUR)
      .sort((a, b) => a.time - b.time);
    // Do not describe an expired or severely incomplete forecast as three days.
    if (!rows.length || rows[0].time > now || rows.at(-1).time < now + 24 * HOUR ||
        rows.some((row,i) => i && row.time - rows[i-1].time !== 3 * HOUR)) throw new Error('Current forecast unavailable');
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
  function forecastText(text, now = Date.now()) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (typeof text !== 'string' || !/^:Product:\s+3-Day Forecast\s*$/m.test(text)) throw Error('Invalid NOAA bulletin');
    const issued = /^:Issued:\s+(\d{4}) (\w{3}) (\d{2}) (\d{2})(\d{2}) UTC\s*$/m.exec(text);
    if (!issued || !months.includes(issued[2])) throw Error('Invalid bulletin date');
    const issueTime = Date.UTC(+issued[1],months.indexOf(issued[2]),+issued[3],+issued[4],+issued[5]);
    const issueDate = new Date(issueTime);
    if (+issued[4]>23 || +issued[5]>59 || issueDate.getUTCMonth()!==months.indexOf(issued[2]) || issueDate.getUTCDate()!==+issued[3]) throw Error('Invalid bulletin date');
    if (issueTime > now + 60000 || issueTime < now - 36 * HOUR) throw Error('Expired NOAA bulletin');
    const table = text.split(/NOAA Kp index breakdown[^\n]*\n/)[1]?.split(/\nRationale:|\nB\./)[0];
    if (!table) throw Error('Missing Kp table');
    const lines = table.trim().split(/\r?\n/);
    const dates = [...lines.shift().matchAll(/([A-Z][a-z]{2})\s+(\d{1,2})/g)].map(([,month,day]) => {
      if (!months.includes(month) || +day<1 || +day>31) throw Error('Invalid Kp date');
      const candidates = [-1,0,1].map(offset => Date.UTC(+issued[1]+offset, months.indexOf(month), +day));
      const date = candidates.sort((a,b)=>Math.abs(a-issueTime)-Math.abs(b-issueTime))[0];
      if (new Date(date).getUTCMonth()!==months.indexOf(month)) throw Error('Invalid Kp date');
      return date;
    });
    if (dates.length !== 3 || dates.some((date,i)=>Math.abs(date-issueTime)>3*24*HOUR || (i && date-dates[i-1]!==24*HOUR))) throw Error('Invalid Kp dates');
    const rows = [];
    for (let hour=0;hour<24;hour+=3) {
      const label = String(hour).padStart(2,'0')+'-'+String((hour+3)%24).padStart(2,'0')+'UT';
      const line = lines.find(line => line.trim().startsWith(label));
      const values = line?.trim().slice(label.length).replace(/\(G[1-5]\)/g,'').trim().split(/\s+/);
      if (!values || values.length!==3 || values.some(value=>!/^\d(?:\.\d{1,2})?$/.test(value) || +value>9)) throw Error('Incomplete Kp table');
      dates.forEach((date,i)=>rows.push({time_tag:new Date(date+hour*HOUR).toISOString(),kp:+values[i],observed:'predicted'}));
    }
    return {...forecast(rows,now), issued:issueTime};
  }
  return {timestamp, kp, wind, magnetic, sunspots, forecast, forecastText, activity};
});
