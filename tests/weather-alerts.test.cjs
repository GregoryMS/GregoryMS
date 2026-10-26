const {test} = require('node:test');
const assert = require('node:assert/strict');
const {activeAlerts, officialURL, ukAlerts, ukAlertsURL, createController, REFRESH_MS, UK_REFRESH_MS} = require('../assets/weather-alerts.js');
const weather = require('../assets/weather-core.js');
const NOW = Date.parse('2026-10-08T15:00:00Z');
const iso = time => new Date(time).toISOString();
// City Page Weather schema, including the observed alertColourLevel.en field.
function alert(overrides = {}) {
  return {type:{en:'warning'}, description:{en:'ORANGE WARNING - WIND'},
    alertColourLevel:{en:'orange'}, eventIssue:{en:iso(NOW-3600000)},
    expiryTime:{en:iso(NOW+3600000)},
    url:{en:'https://weather.gc.ca/warnings/report_e.html?bcrm1#wind'}, ...overrides};
}
const feed = (warnings = [], updated = NOW) => ({properties:{lastUpdated:iso(updated), warnings}});
const response = data => ({ok:true, json:async()=>data});
const flush = async () => { for(let i=0;i<15;i++) await Promise.resolve(); };
test('official colours are separate from alert types, with statements neutral and highest risk first', () => {
  const data = feed([
    alert({description:{en:'Yellow warning - Rain'}, alertColourLevel:{en:'yellow'}}),
    alert({type:{en:'statement'}, description:{en:'SPECIAL WEATHER STATEMENT'}, alertColourLevel:undefined}),
    alert({type:{en:'watch'}, description:{en:'Red watch - Storm'}, alertColourLevel:{en:'red'}}),
    alert({type:{en:'advisory'}, description:{en:'Orange advisory - Fog'}, alertColourLevel:{en:'orange'}})
  ]);
  assert.deepEqual(activeAlerts(data,NOW).map(a=>[a.type,a.colour]),
    [['watch','red'],['advisory','orange'],['warning','yellow'],['statement','neutral']]);
  assert.equal(activeAlerts(feed([alert({alertColourLevel:undefined})]),NOW)[0].colour,'orange');
  assert.equal(activeAlerts(feed([alert({alertColourLevel:undefined,description:{en:'Wind warning'}})]),NOW)[0].colour,'neutral');
});
test('expired, cancelled and duplicate alerts are removed; an explicit empty feed is clear', () => {
  const warning=alert();
  assert.equal(activeAlerts(feed([warning, warning, alert({expiryTime:{en:iso(NOW)}}),
    alert({type:{en:'ended'}}), alert({description:{en:'Wind warning ended'}})]),NOW).length,1);
  assert.deepEqual(activeAlerts(feed(),NOW),[]);
});
test('malformed or stale feeds cannot be mistaken for an all-clear', () => {
  for(const data of [{}, {properties:{lastUpdated:iso(NOW)}}, feed(null), feed([],NOW-7200001),
    feed([],NOW+300001), feed([alert({eventIssue:{en:'bad'}})]),
    feed([alert({expiryTime:{en:'bad'}})]), feed([alert({type:{en:'unexpected'}})]), feed([null])]) {
    assert.throws(()=>activeAlerts(data,NOW));
  }
});
test('alert links accept only official HTTPS weather hosts', () => {
  for(const value of ['javascript:alert(1)','https://weather.gc.ca.evil.example/','https://user@weather.gc.ca/', 'http://weather.gc.ca/']) assert.equal(officialURL(value),null);
  assert.equal(officialURL('https://weather.gc.ca/warnings/report_e.html?a#b'),'https://weather.gc.ca/warnings/report_e.html?a#b');
});

function harness() {
  const nodes=new Map(), listeners={}, timers=new Map(), calls=[];
  let clock=NOW, nextTimer=0, fetchImpl=async()=>response(feed());
  const element = tag => ({tagName:tag,hidden:true,children:[],textContent:'',innerHTML:'',
    append(...children){this.children.push(...children);}, replaceChildren(...children){this.children=children;}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
  const document={hidden:false,getElementById:node,createElement:element,addEventListener(type,callback){listeners[type]=callback;}};
  class Clock extends Date {static now(){return clock;}}
  const win={document,Date:Clock,AbortController,GregleWeather:weather,
    fetch(url,opts){calls.push({url,...opts});return fetchImpl(url,opts);},
    setTimeout(fn,ms){timers.set(++nextTimer,{fn,ms});return nextTimer;}, clearTimeout(id){timers.delete(id);}};
  const controller=createController(win);
  return {controller,node,document,listeners,timers,calls,
    setFetch(fn){fetchImpl=fn;},advance(ms){clock+=ms;},
    fire(ms){const entry=[...timers].find(([,timer])=>timer.ms===ms);assert.ok(entry,`timer ${ms} exists`);timers.delete(entry[0]);return entry[1].fn();}};
}
const victoria={id:'bc-75',name:'Victoria',country:'CA',latitude:48.42,longitude:-123.39,timezone:'America/Vancouver'};
test('cards use text safely, link to official details, and clear after cancellation or a failed refresh',async()=>{
  const h=harness(); h.setFetch(async()=>response(feed([alert({description:{en:'<img src=x> warning'},url:{en:'javascript:alert(1)'}})])));
  await h.controller.setLocation(victoria);
  assert.equal(h.node('weatherAlerts').hidden,false);
  const card=h.node('weatherAlertList').children[0];
  assert.equal(card.children[1].textContent,'<img src=x> warning'); assert.equal(card.children[1].innerHTML,'');
  assert.match(card.children[3].href,/^https:\/\/weather.gc.ca\/en\/location/);
  assert.match(h.node('weatherAlertLocation').textContent,/Victoria/);
  assert.equal(h.node('weatherAlertStatus').hidden,true);
  assert.ok([...h.timers.values()].some(timer=>timer.ms===REFRESH_MS));
  h.setFetch(async()=>response(feed())); await h.controller.refresh();
  assert.equal(h.node('weatherAlerts').hidden,true); assert.equal(h.node('weatherAlertList').children.length,0);
  h.setFetch(async()=>{throw Error('Offline');}); await h.controller.refresh();
  assert.equal(h.node('weatherAlerts').hidden,true); assert.equal(h.node('weatherAlertStatus').hidden,false);
  assert.match(h.node('weatherAlertStatus').children[0].textContent,/could not be checked/);
  h.setFetch(async()=>response(feed([alert()]))); await h.controller.refresh();
  assert.equal(h.node('weatherAlerts').hidden,false); assert.equal(h.node('weatherAlertStatus').hidden,true);
});
test('periodic checks discover new alerts without reloading the forecast',async()=>{
  const h=harness(); await h.controller.setLocation(victoria);
  assert.equal(h.node('weatherAlerts').hidden,true);
  h.advance(REFRESH_MS); h.setFetch(async()=>response(feed([alert()])));
  await h.fire(REFRESH_MS);
  assert.equal(h.node('weatherAlerts').hidden,false); assert.equal(h.calls.length,2);
});
test('expiry clears a banner before a stalled update and timeout leaves a source fallback',async()=>{
  const h=harness(); h.setFetch(async()=>response(feed([alert({expiryTime:{en:iso(NOW+60000)}})])));
  await h.controller.setLocation(victoria); h.advance(60000);
  h.setFetch((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Timeout')))));
  const pending=h.fire(60000); assert.equal(h.node('weatherAlerts').hidden,true);
  h.fire(15000); await pending;
  assert.equal(h.node('weatherAlertStatus').hidden,false);
});
test('changing cities clears old cards and late responses cannot restore them',async()=>{
  const h=harness(), pending=[];
  h.setFetch(()=>new Promise(resolve=>pending.push(resolve)));
  const first=h.controller.setLocation(victoria);
  const second=h.controller.setLocation({...victoria,id:'bc-74',name:'Vancouver'});
  assert.equal(h.calls[0].signal.aborted,true); assert.equal(h.node('weatherAlerts').hidden,true);
  pending[1](response(feed())); await second;
  pending[0](response(feed([alert()]))); await first;
  assert.equal(h.node('weatherAlerts').hidden,true);
  assert.match(h.node('weatherAlertLocation').textContent,/Vancouver/);
});
test('locations outside Canada and the UK stop checks and hide their cards',async()=>{
  const h=harness(); h.setFetch(async()=>response(feed([alert()])));
  await h.controller.setLocation(victoria);
  await h.controller.setLocation({name:'Oslo',country:'NO',latitude:59.91,longitude:10.75});
  assert.equal(h.calls.length,1); assert.equal(h.timers.size,0);
  assert.equal(h.node('weatherAlerts').hidden,true); assert.equal(h.node('weatherAlertStatus').hidden,true);
});

// ArcGIS field names and dates are taken from the Met Office's public live layer.
const ukFields = ['OBJECTID','weathertype','warninglevel','warningheadline','issuedDate','validfromdate','validtodate','affectedAreas','whatToExpect','warningFurtherDetails','warningUpdateDescription'];
const ukFeed = (warnings = []) => ({objectIdFieldName:'OBJECTID',fields:ukFields.map(name=>({name})), features:warnings.map(attributes=>({attributes}))});
const ukWarning = (overrides = {}) => ({OBJECTID:4333,weathertype:'WIND',warninglevel:'YELLOW',
  warningheadline:'Strong winds may lead to damaging gusts and transport disruption.',
  issuedDate:NOW-3600000,validfromdate:NOW+3600000,validtodate:NOW+7200000,
  affectedAreas:'London & South East England',whatToExpect:'Longer journey times are possible.',
  warningFurtherDetails:'A period of strong winds is expected.',warningUpdateDescription:null,...overrides});
const london={name:'London',country:'GB',latitude:51.5085,longitude:-0.1257,timezone:'Europe/London'};
test('UK requests select the exact point against the official warning polygons',()=>{
  const url=new URL(ukAlertsURL(london));
  assert.equal(url.origin,'https://services.arcgis.com');
  assert.match(url.pathname,/Met_Office_National_Severe_Weather_Warning_Service_Live\/FeatureServer\/0\/query$/);
  assert.equal(url.searchParams.get('geometry'),'-0.1257,51.5085');
  assert.equal(url.searchParams.get('geometryType'),'esriGeometryPoint');
  assert.equal(url.searchParams.get('inSR'),'4326');
  assert.equal(url.searchParams.get('spatialRel'),'esriSpatialRelIntersects');
  assert.equal(url.searchParams.get('returnGeometry'),'false');
  for(const point of [{}, {...london,latitude:91}, {...london,longitude:-181}, {...london,latitude:null}, {...london,longitude:NaN}]) assert.throws(()=>ukAlertsURL(point));
});
test('UK warnings preserve yellow, amber and red, headline, details and upcoming validity',()=>{
  const parsed=ukAlerts(ukFeed([
    ukWarning(),ukWarning({warninglevel:'AMBER',warningheadline:'Amber warning headline'}),
    ukWarning({warninglevel:'RED',warningheadline:'Red warning headline',weathertype:'WIND AND RAIN'})
  ]),NOW);
  assert.deepEqual(parsed.map(item=>item.colour),['red','amber','yellow']);
  assert.equal(parsed[0].weatherType,'WIND AND RAIN');
  assert.equal(parsed[2].title,ukWarning().warningheadline);
  assert.equal(parsed[2].starts,NOW+3600000);
  assert.equal(parsed[2].expires,NOW+7200000);
  assert.deepEqual(parsed[2].details.map(([title])=>title),['What to expect','Further details','Affected areas']);
});
test('UK empty, expired, removed and duplicate warnings are handled without retaining old alerts',()=>{
  const warning=ukWarning();
  assert.equal(ukAlerts(ukFeed([warning,warning,ukWarning({validfromdate:NOW-3600000,validtodate:NOW})]),NOW).length,1);
  assert.deepEqual(ukAlerts(ukFeed(),NOW),[]);
  // Actual response for London: no field schema is included with an empty result.
  assert.deepEqual(ukAlerts({objectIdFieldName:'OBJECTID',uniqueIdField:{name:'OBJECTID',isSystemMaintained:true},globalIdFieldName:'GlobalID',features:[]},NOW),[]);
});
test('UK service errors, incomplete results, unknown levels and invalid dates never become an all-clear',()=>{
  for(const data of [{}, {features:[]}, {...ukFeed(),error:{code:500}}, {...ukFeed(),exceededTransferLimit:true},
    {...ukFeed([ukWarning()]),fields:[]}, {...ukFeed(),features:null}, ukFeed([null]),
    ukFeed([ukWarning({warninglevel:'PURPLE'})]), ukFeed([ukWarning({warningheadline:''})]),
    ukFeed([ukWarning({issuedDate:NOW+300001})]), ukFeed([ukWarning({validfromdate:null})]),
    ukFeed([ukWarning({validtodate:NOW+3600000})]), ukFeed([ukWarning({validtodate:'bad'})]),
    ukFeed([ukWarning({whatToExpect:{html:'unsafe'}})])]) assert.throws(()=>ukAlerts(data,NOW));
});
test('UK cards use the same warning layout, official source, local times and plain-text details',async()=>{
  const h=harness();h.setFetch(async()=>response(ukFeed([ukWarning({warninglevel:'AMBER',warningheadline:'<img src=x> wind warning',whatToExpect:'<script>unsafe()</script>'})])));
  await h.controller.setLocation(london);
  const card=h.node('weatherAlertList').children[0];
  assert.equal(card.className,'weather-alert weather-alert--amber');
  assert.equal(card.children[0].textContent,'amber warning · WIND');
  assert.equal(card.children[1].textContent,'<img src=x> wind warning');
  assert.equal(card.children[1].innerHTML,'');
  assert.match(card.children[2].textContent,/Issued .* · Valid .* – /);
  assert.equal(card.children[3].href,'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings');
  assert.equal(card.children[3].textContent,'Read the Met Office warning ↗');
  assert.equal(card.children[4].children[2].textContent,'<script>unsafe()</script>');
  assert.equal(card.children[4].children[2].innerHTML,'');
  assert.equal(h.node('weatherAlertLocation').textContent,'Met Office Weather Warnings · London');
  assert.equal(h.node('ukWarningSource').hidden,false);
  assert.match(h.node('ukWarningCopyright').textContent,/© British Crown copyright 2026, Met Office/);
  assert.equal(h.node('weatherAlerts').hidden,false);
  assert.equal(h.node('weatherAlertStatus').hidden,true);
  assert.ok([...h.timers.values()].some(timer=>timer.ms===UK_REFRESH_MS));
  assert.ok(h.calls.every(call=>call.url.startsWith('https://services.arcgis.com/')));
});
test('UK warnings refresh every two minutes and disappear when withdrawn',async()=>{
  const h=harness();h.setFetch(async()=>response(ukFeed([ukWarning()])));
  await h.controller.setLocation(london);
  h.advance(UK_REFRESH_MS);h.setFetch(async()=>response(ukFeed()));await h.fire(UK_REFRESH_MS);
  assert.equal(h.node('weatherAlerts').hidden,true);
  assert.equal(h.node('weatherAlertList').children.length,0);
  assert.equal(h.node('weatherAlertStatus').hidden,true);
  assert.ok(h.calls.every(call=>call.cache==='no-store'));
});
test('UK failures expose the Met Office fallback and recover on the next check',async()=>{
  const h=harness();h.setFetch(async()=>response({error:{code:500}}));
  await h.controller.setLocation(london);
  assert.equal(h.node('weatherAlerts').hidden,true);
  assert.equal(h.node('weatherAlertStatus').hidden,false);
  assert.equal(h.node('weatherAlertStatus').children[1].textContent,'Check Met Office warnings ↗');
  assert.equal(h.node('weatherAlertStatus').children[1].href,'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings');
  h.setFetch(async()=>response(ukFeed([ukWarning()])));await h.fire(UK_REFRESH_MS);
  assert.equal(h.node('weatherAlerts').hidden,false);
  assert.equal(h.node('weatherAlertStatus').hidden,true);
});
test('UK expiry removes a warning while an update is stalled, then times out to the official fallback',async()=>{
  const h=harness();h.setFetch(async()=>response(ukFeed([ukWarning({validfromdate:NOW-60000,validtodate:NOW+60000})])));
  await h.controller.setLocation(london);h.advance(60000);
  h.setFetch((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Timeout')))));
  const pending=h.fire(60000);assert.equal(h.node('weatherAlerts').hidden,true);
  h.fire(15000);await pending;assert.equal(h.node('weatherAlertStatus').hidden,false);
});
test('switching between countries aborts old warning requests and prevents cross-location banners',async()=>{
  const h=harness(),pending=[];h.setFetch(()=>new Promise(resolve=>pending.push(resolve)));
  const canadian=h.controller.setLocation(victoria),british=h.controller.setLocation(london);
  assert.equal(h.calls[0].signal.aborted,true);
  pending[1](response(ukFeed([ukWarning()])));await british;
  pending[0](response(feed([alert()])));await canadian;
  assert.equal(h.node('weatherAlertLocation').textContent,'Met Office Weather Warnings · London');
  const oldUK=h.controller.refresh();
  await h.controller.setLocation({name:'Oslo',country:'NO',latitude:59.91,longitude:10.75});
  pending[2](response(ukFeed([ukWarning()])));await oldUK;
  assert.equal(h.node('weatherAlerts').hidden,true);assert.equal(h.timers.size,0);
  h.setFetch(async()=>response(feed([alert()])));await h.controller.setLocation(victoria);
  assert.equal(h.node('ukWarningSource').hidden,true);
  assert.equal(h.node('weatherAlertLocation').textContent,'Environment Canada · Victoria');
});
test('hidden pages stop polling and recheck when visible again',async()=>{
  const h=harness(); await h.controller.setLocation(victoria);
  h.document.hidden=true; h.listeners.visibilitychange(); assert.equal(h.timers.size,0);
  h.setFetch(async()=>response(feed([alert()])));
  h.document.hidden=false; h.listeners.visibilitychange(); await flush();
  assert.equal(h.calls.length,2); assert.equal(h.node('weatherAlerts').hidden,false);
});
test('searched Canadian locations use the official nearby city and reuse the directory',async()=>{
  const h=harness(); h.setFetch(async url=>response(url.includes('limit=1000')?
    {features:[{geometry:{coordinates:[-79.38,43.65]},properties:{identifier:'on-143',name:{en:'Toronto'}}}]}:feed([alert()])));
  await h.controller.setLocation({country:'CA',name:'Central Toronto',latitude:43.65,longitude:-79.38,timezone:'America/Toronto'});
  assert.match(h.calls.at(-1).url,/items\/on-143/); assert.match(h.node('weatherAlertLocation').textContent,/Toronto/);
  await h.controller.refresh(); assert.equal(h.calls.filter(call=>call.url.includes('limit=1000')).length,1);
});
