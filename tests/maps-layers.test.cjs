const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../assets/maps-core.js');

function setup({storage=new Map(),initial,config={},dark=false,pixelRatio=1,zoom=13,onTrafficKeyChange=()=>{}}={}) {
  const elements=new Map(),calls=[],tiles=[],timers=[],notices=[],events={};
  let themeObserver;
  const get=id=>{
    if(!elements.has(id))elements.set(id,{
      checked:false,hidden:true,value:'',dataset:{},events:{},
      addEventListener(name,fn){this.events[name]=fn;},
      setAttribute(){},contains(){return false;},focus(){},
      querySelector:selector=>get(selector),querySelectorAll:()=>[]
    });
    return elements.get(id);
  };
  const provider=name=>()=>({
    setEnabled(...args){calls.push([name,...args]);},
    setIncludeFuture(value){calls.push(['future',value]);},
    setSelection(...args){calls.push([name,...args]);},setSource(){},hasKey:()=>true,
    setBase(value){calls.push(['embed',value]);}
  });
  const window={devicePixelRatio:pixelRatio,GregleMaps:core,addEventListener:(name,fn)=>events[name]=fn};
  window.GregleTransit=provider('transit');
  for(const [name,key] of Object.entries({GregleDriveBC:'drivebc',GregleDriveBCCameras:'webcams',GregleDriveBCSigns:'signs',GregleDriveBCFerries:'ferries',GregleFuel:'fuel',GregleEVCharging:'ev',GregleGoogleTraffic:'google',GregleAviation:'aviation',GregleAircraft:'aircraft',GregleVessels:'vessels',GregleStreetView:'streetview',GregleMapEmbed:'embed'}))window[name]=provider(key);
  const document={body:{classList:{contains:()=>false}},documentElement:{classList:{contains:()=>dark}},getElementById:get,addEventListener(){},hidden:false};
  const L={TileLayer:{extend:()=>function(){}},tileLayer:(url,options)=>{const tile={url,options,events:{},on(name,fn){this.events[name]=fn;return this;},setZIndex(){return this;},addTo(){return this;}};tiles.push(tile);return tile;}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../assets/maps-layers.js','utf8'),{
    window,document,L,URL,AbortController,
    MutationObserver:class {constructor(fn){themeObserver=fn;}observe(){}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    clearInterval(){},clearTimeout(){},setTimeout(fn){timers.push(fn);},setInterval(){}
  });
  const api=window.GregleMapLayers({map:{getZoom:()=>zoom,setMaxZoom(value){calls.push(['maxZoom',value]);zoom=Math.min(zoom,value);},removeLayer(){},closePopup(){}},config,initial,notify(...args){notices.push(args);},onChange(){},onTrafficKeyChange});
  const change=(id,value)=>{get(id).checked=value;get(id).events.change();};
  return {api,get,calls,storage,change,tiles,notices,emit:(name,detail)=>events[name]?.({detail}),flush:()=>{while(timers.length)timers.shift()();},theme:value=>{dark=value;themeObserver();}};
}

test('transit station schedules follow the base map and pause for Street View and embeds',()=>{
 const h=setup({initial:{base:'transit'}});assert(h.calls.some(c=>c[0]==='transit'&&c[1]===true));
 for(const next of [{base:'transit',streetview:true},{base:'street'},{base:'plugshare'}]){h.calls.length=0;h.api.setState(next);assert(h.calls.some(c=>c[0]==='transit'&&c[1]===false));}
 h.calls.length=0;h.api.setState({base:'transit'});assert(h.calls.some(c=>c[0]==='transit'&&c[1]===true));
});

test('the DriveBC switch starts every non-webcam provider and turns the group off together',()=>{
  const h=setup();
  h.change('map-drivebc',true);
  for(const key of ['drivebc','future','speed','messages','ferries'])assert.equal(h.api.getState()[key],true,key);
  assert.equal(h.api.getState().webcams,false);
  for(const call of [['drivebc',true],['future',true],['signs','speed',true],['signs','messages',true],['ferries',true]])assert(h.calls.some(c=>JSON.stringify(c)===JSON.stringify(call)),JSON.stringify(call));
  assert(!h.calls.some(c=>c[0]==='webcams'&&c[1]===true));
  h.change('map-drivebc',false);
  for(const key of ['drivebc','future','speed','messages','ferries','webcams'])assert.equal(h.api.getState()[key],false,key);
});

test('sublayer opt-outs survive saved preferences and copied map links',()=>{
  const h=setup();h.change('map-drivebc',true);h.change('map-drivebc-messages',false);
  const saved=setup({storage:h.storage}).api.getState();
  assert.equal(saved.drivebc,true);assert.equal(saved.messages,false);assert.equal(saved.speed,true);assert.equal(saved.ferries,true);assert.equal(saved.webcams,false);
  const linked=setup({initial:core.readLayers(core.makeHash(core.defaultView,null,saved))}).api.getState();
  for(const key of Object.keys(saved))assert.equal(linked[key],saved[key],key);
});

test('webcams stay independently controlled even when the DriveBC group is toggled',()=>{
  const h=setup();h.change('map-drivebc-cameras',true);h.change('map-drivebc',true);
  assert.equal(h.api.getState().webcams,true);
  h.change('map-drivebc',false);assert.equal(h.api.getState().webcams,true);
  h.change('map-drivebc-cameras',false);assert.equal(h.api.getState().webcams,false);
});

test('both embedded maps pause all native data and restore the saved selections on return',()=>{
  const initial=core.normalizeLayers({base:'street',streetview:true,fuel:true,ev:true,aircraft:true,vessels:true,aviation:true,drivebc:true,webcams:true,speed:true,messages:true,ferries:true,google:true,maritime:true});
  const h=setup({initial});
  for(const base of ['adsbexchange','plugshare']){
    h.calls.length=0;h.api.setState({...initial,base});
    assert(h.calls.some(c=>c[0]==='embed'&&c[1]===base));
    if(base==='adsbexchange'){
      for(const provider of ['fuel','ev','aircraft','vessels','aviation','drivebc','webcams','ferries','google','streetview']) assert(h.calls.some(c=>c[0]===provider&&c[1]===false),provider);
      for(const key of ['speed','messages'])assert(h.calls.some(c=>c[0]==='signs'&&c[1]===key&&c[2]===false),key);
    }
    for(const key of ['fuel','ev','aircraft','vessels','google','maritime','streetview'])assert.equal(h.api.getState()[key],true,key);
    assert(h.get('.map-overlay-options').hidden);assert(h.get('.map-overlay-options').disabled);
  }
  h.calls.length=0;h.api.setState(initial);
  assert(h.calls.some(c=>c[0]==='embed'&&c[1]==='street'));
  for(const provider of ['fuel','ev','aircraft','vessels','aviation','drivebc','webcams','ferries','google','streetview'])assert(h.calls.some(c=>c[0]===provider&&c[1]===true),provider);
  assert(!h.get('.map-overlay-options').hidden);assert(!h.get('.map-overlay-options').disabled);
});

test('saved and shared ADS-B Exchange mode can restore the embedded map while preserving native preferences',()=>{
  const state=core.normalizeLayers({base:'adsbexchange',aircraft:true,ev:true,maritime:true});
  for(const options of [{storage:new Map([['gregle-maps-layers',JSON.stringify({...state,teslaDefault:true})]])},{initial:core.readLayers(core.makeHash(core.defaultView,null,state))}]){
    const h=setup(options);assert.deepEqual({...h.api.getState()},state);
    assert(h.calls.some(c=>c[0]==='embed'&&c[1]==='adsbexchange'));
    assert(!h.calls.some(c=>c[0]==='aircraft'&&c[1]===true));
  }
});

test('connecting a key for routing leaves the tile overlay off and notifies routing on connect and forget',()=>{
 let changes=0;const h=setup({onTrafficKeyChange:()=>changes++});
 h.api.connectTraffic();assert.equal(h.get('traffic-key-form').hidden,false);
 h.get('traffic-api-key').value='test-key-1234567890';h.get('traffic-key-form').events.submit({preventDefault(){}});
 assert.equal(h.api.getState().traffic,false);assert.equal(changes,1);assert.equal(h.storage.get('gregle-maps-tomtom-key'),'test-key-1234567890');
 h.get('traffic-forget').events.click();assert.equal(changes,2);assert.equal(h.storage.has('gregle-maps-tomtom-key'),false);
});

test('the shared TomTom connection stays off and keeps the personal-key UI and required-key description',()=>{
 const h=setup({config:{serverTomTom:true}});
 assert.equal(h.api.getState().traffic,false);
 assert.equal(h.get('traffic-layer-description').textContent,'API key required for traffic');
 assert.equal(h.get('traffic-connect').textContent,'Connect TomTom');
 h.api.connectTraffic();assert.equal(h.get('traffic-key-form').hidden,false);
});


test('satellite uses the secret-free relay with Esri credits, saves and shares the base, and retains overlays',()=>{
  const config={satelliteURL:'https://gregle-esri.square-rain-5ded.workers.dev/tiles/{z}/{x}/{y}.jpg'};
  const initial=core.normalizeLayers({base:'satellite',maritime:true,aircraft:true});
  const h=setup({config,initial});
  const tile=h.tiles[0];
  assert.equal(tile.url,config.satelliteURL);assert.equal(tile.options.crossOrigin,'anonymous');
  assert.equal(tile.options.maxNativeZoom,23);assert.match(tile.options.attribution,/Powered by.*Esri/);assert.match(tile.options.attribution,/Vantor/);
  tile.events.loading();tile.events.tileload();tile.events.load();
  assert.equal(h.get('base-layer-status').textContent,'Esri World Imagery · satellite map');
  assert(h.calls.some(c=>c[0]==='aircraft'&&c[1]===true));
  assert.equal(core.readLayers(core.makeHash(core.defaultView,null,h.api.getState())).base,'satellite');
  h.change('map-maritime',false);
  assert.equal(setup({config,storage:h.storage}).api.getState().base,'satellite');
});

test('satellite survives dark theme startup and changes, and all failed tiles fall back to street',()=>{
  const h=setup({initial:{base:'satellite'},dark:true,config:{tileURL:'street',satelliteURL:'satellite'}});
  assert.equal(h.api.getState().base,'satellite');
  h.theme(false);h.theme(true);assert.equal(h.api.getState().base,'satellite');
  const tile=h.tiles[0];tile.events.loading();tile.events.tileerror({});tile.events.load();h.flush();
  assert.equal(h.api.getState().base,'street');assert.equal(h.tiles.at(-1).url,'street');
  assert.match(h.notices.at(-1)[0],/Satellite imagery.*unavailable/);
});


test('Retina satellite tiles use higher source detail, cap at 23, and fall back without losing the view',()=>{
  const h=setup({initial:{base:'satellite'},pixelRatio:2,zoom:23});
  assert(h.calls.some(c=>c[0]==='maxZoom'&&c[1]===23));
  let tile=h.tiles.at(-1);
  assert.equal(tile.options.tileSize,128);assert.equal(tile.options.zoomOffset,1);
  assert.equal(tile.options.maxZoom,23);assert.equal(tile.options.maxNativeZoom,22);
  for(const sourceZoom of [23,22,21,20]){
    tile.events.loading();tile.events.tileerror({coords:{z:sourceZoom-1}});tile.events.load();h.flush();
    tile=h.tiles.at(-1);
    assert.equal(tile.options.maxNativeZoom,sourceZoom-2);
    assert.equal(h.api.getState().base,'satellite');
  }
  tile.events.loading();tile.events.tileload();tile.events.load();
  assert.match(h.get('base-layer-status').textContent,/using available detail/);
  h.api.setState({base:'street'});
  assert.deepEqual(h.calls.filter(call=>call[0]==='maxZoom').at(-1),['maxZoom',19]);
});

test('cycle and transit bases use attributed tiles and preserve choices, overlays and theme changes',()=>{
  const config={cycleURL:'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',transitURL:'https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png'};
  for(const [base,label,credit,nativeZoom] of [['cycle','CyclOSM','CyclOSM',19],['transit','ÖPNVKarte','MeMoMaps',18]]){
    const h=setup({config,initial:{base,aircraft:true,maritime:true},dark:true});
    assert.equal(h.api.getState().base,base); const tile=h.tiles[0];
    assert.equal(tile.url,config[base+'URL']);assert.equal(tile.options.maxNativeZoom,nativeZoom);
    assert.match(tile.options.attribution,new RegExp(credit));assert.match(tile.options.attribution,/OpenStreetMap/);
    tile.events.loading();tile.events.tileload();tile.events.load();assert(h.get('base-layer-status').textContent.startsWith(label));
    assert(h.calls.some(c=>c[0]==='aircraft'&&c[1]===true));
    h.theme(false);h.theme(true);assert.equal(h.api.getState().base,base);
    assert.equal(core.readLayers(core.makeHash(core.defaultView,null,h.api.getState())).base,base);
    h.change('map-maritime',false);assert.equal(setup({config,storage:h.storage,dark:true}).api.getState().base,base);
  }
});

test('unavailable cycle and transit tiles recover to the street map with a notice',()=>{
  for(const base of ['cycle','transit']){
    const h=setup({initial:{base},config:{tileURL:'street',[base+'URL']:base}});
    const tile=h.tiles[0];tile.events.loading();tile.events.tileerror({});tile.events.load();h.flush();
    assert.equal(h.api.getState().base,'street');assert.equal(h.tiles.at(-1).url,'street');assert.match(h.notices.at(-1)[0],/unavailable/);
  }
});

test('OpenFreeMap 3D retains live vector overlays and preserves raster preferences for return',()=>{
 const state={base:'3d',aircraft:true,drivebc:true,ev:true,aviation:true,maritime:true,google:true};
 const h=setup({initial:state,dark:true});
 assert.equal(h.api.getState().base,'3d');
 for(const name of ['aircraft','drivebc','ev'])assert(h.calls.some(c=>c[0]===name&&c[1]===true),name);
 assert(!h.calls.some(c=>['aviation','google'].includes(c[0])&&c[1]===true));
 assert.equal(h.get('map-layers-panel').querySelector('.map-overlay-options').disabled,false);
 h.calls.length=0;h.api.setState({...state,base:'street'});
 assert(h.calls.some(c=>c[0]==='aviation'&&c[1]===true));assert(h.calls.some(c=>c[0]==='google'&&c[1]===true));
});

test('3D navigation suspends background providers and restores selected layers on exit',()=>{
 const h=setup({initial:{aircraft:true,drivebc:true,ev:true}});h.calls.length=0;
 h.emit('gregle-navigation-3d',true);
 for(const name of ['aircraft','drivebc','ev'])assert(h.calls.some(c=>c[0]===name&&c[1]===false),name);
 assert.equal(h.api.getState().aircraft,true);h.calls.length=0;
 h.emit('gregle-navigation-3d',false);
 for(const name of ['aircraft','drivebc','ev'])assert(h.calls.some(c=>c[0]===name&&c[1]===true),name);
});
