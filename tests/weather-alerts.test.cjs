const {test} = require('node:test');
const assert = require('node:assert/strict');
const {activeAlerts, officialURL, createController, REFRESH_MS} = require('../assets/weather-alerts.js');
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
test('international selections stop Canadian checks and hide their cards',async()=>{
  const h=harness(); h.setFetch(async()=>response(feed([alert()])));
  await h.controller.setLocation(victoria);
  await h.controller.setLocation({name:'London',country:'GB',latitude:51.5,longitude:-.1});
  assert.equal(h.calls.length,1); assert.equal(h.timers.size,0);
  assert.equal(h.node('weatherAlerts').hidden,true); assert.equal(h.node('weatherAlertStatus').hidden,true);
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
