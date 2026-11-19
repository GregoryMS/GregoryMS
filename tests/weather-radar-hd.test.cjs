const {test}=require('node:test');
const assert=require('node:assert/strict');
const hd=require('../assets/weather-radar-hd.js');
const now=Date.parse('2026-11-19T20:00:00Z');

test('NOAA source selection stays on the expected workspace and reflectivity product',()=>{
  assert.equal(hd.sourceFor().layer,'conus_bref_qcd');
  assert.deepEqual(hd.sourceFor('KATX'),{id:'KATX',endpoint:'https://opengeo.ncep.noaa.gov/geoserver/katx/ows',layer:'katx_sr_bref'});
  for(const station of ['../conus','KATX?evil=1','https://evil.test','TSEA'])assert.throws(()=>hd.sourceFor(station));
});
test('NOAA history uses actual timestamps, excluding duplicates, invalid, expired and future scans',()=>{
  const value='2026-11-19T19:30:00Z,2026-11-19T20:00:00Z,bad,2026-11-19T19:30:00Z,2026-11-19T16:00:00Z,2026-11-19T21:00:00Z';
  assert.deepEqual(hd.timesFrom(value,now),[now-1800000,now]);
  assert.throws(()=>hd.timesFrom('bad',now));
  assert.throws(()=>hd.timesFrom('2026-11-19T16:00:00Z',now));
});
test('dense history is bounded without shortening the two-hour animation window',()=>{
  const times=hd.timesFrom('2026-11-19T18:00:00Z/2026-11-19T20:00:00Z/PT2M',now);
  assert.equal(times.length,25);assert.equal(times[0],now-7200000);assert.equal(times.at(-1),now);
  for(const value of ['2026-11-19T20:00:00Z/2026-11-19T18:00:00Z/PT2M','2026-11-19T18:00:00Z/2026-11-19T20:00:00Z/PT0M'])assert.throws(()=>hd.timesFrom(value,now));
});
test('station distances put KATX nearest Victoria and station IDs are unique',()=>{
  const sites=require('../assets/weather-radar-sites.json');
  assert.equal(new Set(sites.map(s=>s.id)).size,sites.length);
  const sorted=[...sites].sort((a,b)=>hd.distance(a,{latitude:48.421,longitude:-123.393})-hd.distance(b,{latitude:48.421,longitude:-123.393}));
  assert.equal(sorted[0].id,'KATX');
});
