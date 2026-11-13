const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const core = require('../assets/maps-core.js');
function harness() {
  const els = new Map(), events = new Map(), docEvents = new Map(), calls = [], shapes = [];
  const document = { getElementById: el, addEventListener: (name, fn) => docEvents.set(name, fn) };
  function el(id) {
    if (!els.has(id)) els.set(id, {
      hidden: true, style: {}, offsetWidth: 228, offsetHeight: 250,
      clientWidth: 800, clientHeight: 600, events: {},
      addEventListener(name, fn) { this.events[name] = fn; },
      click() { this.events.click(); }, focus() { document.activeElement = this; },
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      contains: () => false, querySelectorAll: () => ['pin','navigate','start','measure','share','what3words'].map(s => el('map-context-' + s))
    });
    return els.get(id);
  }
  el('gregle-map').parentElement = el('stage');
  const map = {
    on(names, fn) { for (const name of names.split(' ')) events.set(name, fn); },
    latLngToContainerPoint: () => ({ x: 799, y: 599 }), getCenter: () => ({ lat: 0, lng: 179 }),
    distance: (a, b) => Math.hypot(a.lat - b.lat, core.wrapLongitude(a.lng - b.lng)) * 1000
  };
  const L = {
    layerGroup: () => ({ addTo() { return this; }, clearLayers() { shapes.length = 0; } }),
    latLng: (lat, lng) => ({ lat, lng }),
    polyline: points => ({ addTo() { shapes.push(points.slice()); } }),
    circleMarker: () => ({ addTo() {} })
  };
  const window = { GreglePlusCodes:require('../assets/maps-pluscodes.js'), GregleMaps: core, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-context-menu.js'), 'utf8'), { window, document, L });
  const api = window.GregleMapContextMenu({ map, enabled: () => true, ignore: () => false,
    onAction() {}, onPin: p => calls.push(['pin', p]), onShare: p => calls.push(['share',p]),
    navigation: { choosePoint: (f,p) => calls.push([f,p]), navigateTo: p => calls.push(['to',p]) }
  });
  const rightClick = (lat=0,lng=181) => events.get('contextmenu')({ latlng: {lat,lng}, originalEvent: {preventDefault(){}} });
  return { el, api, calls, shapes, rightClick, events, docEvents };
}
test('right click coordinates wrap longitude; actions use that exact point and menu stays inside map', () => {
  const h=harness();
  for (const [button, action] of [['pin','pin'],['navigate','to'],['start','from']]) {
    h.rightClick();
    assert.equal(h.el('map-context-menu').style.left,'564px');
    assert.equal(h.el('map-context-menu').style.top,'342px');
    assert.equal(h.el('map-context-lat').textContent,'Latitude: 0.000000');
    assert.equal(h.el('map-context-lng').textContent,'Longitude: -179.000000');
    h.el('map-context-'+button).click();
    assert.equal(h.calls.at(-1)[0],action); assert.equal(h.calls.at(-1)[1].lng,-179);
    assert.equal(h.el('map-context-menu').hidden,true);
  }
});
test('measurement crosses dateline, accumulates points, supports undo, finish and clear', () => {
  const h=harness(); h.rightClick(0,179); h.el('map-context-measure').click();
  const click = (lat,lng) => h.events.get('click')({latlng:{lat,lng}});
  click(0,-179); click(1,-179);
  assert.equal(h.api.measuring,true); assert.equal(h.el('map-measure-total').textContent,'3.00 km');
  assert.equal(h.shapes[0][1].lng,181);
  h.el('map-measure-undo').click(); assert.equal(h.el('map-measure-total').textContent,'2.00 km');
  h.el('map-measure-finish').click(); click(5,-179);
  assert.equal(h.api.measuring,false); assert.equal(h.el('map-measure-total').textContent,'2.00 km');
  h.el('map-measure-clear').click(); assert.equal(h.shapes.length,0); assert.equal(h.el('map-measure').hidden,true);
});
test('Escape dismisses menu before measurement and prevents global pin-clearing shortcuts', () => {
  const h=harness(); h.rightClick(); h.el('map-context-measure').click(); h.rightClick();
  let stopped=0;
  const escape = () => h.docEvents.get('keydown')({key:'Escape',preventDefault(){},stopImmediatePropagation(){stopped++;}});
  escape(); assert.equal(h.el('map-context-menu').hidden,true); assert.equal(h.api.measuring,true);
  escape(); assert.equal(h.api.measuring,false); assert.equal(stopped,2);
});

test('share my location shares the right-clicked spot and dismisses the menu', () => {
  const h=harness(); h.rightClick(); h.el('map-context-share').click();
  assert.equal(h.calls.at(-1)[0],'share'); assert.equal(h.calls.at(-1)[1].lat,0); assert.equal(h.calls.at(-1)[1].lng,-179); assert.equal(h.el('map-context-menu').hidden,true);
});

test('sharing links pin the supplied point and support native, clipboard and manual fallback', async () => {
  const source=fs.readFileSync(require.resolve('../assets/maps.js'),'utf8');
  const shareSource=source.slice(source.indexOf('  async function shareLocation(point) {'),source.indexOf('  const controls = ['));
  let shared,copied,shown; const els=new Map();
  const el=id=>{if(!els.has(id))els.set(id,{focus(){},select(){}});return els.get(id);};
  const navigator={share:async data=>{shared=data;},clipboard:{writeText:async url=>{copied=url;}}};
  const share=vm.runInNewContext(shareSource+';shareLocation',{URL,navigator,document:{body:{classList:{contains:()=>false}}},location:{origin:'https://maps.gregle.uk',pathname:'/'},core,$:el,notify(){},drawer:{show:id=>{shown=id;}}});
  const point={lat:48.5,lng:-123.4,name:'Dropped pin'};
  await share(point); const decoded=core.readHash(new URL(shared.url).hash);
  assert.equal(decoded.pin.lat,point.lat); assert.equal(decoded.pin.lng,point.lng); assert.equal(decoded.view.lat,point.lat);
  navigator.share=undefined; await share(point); assert.equal(copied,shared.url);
  navigator.clipboard.writeText=async()=>{throw new Error('Unavailable');};
  await share(point); assert.equal(el('map-link-input').value,shared.url); assert.equal(shown,'map-link-copy');
});

test('what3words opens the exact menu coordinates without an API request, including pin menu access',()=>{
 const h=harness();h.api.open({lat:48.4284,lng:236.6344});
 assert.equal(h.el('map-context-what3words').href,'https://what3words.com/48.428400,-123.365600');
 assert.match(h.el('map-context-pluscode').textContent,/^OLC: [23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{3}$/);
 assert.equal(h.el('map-context-menu').hidden,false);
 h.el('map-context-what3words').click();assert.equal(h.el('map-context-menu').hidden,true);
});

test('a second touch on the selected pin opens its actions while desktop clicks retain place details',()=>{
 const source=fs.readFileSync(require.resolve('../assets/maps.js'),'utf8');
 const body=source.match(/marker.on\('click', event => \{([\s\S]*?)\n      \}\);/)[1];
 const calls=[],ctx={point:{lat:48,lng:-123},lastTappedPin:null,window:{matchMedia:()=>({matches:false})},contextTools:{open:p=>calls.push('menu')},placeDetails:{select:()=>calls.push('details')}};
 vm.createContext(ctx);vm.runInContext('handler = event => {'+body+'}',ctx);
 ctx.handler({originalEvent:{pointerType:'touch'}});ctx.handler({originalEvent:{pointerType:'touch'}});
 assert.deepEqual(calls,['details','menu']);
 ctx.handler({originalEvent:{pointerType:'mouse'}});assert.equal(calls.at(-1),'details');
});
