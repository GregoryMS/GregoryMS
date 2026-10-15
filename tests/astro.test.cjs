const {test} = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/astro-core.js');
const W = require('../assets/weather-core.js');
const T = require('../assets/tide-core.js');
const S = require('../assets/vendor/suncalc.js');
const fs = require('node:fs');
const vm = require('node:vm');
const now = Date.parse('2026-09-30T04:20:00Z');
const place = {latitude:49.28, longitude:-123.12};
function response() {
  const time = Array.from({length:72}, (_, i) => Date.parse('2026-09-30T00:00:00Z') / 1000 + i * 3600);
  return {timezone:'America/Vancouver', current:{time:now/1000, cloud_cover:0}, hourly:{time,
    ...Object.fromEntries(A.fields.map(key => [key, time.map(() => 10)]))}};
}
test('forecast uses epoch times, rounded coordinates and a full 48-hour window', () => {
  const url = new URL(A.forecastURL({latitude:49.28273, longitude:-123.12073}));
  assert.equal(url.searchParams.get('latitude'), '49.28');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  const parsed = A.parseForecast(response(), now);
  assert.equal(parsed.rows.length, 48);
  assert.equal(parsed.rows[0].time, Date.parse('2026-09-30T04:00:00Z'));
  assert.equal(parsed.rows.at(-1).time, Date.parse('2026-10-02T03:00:00Z'));
});
test('missing data stays unknown instead of becoming clear skies or no dew', () => {
  const data = response(); data.hourly.cloud_cover[4] = null; data.hourly.dew_point_2m[4] = null;
  const row = A.parseForecast(data, now).rows[0];
  assert.equal(row.cloud_cover, null); assert.equal(A.outlook(row, -25), 'Unknown');
  assert.equal(A.dewRisk(row.temperature_2m, row.dew_point_2m), 'Unknown');
  assert.equal(A.dewRisk(3, 2), 'High'); assert.equal(A.dewRisk(4, 1), 'Moderate'); assert.equal(A.dewRisk(10, 2), 'Low');
});
test('stale, malformed and misaligned forecasts fail explicitly', () => {
  const data = response(); data.current.time -= 3 * 3600;
  assert.equal(A.parseForecast(data, now).current, null);
  assert.throws(() => A.parseForecast(data, now + 7 * 24 * A.HOUR), /out of date/);
  data.hourly.cloud_cover.pop(); assert.throws(() => A.parseForecast(data, now), /Incomplete/);
  const duplicate = response(); duplicate.hourly.time[1] = duplicate.hourly.time[0];
  assert.throws(() => A.parseForecast(duplicate, now), /Invalid forecast times/);
  const badZone = response(); badZone.timezone = 'Unknown/Zone'; assert.throws(() => A.parseForecast(badZone, now));
});
test('outlook distinguishes darkness, twilight, weather limitations and unknown values', () => {
  const good = {cloud_cover:0, wind_speed_10m:0, precipitation_probability:0};
  assert.equal(A.outlook(good, 10), 'Daylight'); assert.equal(A.outlook(good, -10), 'Twilight');
  assert.equal(A.outlook(good, -20), 'Promising'); assert.equal(A.outlook({...good, cloud_cover:40}, -20), 'Mixed');
  assert.equal(A.outlook({...good, wind_speed_10m:35}, -20), 'Poor');
  assert.equal(A.outlook({...good, precipitation_probability:60}, -20), 'Poor');
  assert.equal(A.outlook({...good, cloud_cover:null}, -20), 'Unknown');
});
test('chart directory validates coordinates, keys, colours and duplicates', () => {
  const record = ['WnrObAZ','Winer Observatory',31.665572,-110.601793,'Bortle 3 - Rural sky','#013EDC'];
  const data = {version:1,updated:'2026-09-30',sites:[record]};
  assert.equal(A.parseSites(data)[0].key, 'WnrObAZ');
  assert.throws(() => A.parseSites({...data,sites:[record,record]}));
  for (const [index, value] of [[0,'../../evil'],[2,91],[3,null],[5,'red;display:none']]) {
    const bad = [...record]; bad[index] = value;
    assert.throws(() => A.parseSites({...data,sites:[bad]}));
  }
});
test('site search and nearest-site matching use real catalog entries within 200 km', () => {
  const sites = A.parseSites(require('../data/astro-sites.json'));
  assert.ok(sites.length >= 5000);
  assert.equal(A.searchSites(sites,'Winer Observatory')[0].key,'WnrObAZ');
  assert.equal(A.searchSites(sites,'wnrobaz')[0].name,'Winer Observatory');
  assert.deepEqual(A.searchSites(sites,' '),[]);
  const nearby = A.nearbySites(sites,place);
  assert.equal(nearby.length,12); assert.ok(nearby[0].distance < 5);
  assert.ok(nearby.every((s,i) => s.distance <= 200 && (!i || s.distance >= nearby[i-1].distance)));
  assert.deepEqual(A.nearbySites(sites,{latitude:51.5,longitude:-0.12}),[]);
  assert.equal(A.chartURL({key:'WnrObAZ'},true),'https://test.cleardarksky.com/c/WnrObAZ/chart.gif');
  assert.equal(A.chartURL({key:'WnrObAZ'}),'https://test.cleardarksky.com/c/WnrObAZ.html');
  assert.throws(() => A.chartURL({key:'../invalid'}));
});
test('location search handles no matches and does not accept invalid coordinates', () => {
  assert.deepEqual(W.searchLocations({}), []);
  assert.deepEqual(W.searchLocations({results:[{name:'Invalid', latitude:100, longitude:0, country_code:'CA'}]}), []);
});
test('astronomical darkness handles polar day and polar night without missing rise/set assumptions', () => {
  const summer = S.getPosition(new Date('2026-06-21T00:00:00Z'), 80, 0).altitude * 180 / Math.PI;
  const winter = S.getPosition(new Date('2026-12-21T12:00:00Z'), 89, 0).altitude * 180 / Math.PI;
  assert.ok(summer > 0); assert.ok(winter < -18);
});

function harness(deferImages = false, href = 'https://gregle.uk/astro.html') {
  class El {
    constructor() { this.children=[]; this.listeners={}; this.dataset={}; this.value=''; this.checked=true; this.textContent=''; }
    setAttribute(name, value) { this[name]=value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=children; this.textContent=''; }
    addEventListener(name, fn) { this.listeners[name]=fn; }
    fire(name) { return this.listeners[name]?.({preventDefault(){}}); }
  }
  const nodes=new Map(), get=id=>{if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id);};
  const buttons=['vancouver','victoria','chilliwack'].map(name=>{const b=new El();b.dataset.place=name;return b;});
  const pending=[], images=[]; let geoSuccess;
  const document={getElementById:get,createElement:()=>new El(),createElementNS:()=>new El(),querySelectorAll:()=>buttons,addEventListener(){},hidden:false};
  class FixedDate extends Date { static now(){return now;} }
  const siteDirectory=A.parseSites(require('../data/astro-sites.json'));
  const browser={create({onChart}){return {setLocation(place){onChart(A.nearbySites(siteDirectory,place)[0] || null);}};}};
  const context={window:{location:{href},GregleTides:T,GregleAstro:{...A,parseForecast:data=>A.parseForecast(data,now)},GregleWeather:W,SunCalc:S,GregleAstroSites:browser},document,Date:FixedDate,Intl,URLSearchParams,AbortController,
    setTimeout,clearTimeout,setInterval(){},navigator:{geolocation:{getCurrentPosition(success){geoSuccess=success;}}},
    Image:class {set src(value){if(value){images.push(this);if(!deferImages)queueMicrotask(()=>this.onload?.());}}},
    fetch:url=>url.startsWith('https://aa.usno.navy.mil/') ? Promise.resolve({ok:false}) : new Promise((resolve,reject)=>pending.push({url,resolve:body=>resolve({ok:true,json:async()=>body}),reject}))};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/astro.js'),'utf8'),context);
  return {get,pending,buttons,images,geo:()=>geoSuccess,async flush(){await new Promise(resolve=>setImmediate(resolve));}};
}
test('a slow forecast cannot overwrite a newly selected location', async () => {
  const h=harness();
  h.buttons[1].fire('click');
  h.pending[1].resolve({...response(),current:{time:now/1000,cloud_cover:72}}); await h.flush();
  assert.equal(h.get('place-name').textContent,'Victoria');
  h.pending[0].resolve({...response(),current:{time:now/1000,cloud_cover:1}}); await h.flush();
  assert.equal(h.get('conditions').children[0].children[1].textContent,'72%');
});
test('search failure is recoverable and pending geolocation cannot override a shortcut', async () => {
  const h=harness(); h.pending[0].resolve(response()); await h.flush();
  h.get('location-query').value='London'; const search=h.get('location-form').fire('submit');
  h.pending[1].reject(Error('Offline')); await search;
  assert.match(h.get('search-status').textContent,/unavailable/);
  h.get('my-location').fire('click'); h.buttons[2].fire('click');
  h.geo()({coords:{latitude:1,longitude:2}});
  assert.equal(h.get('place-name').textContent,'Chilliwack');
  h.pending[2].resolve(response()); await h.flush();
});
test('failed location forecast clears old readings while keeping map and chart independent', async () => {
  const h=harness(); h.pending[0].resolve(response()); await h.flush();
  h.buttons[1].fire('click'); h.pending[1].reject(Error('Offline')); await h.flush();
  assert.match(h.get('forecast-status').textContent,/Forecast unavailable/);
  assert.equal(h.get('conditions').children[0].children[1].textContent,'—');
  assert.match(h.get('chart-source').href,/test.cleardarksky.com/);
  assert.equal(h.get('chart-image').children.length,1);
});

test('late chart images cannot replace a newer site and failed images leave a useful fallback', async () => {
  const h=harness(true);
  h.pending[0].resolve(response()); await h.flush();
  h.buttons[1].fire('click'); h.pending[1].resolve(response());
  h.images[1].onload(); await h.flush();
  const selectedURL=h.get('chart-source').href;
  assert.match(h.get('chart-heading').textContent,/Victoria/);
  h.images[0].onload(); await h.flush();
  assert.equal(h.get('chart-image').children[0].href,selectedURL);
  h.buttons[2].fire('click'); h.pending[2].resolve(response()); h.images[2].onerror(); await h.flush();
  assert.equal(h.get('chart-image').children.length,0);
  assert.match(h.get('chart-status').textContent,/Chart image unavailable/);
  assert.match(h.get('chart-source').href,/test.cleardarksky.com/);
});

test('moon phases cross new moon without skipping or duplicating a quarter', () => {
  const start = Date.parse('2026-12-31T12:00:00Z'), month = 29.53059 * 24 * A.HOUR;
  const illumination = date => ({phase:(0.9 + (date.getTime() - start) / month) % 1});
  const events = A.upcomingMoonPhases(start, illumination);
  assert.deepEqual(events.map(e=>e.name), ['New moon','First quarter','Full moon','Last quarter']);
  events.forEach((event,i) => assert.ok(Math.abs(event.time - (start + (0.1 + i * 0.25) * month)) < 60000));
  for (let monthIndex=0; monthIndex<12; monthIndex++) {
    const date=Date.UTC(2026,monthIndex,1), phases=A.upcomingMoonPhases(date,S.getMoonIllumination);
    assert.equal(phases.length,4);
    assert.equal(new Set(phases.map(p=>p.name)).size,4);
    phases.forEach((event,i)=>assert.ok(event.time > (i ? phases[i-1].time : date) && event.time < date + 35*24*A.HOUR));
  }
});
test('weather icon preserves selected coordinates and lunar dates follow forecast timezone', async () => {
  const h=harness(); h.pending[0].resolve(response()); await h.flush();
  h.buttons[1].fire('click');
  assert.equal(h.get('weather-icon-link').href,h.get('weather-link').href);
  assert.equal(new URL(h.get('weather-icon-link').href,'https://example.test').searchParams.get('name'),'Victoria');
  h.pending[1].resolve({...response(),timezone:'Pacific/Auckland'}); await h.flush();
  assert.equal(new URL(h.get('weather-icon-link').href,'https://example.test').searchParams.get('tz'),'Pacific/Auckland');
  const dates=h.get('moon-phase-dates').children;
  assert.equal(dates.length,4);
  dates.forEach(card=>{
    const date=card.children[2];
    assert.equal(date.textContent,new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',month:'short',day:'numeric',year:'numeric'}).format(new Date(date.dateTime)));
  });
});

// Reference: https://aa.usno.navy.mil/api/moon/phases/date?date=2026-09-30&nump=4
const usnoPhases = {phasedata:[
  {year:2026,month:10,day:3,time:'13:25',phase:'Last Quarter'},
  {year:2026,month:10,day:10,time:'15:50',phase:'New Moon'},
  {year:2026,month:10,day:18,time:'16:12',phase:'First Quarter'},
  {year:2026,month:10,day:26,time:'04:12',phase:'Full Moon'}
]};
test('USNO phase dates retain precise instants and reject incomplete or invalid data', () => {
  const phases=A.parseMoonPhases(usnoPhases,now);
  assert.equal(phases[3].time,Date.parse('2026-10-26T04:12:00Z'));
  assert.equal(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',month:'short',day:'numeric'}).format(new Date(phases[3].time)),'Oct 25');
  assert.throws(()=>A.parseMoonPhases({phasedata:[]},now));
  assert.throws(()=>A.parseMoonPhases({error:'Unavailable'},now));
  for (const change of [{day:32},{time:'24:00'},{phase:'Unknown'}]) {
    assert.throws(()=>A.parseMoonPhases({phasedata:[{...usnoPhases.phasedata[0],...change},...usnoPhases.phasedata.slice(1)]},now));
  }
});

test('weather-to-astronomy links select the linked location and reject invalid coordinates', async () => {
  const h=harness(false,'https://gregle.uk/astro.html?lat=48.43&lon=-123.36&name=Victoria&tz=America%2FVancouver');
  assert.equal(h.get('place-name').textContent,'Victoria');
  assert.equal(new URL(h.pending[0].url).searchParams.get('latitude'),'48.43');
  h.pending[0].resolve(response()); await h.flush();
  const invalid=harness(false,'https://gregle.uk/astro.html?lat=999&lon=0&name=Invalid');
  assert.equal(invalid.get('place-name').textContent,'Vancouver');
  invalid.pending[0].resolve(response()); await invalid.flush();
});

test('rise/set events use the selected date across UTC midnight and distant timezones', () => {
  const victoria={latitude:48.43,longitude:-123.37};
  const morning=A.riseSetTimes(Date.parse('2026-09-30T15:00:00Z'),victoria,'America/Vancouver',S);
  const evening=A.riseSetTimes(Date.parse('2026-10-01T06:00:00Z'),victoria,'America/Vancouver',S);
  assert.deepEqual(evening,morning);
  const cases=[
    [victoria,'America/Vancouver','2026-09-30T04:20:00Z'],
    [{latitude:-36.85,longitude:174.76},'Pacific/Auckland','2026-09-26T16:00:00Z'],
    [{latitude:51.5,longitude:-0.12},'Europe/London','2026-10-25T12:00:00Z'],
    [{latitude:1.87,longitude:-157.43},'Pacific/Kiritimati','2026-09-30T15:00:00Z']
  ];
  for(const [location,timezone,iso] of cases){
    const instant=Date.parse(iso), events=A.riseSetTimes(instant,location,timezone,S);
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
    assert.ok(events.sunrise && events.sunset);
    for(const time of Object.values(events)) if(time!==null) assert.equal(day.format(time),day.format(instant));
  }
});
test('absent lunar events and polar solar events remain absent', () => {
  const victoria={latitude:48.43,longitude:-123.37};
  assert.equal(A.riseSetTimes(Date.parse('2026-10-04T12:00:00Z'),victoria,'America/Vancouver',S).moonrise,null);
  assert.equal(A.riseSetTimes(Date.parse('2026-10-18T12:00:00Z'),victoria,'America/Vancouver',S).moonset,null);
  for(const date of ['2026-06-21T12:00:00Z','2026-12-21T12:00:00Z']){
    const events=A.riseSetTimes(Date.parse(date),{latitude:80,longitude:0},'UTC',S);
    assert.equal(events.sunrise,null); assert.equal(events.sunset,null);
  }
});
test('rise/set display updates with location and remains available when weather fails', async () => {
  const h=harness(); h.pending[0].resolve(response()); await h.flush();
  h.buttons[1].fire('click'); h.pending[1].reject(Error('Offline')); await h.flush();
  const expected=A.riseSetTimes(now,{latitude:48.43,longitude:-123.37},'America/Vancouver',S);
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',hour:'numeric',minute:'2-digit'});
  for(const [id,time] of Object.entries(expected)) assert.equal(h.get(id).textContent,format.format(time));
  assert.match(h.get('rise-set-date').textContent,/Sep 29, 2026.*America\/Vancouver/);
});
