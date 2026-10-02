const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/astro-calendar-core.js');
const saved = require('../data/astro-events.json');
const Sky = require('../assets/astro-calendar-sky.js');
const Engine = require('../assets/vendor/astronomy-engine.min.js');
test('verified event instants cross local date boundaries correctly', () => {
  const events = C.parseYear(saved.years[2026].moon, saved.years[2026].seasons, 2026);
  const equinox = events.find(e=>e.title==='September equinox');
  assert.equal(equinox.start,'2026-09-23T00:05:00.000Z');
  assert.equal(C.eventDate(equinox,'America/Vancouver'),'2026-09-22');
  assert.equal(C.eventDate(equinox,'Asia/Tokyo'),'2026-09-23');
  assert.equal(events.filter(e=>e.kind==='Season').length,4);
  for (const year of [2026,2027]) {
    const list=C.parseYear(saved.years[year].moon,saved.years[year].seasons,year);
    assert.equal(new Set(list.map(e=>e.id)).size,list.length);
  }
});
test('iCal preserves instants, escapes text, folds UTF-8, and keeps exclusive all-day end dates', () => {
  const meteor=C.meteorEvents(2026).find(e=>e.title.startsWith('Geminids'));
  assert.equal(C.eventDate(meteor,'Pacific/Kiritimati'),'2026-12-13');
  const event={...meteor,id:'test',title:'Moon, stars; telescope \\ night',allDay:false,start:'2026-10-10T03:50:00Z',description:'Étoiles 🌙 '.repeat(40)+'\nNew line'};
  const ics=C.ical([meteor,event],new Date('2026-10-02T12:00:00Z'));
  const unfolded=ics.replace(/\r\n /g,'');
  assert.match(unfolded,/DTSTART;VALUE=DATE:20261213\r\nDTEND;VALUE=DATE:20261215/);
  assert.match(unfolded,/DTSTART:20261010T035000Z\r\nDTEND:20261010T035100Z/);
  assert(unfolded.includes('SUMMARY:Moon\\, stars\\; telescope \\\\ night'));
  assert(unfolded.includes('\\nNew line'));
  assert(ics.endsWith('END:VCALENDAR\r\n'));
  assert(ics.split('\r\n').every(line=>Buffer.byteLength(line,'utf8')<=75));
  const url=new URL(C.googleURL(meteor));
  assert.equal(url.searchParams.get('dates'),'20261213/20261215');
  assert.equal(new URL(C.googleURL(event)).searchParams.get('dates'),'20261010T035000Z/20261010T035100Z');
});
test('incomplete or impossible ephemeris data is rejected for fallback',()=>{
  assert.throws(()=>C.parseYear({phasedata:[]},{data:[]},2026));
  const moon=structuredClone(saved.years[2026].moon); moon.phasedata[0].day=32;
  assert.throws(()=>C.parseYear(moon,saved.years[2026].seasons,2026));
});
test('calculated eclipses match NASA 2026 and 2027 catalog dates and types',()=>{
  const expected = {
    2026:['2026-02-17 Solar eclipse (annular at peak)','2026-03-03 Total lunar eclipse','2026-08-12 Solar eclipse (total at peak)','2026-08-28 Partial lunar eclipse'],
    2027:['2027-02-06 Solar eclipse (annular at peak)','2027-02-20 Penumbral lunar eclipse','2027-07-18 Penumbral lunar eclipse','2027-08-02 Solar eclipse (total at peak)','2027-08-17 Penumbral lunar eclipse']
  };
  // NASA: https://eclipse.gsfc.nasa.gov/OH/OH2026.html and OH2027.html
  for (const year of [2026,2027]) {
    const events=Sky.skyEvents(year,Engine);
    assert.deepEqual(events.filter(e=>e.kind==='Eclipse').map(e=>e.start.slice(0,10)+' '+e.title),expected[year]);
    assert.equal(new Set(events.map(e=>e.id)).size,events.length);
    assert(events.every(e=>new Date(e.start).getUTCFullYear()===year));
  }
  const solar=Sky.skyEvents(2026,Engine).find(e=>e.id==='eclipse-solar-2026-08-12');
  assert(Math.abs(new Date(solar.start)-new Date('2026-08-12T17:46:00Z'))<180000);
  assert.match(solar.timing,/not your local maximum/);
});
test('planetary opportunities use year-specific dates and morning/evening directions',()=>{
  const events=Sky.skyEvents(2026,Engine);
  assert.equal(events.find(e=>e.title==='Saturn at opposition').start.slice(0,10),'2026-10-04');
  const mercury=events.find(e=>e.id==='elongation-mercury-2026-10-12');
  assert.match(mercury.title,/eastern/); assert.match(mercury.description,/west after sunset/);
  const morning=events.find(e=>e.id==='elongation-mercury-2026-11-20');
  assert.match(morning.title,/western/); assert.match(morning.description,/east before sunrise/);
  const next=Sky.skyEvents(2027,Engine);
  assert.equal(next.find(e=>e.title==='Mars at opposition').start.slice(0,10),'2027-02-19');
  assert(!events.some(e=>e.title==='Mars at opposition'));
});
test('blue moons follow local months and supermoon labels do not duplicate or mutate phases',()=>{
  const phases=C.parseYear(saved.years[2026].moon,saved.years[2026].seasons,2026);
  const annotated=Sky.decorateMoons(phases,'America/Vancouver',Engine,C.dateKey);
  assert.equal(annotated.length,phases.length);
  assert.deepEqual(annotated.filter(e=>e.title.includes('Supermoon')).map(e=>e.start.slice(0,7)),['2026-01','2026-11','2026-12']);
  assert.equal(annotated.find(e=>e.title.includes('Blue Moon')).start.slice(0,10),'2026-05-31');
  assert(!phases.some(e=>e.title.includes('Supermoon')));
  const pair=['2026-05-01T00:15:00Z','2026-05-30T23:45:00Z'].map((start,i)=>({id:String(i),start,title:'Full Moon',kind:'Moon',description:''}));
  assert(Sky.decorateMoons(pair,'UTC',null,C.dateKey)[1].title.includes('Blue Moon'));
  assert(!Sky.decorateMoons(pair,'America/Vancouver',null,C.dateKey)[1].title.includes('Blue Moon'));
});
