const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/maps-core.js');
const source = fs.readFileSync(require.resolve('../assets/maps.js'), 'utf8');
const controller = source.slice(source.indexOf('  // Device position'), source.indexOf('  let lastTappedPin'));
const buttonHandler = source.slice(source.indexOf("  $('map-locate').addEventListener"), source.indexOf("  $('share-pin').addEventListener"));
function setup(permissions) {
  const now = Date.parse('2026-11-13T18:00:00Z'), requests = [], watches = [], markers = [], removed = [], timers = new Map(), messages = [], views = [];
  let nextTimer = 0, click;
  const button = {disabled:false, attrs:{}, addEventListener(type, fn){click=fn;}, setAttribute(k,v){this.attrs[k]=v;}, removeAttribute(k){delete this.attrs[k];}, focus(){}};
  const map = {removeLayer(m){removed.push(m);}, setView(point){views.push(Array.from(point));}};
  function marker(point) {
    const m = {point, bindTooltip(){return this;},addTo(){markers.push(this);return this;},setLatLng(p){this.point=p;},setRadius(){},bringToFront(){}};
    return m;
  }
  const navigator = {permissions, geolocation:{
    getCurrentPosition(success,error,options){requests.push({success,error,options});},
    watchPosition(success,error,options){watches.push({success,error,options});return 0;}, clearWatch(){}
  }};
  const context = {core,map,navigator,usingEmbed:false,document:{hidden:false},L:{circleMarker:marker,circle:marker},Date:{now:()=>now},
    setTimeout(fn,ms){timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout(id){timers.delete(id);},
    $:()=>button,notify:message=>messages.push(message),cancelSearch(){},hideSearch(){},intent:0};
  vm.runInNewContext(controller+buttonHandler+';this.api={showLocation,acceptLocation,getLocation,observeLocationPermission,stopLocation};',context);
  const fix = (timestamp=now) => ({timestamp,coords:{latitude:48.42,longitude:-123.36,accuracy:30}});
  return {api:context.api,button,click:()=>click(),requests,watches,markers,removed,timers,messages,views,navigator,now,fix};
}
test('Tesla zero/non-epoch timestamps display a location dot and expire after receipt',()=>{
  for (const timestamp of [0,123456,NaN]) {
    const h=setup();h.api.acceptLocation(h.fix(timestamp));
    assert.equal(h.markers.length,2);
    const expiry=[...h.timers.values()][0];assert.equal(expiry.ms,60000);expiry.fn();assert.equal(h.removed.length,2);
    assert.equal(h.watches[0].options.enableHighAccuracy,false);
  }
});
test('genuinely stale epoch fixes and invalid coordinates are still rejected',()=>{
  const h=setup();h.api.showLocation(h.fix(h.now-61000));
  const invalid=h.fix();invalid.coords.latitude=91;h.api.showLocation(invalid);
  assert.equal(h.markers.length,0);
});
test('My location centres the map with an approximate Tesla fix and releases the button',()=>{
  const h=setup();h.click();assert(h.button.disabled);
  assert.equal(h.requests[0].options.enableHighAccuracy,false);assert.equal(h.requests[0].options.maximumAge,60000);
  h.requests[0].success(h.fix(0));
  assert.deepEqual(h.views,[[48.42,-123.36]]);assert.equal(h.markers.length,2);
  assert.equal(h.button.disabled,false);assert.equal(h.button.attrs['aria-busy'],undefined);
});
test('a timeout retries a fresh high-accuracy fix and ignores a late first response',()=>{
  const h=setup();h.click();h.requests[0].error({code:3});
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].options.enableHighAccuracy,true);assert.equal(h.requests[1].options.maximumAge,0);
  h.requests[0].success(h.fix());assert.equal(h.views.length,0);
  h.requests[1].success(h.fix());assert.equal(h.views.length,1);assert.equal(h.button.disabled,false);
});
test('permission denial does not retry or leave My location stuck',()=>{
  const h=setup();h.click();h.requests[0].error({code:1});
  assert.equal(h.requests.length,1);assert.equal(h.button.disabled,false);assert.match(h.messages.at(-1),/declined/);
});
test('synchronous geolocation failures restore the button and provide a useful error',()=>{
  const h=setup();h.navigator.geolocation.getCurrentPosition=()=>{throw Error('unsupported');};
  assert.doesNotThrow(h.click);assert.equal(h.button.disabled,false);assert.match(h.messages.at(-1),/could not be found/);
});
test('missing, throwing and rejected Permissions APIs cannot prevent location use',async()=>{
  for (const permissions of [undefined,{}, {query(){throw Error('unsupported');}}, {query:()=>Promise.reject(Error('unsupported'))}]) {
    const h=setup(permissions);await h.api.observeLocationPermission();h.click();h.requests[0].success(h.fix(0));assert.equal(h.views.length,1);
  }
});
test('legacy permission objects work and revocation removes the location',async()=>{
  const permission={state:'granted'},h=setup({query:async()=>permission});
  await h.api.observeLocationPermission();assert.equal(h.watches.length,1);
  h.watches[0].success(h.fix());permission.state='denied';permission.onchange();assert.equal(h.removed.length,2);
});
test('temporary watch failures retain a fresh marker until expiry, denial clears it',()=>{
  const h=setup();h.api.acceptLocation(h.fix());h.watches[0].error({code:3});assert.equal(h.removed.length,0);
  h.watches[0].error({code:1});assert.equal(h.removed.length,2);
});
