const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/astro-calendar-core.js');
const saved = require('../data/astro-events.json');
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
