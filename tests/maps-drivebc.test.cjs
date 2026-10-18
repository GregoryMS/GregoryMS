const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/maps-core.js');
const NOW = Date.parse('2026-10-18T00:00:00Z');
const victoria = [-123.5,48.3,-123.2,48.6], vancouver = [-123.3,49.1,-122.9,49.5];
const event = (id, coordinates) => ({ id, status: 'ACTIVE', headline: id, event_type: 'CONSTRUCTION', severity: 'MINOR', geography: { type: 'Point', coordinates } });
const reports = [event('Victoria',[-123.36,48.42]),event('Vancouver',[-123.12,49.28]),event('Kamloops',[-120.33,50.67])];
const response = (events = reports, pagination = {}) => ({ ok: true, json: async () => ({ events, pagination }) });
const limited = retry => ({ ok: false, status: 429, headers: { get: () => retry ?? null } });
const flush = async () => { for (let i=0;i<15;i++) await Promise.resolve(); };
function setup() {
  let now = NOW, bounds = victoria, nextTimer = 0, fetchImpl = async () => response();
  const timers = new Map(), listeners = {}, calls = [], groups = [], notices = [];
  const output = { textContent: '', dataset: {} };
  const map = { getBounds: () => ({ getWest:()=>bounds[0],getSouth:()=>bounds[1],getEast:()=>bounds[2],getNorth:()=>bounds[3] }), on(type,fn){listeners[type]=fn;},addLayer(){},removeLayer(){},attributionControl:{addAttribution(){},removeAttribution(){}} };
  const layer = (type, point, options) => ({ type, point, options, bindPopup(fn){this.popup=fn;return this;},addTo(group){group.addLayer(this);return this;} });
  const L = { layerGroup(){const group={children:new Set(),addLayer(l){this.children.add(l);},removeLayer(l){this.children.delete(l);},clearLayers(){this.children.clear();},addTo(){return this;}};groups.push(group);return group;},polyline:(p,o)=>layer('line',p,o),marker:(p,o)=>layer('marker',p,o),divIcon:options=>options };
  class Clock extends Date { static now(){return now;} }
  const context = { L, Date:Clock, URL, AbortController, Map, Math, Number,
    GregleMaps:core, document:{hidden:false,getElementById:()=>output,addEventListener(type,fn){listeners[type]=fn;}},
    addEventListener(type,fn){listeners[type]=fn;},
    setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},
    fetch(url,options){calls.push({url:new URL(url),signal:options.signal});return fetchImpl(url,options);}
  };
  context.window=context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-drivebc.js'),'utf8'),context);
  const api=context.GregleDriveBC({map,notify:message=>notices.push(message)});
  async function advance(ms) {
    const target=now+ms;
    for(let count=0;count<100;count++) {
      const due=[...timers.entries()].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];
      if(!due) {now=target;await flush();return;}
      now=due[1].due;timers.delete(due[0]);due[1].fn();await flush();
    }
    throw new Error('Timer loop did not settle');
  }
  return {api,calls,output,notices,advance,document:context.document,listeners,setFetch:fn=>fetchImpl=fn,
    async move(next){bounds=next;listeners.moveend();await advance(150);},
    markers:()=>[...groups[0].children].filter(l=>l.type==='marker'),lines:()=>[...groups[0].children].filter(l=>l.type==='line')};
}

test('panning reuses one province feed, filters reports locally and retains unchanged marker objects',async()=>{
  const h=setup();h.api.setEnabled(true);await flush();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].url.searchParams.has('bbox'),false);
  const marker=h.markers()[0];assert.match(marker.options.title,/Victoria/);
  await h.move([-123.49,48.31,-123.21,48.59]);assert.equal(h.markers()[0],marker);
  for(let i=0;i<30;i++) await h.move(i%2?victoria:vancouver);
  assert.equal(h.calls.length,1);assert.match(h.markers()[0].options.title,/Victoria/);
  await h.move([236.5,48.3,236.8,48.6]);assert.match(h.markers()[0].options.title,/Victoria/);
  await h.move([-.3,51.3,.1,51.7]);assert.equal(h.markers().length,0);assert.match(h.output.textContent,/covers British Columbia/);
  await h.move(vancouver);assert.match(h.markers()[0].options.title,/Vancouver/);assert.equal(h.calls.length,1);
});

test('moving during a pending fetch neither aborts nor duplicates it; the result uses the latest view',async()=>{
  const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);
  await h.move(vancouver);await h.move(victoria);await h.move(vancouver);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].signal.aborted,false);
  release(response());await flush();assert.match(h.markers()[0].options.title,/Vancouver/);
});

test('failed refreshes keep labelled cached coverage across pans and recover automatically',async()=>{
  const h=setup();h.api.setEnabled(true);await flush();
  h.setFetch(async()=>({ok:false,status:503,headers:{get:()=>null}}));await h.advance(180000);
  assert.equal(h.calls.length,2);assert.equal(h.markers().length,1);assert.match(h.output.textContent,/cached reports/);
  await h.move(vancouver);assert.match(h.markers()[0].options.title,/Vancouver/);
  h.api.setEnabled(false);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,2);
  h.setFetch(async()=>response());await h.advance(60000);
  assert.equal(h.calls.length,3);assert.equal(h.output.dataset.state,'ready');assert.doesNotMatch(h.output.textContent,/cached reports/);
});

for(const retry of ['300',new Date(NOW+300000).toUTCString()]) test(`429 honours Retry-After (${retry}) despite pans and toggles`,async()=>{
  const h=setup();h.setFetch(async()=>limited(retry));h.api.setEnabled(true);await flush();
  assert.match(h.output.textContent,/limiting requests/);
  for(let i=0;i<20;i++) await h.move(i%2?victoria:vancouver);
  h.api.setEnabled(false);h.api.setEnabled(true);await flush();assert.equal(h.calls.length,1);
  h.setFetch(async()=>response());await h.advance(296999);assert.equal(h.calls.length,1);
  await h.advance(1);assert.equal(h.calls.length,2);assert.equal(h.markers().length,1);
});

test('rate-limited pagination resumes the missing page without refetching earlier pages',async()=>{
  const h=setup();let calls=0;
  h.setFetch(async()=>++calls===1?response([reports[0]],{next_url:'?offset=500'}):calls===2?limited():response([reports[1]]));
  h.api.setEnabled(true);await flush();assert.equal(h.markers().length,1);assert.match(h.output.textContent,/Coverage is incomplete/);
  await h.move(vancouver);await h.advance(1850);assert.equal(h.calls.length,2);
  await h.advance(120000);assert.equal(h.calls.length,3);
  assert.deepEqual(h.calls.map(call=>call.url.searchParams.get('offset')),['0','500','500']);
  assert.match(h.markers()[0].options.title,/Vancouver/);assert.doesNotMatch(h.output.textContent,/incomplete/);
});

test('expired cached reports disappear during a prolonged provider outage',async()=>{
  const h=setup();h.api.setEnabled(true);await flush();h.setFetch(async()=>limited());
  await h.advance(900001);assert.equal(h.markers().length,0);assert.match(h.output.textContent,/limiting requests/);
});

test('crossing road geometries stay visible even when their endpoints are outside the view',async()=>{
  const h=setup();h.setFetch(async()=>response([{...reports[0],geography:{type:'LineString',coordinates:[[-124,48.42],[-123,48.42]]}}]));
  h.api.setEnabled(true);await flush();assert.equal(h.lines().length,2);
  h.api.setEnabled(false);assert.equal(h.lines().length,0);await h.advance(600000);assert.equal(h.calls.length,1);
});

test('hidden-page cancellation and late responses cannot restore disabled reports',async()=>{
  const h=setup();let release;h.setFetch(()=>new Promise(resolve=>release=resolve));h.api.setEnabled(true);
  h.document.hidden=true;h.listeners.visibilitychange();assert.equal(h.calls[0].signal.aborted,true);
  h.api.setEnabled(false);release(response());await flush();assert.equal(h.markers().length,0);
  await h.advance(600000);assert.equal(h.calls.length,1);
});

test('future toggle filters the same cached feed and retains unknown schedules',async()=>{
  const h=setup();
  h.setFetch(async()=>response([
    {...reports[0],id:'Current',schedule:{intervals:['2026-10-17T00:00/']}},
    {...reports[0],id:'Future',schedule:{intervals:['2026-10-19T12:00/']}},
    {...reports[0],id:'Unknown',schedule:{intervals:['not-a-date/']}}
  ]));
  h.api.setEnabled(true);await flush();assert.equal(h.markers().length,2);assert.match(h.output.textContent,/1 future events hidden/);
  const current=h.markers()[0];h.api.setIncludeFuture(true);assert.equal(h.markers().length,3);assert.equal(h.markers()[0],current);
  assert(h.markers().some(m=>m.options.icon.className.includes('future')));assert.equal(h.calls.length,1);
  h.api.setIncludeFuture(false);assert.equal(h.markers().length,2);assert.equal(h.calls.length,1);
});
