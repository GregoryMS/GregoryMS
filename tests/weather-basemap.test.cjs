const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../assets/weather-basemap.js');
test('weather backgrounds follow the page theme and release their observer on map removal',()=>{
 let dark=false,changed,unload,disconnected=false;const urls=[];
 const layer={addTo(){return this;},setUrl(url){urls.push(url);}};
 const win={document:{documentElement:{classList:{contains:()=>dark}}},L:{tileLayer(url,options){urls.push(url);assert.match(options.attribution,/Stadia Maps/);assert.match(options.attribution,/OpenMapTiles/);assert.match(options.attribution,/OpenStreetMap/);assert.match(options.attribution,/FireSmoke/);return layer;}},MutationObserver:class{constructor(fn){changed=fn;}observe(){}disconnect(){disconnected=true;}}};
 create(win).addTo({on(name,fn){assert.equal(name,'unload');unload=fn;}},{credit:'FireSmoke'});
 assert.match(urls[0],/\/alidade_smooth\//);dark=true;changed();assert.match(urls[1],/\/alidade_smooth_dark\//);
 changed();assert.equal(urls.length,2);dark=false;changed();assert.match(urls[2],/\/alidade_smooth\//);
 unload();assert(disconnected);
});
