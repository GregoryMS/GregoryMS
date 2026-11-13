const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('3D bridge mirrors current vectors, updates removals and stops on exit',()=>{
 const sent=[];let tick,cleared=false,layers=[];
 const window={},document={hidden:false};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-3d-layers.js'),'utf8'),{window,document,L:{stamp:l=>l.id},setInterval:f=>{tick=f;return 1;},clearInterval:()=>{cleared=true;}});
 const pin={id:1,options:{title:'Live aircraft'},toGeoJSON:()=>({type:'Feature',geometry:{type:'Point',coordinates:[-123,49]}}),getPopup:()=>({getContent:()=>({textContent:'Aircraft details'})})};
 layers=[pin,{getLayers(){},toGeoJSON(){throw Error('group must be skipped');}}];
 const bridge=window.Gregle3DOverlayBridge({map:{eachLayer:f=>layers.forEach(f)},send:m=>sent.push(m)});
 bridge.start();assert.equal(sent[0].data.features.length,1);assert.equal(sent[0].data.features[0].properties.title,'Live aircraft');
 bridge.select({id:1,point:{lng:-123,lat:49}});assert.equal(sent.at(-1).text,'Aircraft details');
 layers=[];tick();assert.equal(sent.at(-1).data.features.length,0);bridge.stop();assert(cleared);
});
test('3D uses OpenFreeMap without requesting a Mapbox token and renders overlay data',()=>{
 const events={},sources=new Map(),styles=[],messages={};let options;
 class MapView{constructor(o){options=o;}once(name,fn){events[name]=fn;}on(){}addControl(){}isStyleLoaded(){return true;}getSource(id){return sources.get(id);}addSource(id,s){sources.set(id,{...s,setData(d){this.data=d;}});}addLayer(layer){styles.push(layer);}remove(){}}
 const window={maplibregl:{Map:MapView,NavigationControl:class{},GeolocateControl:class{}},GregleMaps:require('../assets/maps-core.js'),parent:{},addEventListener:(n,f)=>messages[n]=f};
 const status={hidden:false};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/maps-3d.js'),'utf8'),{window,document:{getElementById:()=>status},location:{hash:'',origin:'https://maps.gregle.uk'},setTimeout:()=>1,clearTimeout(){},fetch(){assert.fail('3D must not request a token');}});
 assert.equal(options.style,'https://tiles.openfreemap.org/styles/liberty');assert.equal(options.accessToken,undefined);events.load();assert.equal(status.hidden,true);assert.equal(styles.length,3);
 const data={type:'FeatureCollection',features:[]};messages.message({source:window.parent,origin:'https://maps.gregle.uk',data:{type:'gregle-3d-overlays',data}});assert.equal(sources.get('gregle-overlays').data,data);
});
