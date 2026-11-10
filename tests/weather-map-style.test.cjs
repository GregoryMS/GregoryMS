const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recolour,basemap,tiles}=require('../assets/weather-map-style.js');
const pixel=(rgba,kind)=>Array.from(recolour(Uint8ClampedArray.from(rgba),kind));

test('rain reflectivity is green, yellow, orange and red while snow retains blue',()=>{
  assert.deepEqual(pixel([0,163,224,255],'radar'),[34,177,76,255]);
  assert.deepEqual(pixel([255,238,0,255],'radar'),[255,235,0,255]);
  assert.deepEqual(pixel([255,170,0,255],'radar'),[255,153,0,255]);
  assert.deepEqual(pixel([255,68,0,255],'radar'),[245,48,32,255]);
  for(const snow of [[191,255,255,255],[127,191,255,255],[31,95,255,255],[199,255,255,127]])assert.deepEqual(pixel(snow,'radar'),snow);
});
test('recolouring preserves coverage, weak echo alpha and unknown colours',()=>{
  for(const kind of ['radar','precip']) {
    assert.deepEqual(pixel([136,221,238,0],kind),[136,221,238,0]);
    assert.deepEqual(pixel([12,34,56,120],kind),[12,34,56,120]);
  }
  const trace=pixel([146,136,113,100],'radar');assert.equal(trace[3],100);assert(trace[1]>trace[0]);
  // One-level channel rounding from browser PNG premultiplication is tolerated.
  assert.deepEqual(pixel([1,163,224,255],'radar'),[34,177,76,255]);
});
test('ECCC mixed precipitation and freezing rain use different pink scales without reclassifying rain, snow or hail',()=>{
  assert.deepEqual(pixel([224,189,230,255],'precip'),[247,182,218,255]);
  assert.deepEqual(pixel([155,39,175,255],'precip'),[190,38,125,255]);
  assert.deepEqual(pixel([254,30,13,255],'precip'),[237,23,76,255]);
  for(const rgba of [[127,223,235,255],[71,164,240,255],[0,0,224,255],[154,253,154,255],[0,203,0,255],[0,128,0,255],[254,192,7,255]])assert.deepEqual(pixel(rgba,'precip'),rgba);
});
function harness(){
  const images=[];let contextError=false,removed=false,drawn=null;
  const context={drawImage(){},getImageData(){if(contextError)throw Error('CORS');return {data:Uint8ClampedArray.from([0,163,224,255])};},putImageData(data){drawn=Array.from(data.data);}};
  class Parent {
    constructor(url,options){this.url=url;this.options=options;this._tiles={};}
    static extend(methods){class Child extends this{}Object.assign(Child.prototype,methods);return Child;}
    getTileSize(){return {x:512,y:512};}
    getTileUrl(){return this.url;}
    _removeTile(){removed=true;}
  }
  Parent.WMS=class extends Parent{};
  const win={L:{TileLayer:Parent},Image:class{constructor(){images.push(this);}},document:{createElement(){return {getContext(){return context;}};}}};
  return {win,images,drawn:()=>drawn,removed:()=>removed,failContext(){contextError=true;}};
}
test('canvas completion waits for recolouring and failed image/CORS paths report tile errors',()=>{
  const h=harness(),layer=tiles(h.win,'radar.png',{},'radar'),calls=[];
  const tile=layer.createTile({},(...args)=>calls.push(args));assert.equal(tile.width,512);assert.equal(calls.length,0);
  assert.equal(h.images[0].crossOrigin,'anonymous');h.images[0].onload();
  assert.deepEqual(h.drawn(),[34,177,76,255]);assert.equal(calls[0][0],null);assert.equal(calls[0][1],tile);
  layer.createTile({},(...args)=>calls.push(args));h.images[1].onerror();assert(calls[1][0] instanceof Error);
  layer.createTile({},(...args)=>calls.push(args));h.failContext();h.images[2].onload();assert.match(calls[2][0].message,/CORS/);
});
test('removing a tile cancels the image even when the controller has detached event listeners',()=>{
  const h=harness(),layer=tiles(h.win,'radar.png',{},'radar');let completed=false;
  const tile=layer.createTile({},()=>{completed=true;}),late=h.images[0].onload;
  layer._tiles.key={el:tile};layer._removeTile('key');late();
  assert.equal(completed,false);assert.equal(h.images[0].src,'');assert(h.removed());
});
test('basemap supplies grey-only styling class and complete map credits',()=>{
  const layer=basemap({tileLayer:(url,options)=>({url,options})});
  assert.match(layer.url,/basemaps.cartocdn.com\/light_all/);
  assert.equal(layer.options.className,'weather-basemap');
  assert.match(layer.options.attribution,/OpenStreetMap/);assert.match(layer.options.attribution,/CARTO/);
});
