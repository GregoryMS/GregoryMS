const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../assets/maps-core.js');

function setup({storage=new Map(),initial}={}) {
  const elements=new Map(),calls=[];
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
  const window={GregleMaps:core,addEventListener(){}};
  for(const [name,key] of Object.entries({GregleDriveBC:'drivebc',GregleDriveBCCameras:'webcams',GregleDriveBCSigns:'signs',GregleDriveBCFerries:'ferries',GregleFuel:'fuel',GregleEVCharging:'ev',GregleGoogleTraffic:'google',GregleAviation:'aviation',GregleAircraft:'aircraft',GregleVessels:'vessels',GregleMapEmbed:'embed'}))window[name]=provider(key);
  const document={getElementById:get,addEventListener(){},hidden:false};
  const L={TileLayer:{extend:()=>function(){}},tileLayer:()=>({on(){return this;},setZIndex(){return this;},addTo(){return this;}})};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../assets/maps-layers.js','utf8'),{
    window,document,L,URL,AbortController,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    clearInterval(){},clearTimeout(){},setTimeout(){},setInterval(){}
  });
  const api=window.GregleMapLayers({map:{removeLayer(){},closePopup(){}},config:{},initial,notify(){},onChange(){}});
  const change=(id,value)=>{get(id).checked=value;get(id).events.change();};
  return {api,get,calls,storage,change};
}

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
  const initial=core.normalizeLayers({base:'street',fuel:true,ev:true,aircraft:true,vessels:true,aviation:true,drivebc:true,webcams:true,speed:true,messages:true,ferries:true,google:true,maritime:true});
  const h=setup({initial});
  for(const base of ['adsbexchange','plugshare']){
    h.calls.length=0;h.api.setState({...initial,base});
    assert(h.calls.some(c=>c[0]==='embed'&&c[1]===base));
    if(base==='adsbexchange'){
      for(const provider of ['fuel','ev','aircraft','vessels','aviation','drivebc','webcams','ferries','google']) assert(h.calls.some(c=>c[0]===provider&&c[1]===false),provider);
      for(const key of ['speed','messages'])assert(h.calls.some(c=>c[0]==='signs'&&c[1]===key&&c[2]===false),key);
    }
    for(const key of ['fuel','ev','aircraft','vessels','google','maritime'])assert.equal(h.api.getState()[key],true,key);
    assert(h.get('.map-overlay-options').hidden);assert(h.get('.map-overlay-options').disabled);
  }
  h.calls.length=0;h.api.setState(initial);
  assert(h.calls.some(c=>c[0]==='embed'&&c[1]==='street'));
  for(const provider of ['fuel','ev','aircraft','vessels','aviation','drivebc','webcams','ferries','google'])assert(h.calls.some(c=>c[0]===provider&&c[1]===true),provider);
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
