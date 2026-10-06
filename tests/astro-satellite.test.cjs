const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const C=require('../assets/astro-satellite-core.js');
const snapshot=require('../data/satellite-orbits.json');
const epoch=row=>Date.parse(row.EPOCH+'Z');
test('every selected satellite propagates plausible coordinates and a 90-minute ground track',()=>{
  for (const entry of C.satellites) {
    const row=snapshot.satellites.find(row=>row.NORAD_CAT_ID===entry.id), now=epoch(row)+3600000;
    const orbit=C.record(row,entry.id,now), p=C.position(orbit,now,{latitude:48.43,longitude:-123.37});
    assert.ok(Math.abs(p.latitude)<=90 && Math.abs(p.longitude)<=180);
    assert.ok(p.altitude>250 && p.altitude<900);
    assert.ok(p.velocity>24000 && p.velocity<30000);
    assert.ok(Math.abs(p.elevation)<=90);
    const path=C.projectedPath(orbit,now);
    assert.equal(path.flat().length,91);
    const last=C.position(orbit,now+90*60000);
    assert.deepEqual(path.at(-1).at(-1),[last.latitude,last.longitude]);
    for (const segment of path) {
      for (let i=1;i<segment.length;i++) assert.ok(Math.abs(segment[i][1]-segment[i-1][1])<=180);
    }
  }
});
test('stale, wrong and malformed orbit records are rejected',()=>{
  const row=snapshot.satellites[0], now=epoch(row)+3600000;
  for (const bad of [{...row,NORAD_CAT_ID:1},{...row,EPOCH:'invalid'},
    {...row,MEAN_MOTION:NaN},{...row,ECCENTRICITY:2},{...row,INCLINATION:181}]) {
    assert.throws(()=>C.record(bad,25544,now));
  }
  assert.throws(()=>C.record(row,25544,epoch(row)+8*86400000));
  assert.throws(()=>C.record(row,25544,epoch(row)-2*86400000));
});
test('ground tracks split at the date line and after a pause',()=>{
  const points=[{latitude:1,longitude:179,timestamp:1},{latitude:2,longitude:-179,timestamp:11},
    {latitude:3,longitude:-178,timestamp:21},{latitude:4,longitude:-175,timestamp:100}];
  assert.deepEqual(C.segments(points),[[[1,179]],[[2,-179],[3,-178]],[[4,-175]]]);
});
test('pass links use the selected satellite and observing location',()=>{
  const url=new URL(C.passesURL({latitude:48.43,longitude:-123.37,name:'Victoria & Harbour'},48274));
  assert.equal(url.searchParams.get('satid'),'48274');
  assert.equal(url.searchParams.get('loc'),'Victoria & Harbour');
  assert.equal(url.searchParams.get('lng'),'-123.37');
  assert.equal(C.passesURL({latitude:NaN,longitude:0}), 'https://www.heavens-above.com/');
});

function harness(feed=snapshot) {
  const nodes=new Map(),events={},timers=new Map(),calls=[];
  let observer, time=epoch(snapshot.satellites[0])+3600000, timerId=0;
  let fetchImpl=async()=>({ok:true,json:async()=>feed});
  function node(id) {
    if (!nodes.has(id)) nodes.set(id,{textContent:'—',value:'25544',checked:true,disabled:false,events:{},
      addEventListener(type,fn){this.events[type]=fn;},setAttribute(){}});
    return nodes.get(id);
  }
  class Clock extends Date {static now(){return time;}}
  const document={hidden:false,getElementById:node,addEventListener(type,fn){events[type]=fn;}};
  const window={document,GregleSatelliteCore:C,fetch:(...args)=>{calls.push(args);return fetchImpl(...args);},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},
    addEventListener(){},IntersectionObserver:class {constructor(fn){observer=fn;}observe(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/astro-satellite.js'),'utf8'),
    {window,document,Date:Clock,AbortController});
  const flush=async()=>{for(let i=0;i<12;i++) await Promise.resolve();};
  return {window,document,node,events,timers,calls,flush,
    view(value){observer([{isIntersecting:value}]);},advance(ms){time+=ms;},
    setFetch(fn){fetchImpl=fn;},choose(id){node('satellite-select').value=String(id);node('satellite-select').events.change();}};
}
test('selection changes readings and pass links; missing satellite data clears previous readings',async()=>{
  const h=harness({...snapshot,satellites:snapshot.satellites.filter(s=>s.NORAD_CAT_ID!==27424)});
  assert.equal(h.calls.length,0);
  h.window.GregleSatellite.setLocation({name:'Victoria',latitude:48.43,longitude:-123.37});
  h.view(true);await h.flush();
  assert.match(h.node('satellite-altitude').textContent,/km/);
  h.choose(48274);await h.flush();
  assert.match(h.node('satellite-name').textContent,/Tiangong/);
  assert.match(h.node('satellite-passes').href,/satid=48274/);
  assert.match(h.node('satellite-altitude').textContent,/km/);
  h.choose(27424);await h.flush();
  assert.equal(h.node('satellite-altitude').textContent,'—');
  assert.match(h.node('satellite-status').textContent,/missing, invalid or older/);
  h.choose(25544);await h.flush();
  assert.match(h.node('satellite-altitude').textContent,/km/);
});
test('updates pause while hidden and stale orbit data clears the displayed estimate',async()=>{
  const h=harness();h.view(true);await h.flush();
  assert.match(h.node('satellite-status').textContent,/Estimated position/);
  h.document.hidden=true;h.events.visibilitychange();
  assert.equal(h.timers.size,0);
  h.advance(8*86400000);h.document.hidden=false;h.events.visibilitychange();await h.flush();
  assert.equal(h.node('satellite-position').textContent,'—');
  assert.match(h.node('satellite-status').textContent,/older than seven days/);
});
test('failed reload preserves usable orbit data and leaves retry available',async()=>{
  const h=harness();h.view(true);await h.flush();
  h.setFetch(async()=>{throw Error('Offline');});
  h.node('satellite-refresh').events.click();await h.flush();
  assert.match(h.node('satellite-altitude').textContent,/km/);
  assert.match(h.node('satellite-status').textContent,/Orbit refresh failed/);
  assert.equal(h.node('satellite-refresh').disabled,false);
});
test('a slow load after hiding cannot update the hidden tracker',async()=>{
  const h=harness();let resolve;
  h.setFetch(()=>new Promise(r=>{resolve=r;}));
  h.view(true);h.view(false);
  resolve({ok:true,json:async()=>snapshot});await h.flush();
  assert.equal(h.node('satellite-altitude').textContent,'—');
  assert.equal(h.timers.size,0);
});
