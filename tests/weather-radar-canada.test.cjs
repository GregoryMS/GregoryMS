const {test}=require('node:test');
const assert=require('node:assert/strict');
const ca=require('../assets/weather-radar-canada.js');
const hd=require('../assets/weather-radar-hd.js');
const now=Date.parse('2026-11-19T20:00:00Z');
test('Canadian stations use ECCC rather than constructing a NOAA workspace',()=>{
  for(const id of ['CASAG','CASHP']) {
    assert.equal(hd.sourceFor(id).provider,'eccc');
    assert.equal(ca.sourceFor(id).id,id);
  }
  assert.throws(()=>ca.sourceFor('CASXX'));
});
test('Canadian frames use their actual published time and reject unrelated or malformed images',()=>{
  const valid={time:now/1000,code:'20261119T2000Z'};
  const result=ca.framesFrom({station:'CASAG',frames:[valid,valid,{time:valid.time,code:'20261119T1954Z'},{time:valid.time+3600,code:'20261119T2100Z'}]},'CASAG',now);
  assert.equal(result.frames.length,1);
  assert.equal(result.frames[0].time,now/1000);
  assert.match(result.frames[0].hd.url,/\/CASAG\/images\/20261119T2000Z\.gif$/);
  assert.throws(()=>ca.framesFrom({station:'CASHP',frames:[valid]},'CASAG',now));
  assert.throws(()=>ca.framesFrom({station:'CASAG',frames:[{time:(now-4*3600000)/1000,code:'20261119T1600Z'}]},'CASAG',now));
});
test('station-centred reprojection keeps the centre and north/east directions at 1 km per pixel',()=>{
  const site=ca.sourceFor('CASAG');
  const centre=ca.pixelFor(site.lat,site.lon,site);
  assert.ok(Math.abs(centre[0]-240)<1e-8);assert.ok(Math.abs(centre[1]-240)<1e-8);
  const north=ca.pixelFor(site.lat+180/(Math.PI*6371),site.lon,site);
  assert.ok(Math.abs(north[0]-240)<1e-8);assert.ok(Math.abs(north[1]-239)<1e-5);
  const victoria=ca.pixelFor(48.421,-123.393,site);
  assert.ok(victoria[0]>170 && victoria[0]<175);assert.ok(victoria[1]>305 && victoria[1]<308);
});
test('precipitation filtering removes land, water, legend/frame and banner without removing valid rain colours',()=>{
  const data=new Uint8ClampedArray(480*480*4);
  const put=(x,y,rgb)=>data.set([...rgb,255],(y*480+x)*4);
  put(240,240,[153,153,102]);put(240,241,[51,51,102]);
  put(220,220,ca.COLOURS[0]);put(221,220,ca.COLOURS.at(-1));
  put(180,10,[255,0,0]);put(0,240,[255,0,0]);put(10,10,[255,0,0]);
  const out=ca.rainPixels(data);
  const alpha=(x,y)=>out[(y*480+x)*4+3];
  assert.equal(alpha(220,220),255);assert.equal(alpha(221,220),255);
  for(const [x,y] of [[240,240],[240,241],[180,10],[0,240],[10,10]])assert.equal(alpha(x,y),0);
});

test('a changed source legend fails explicitly rather than presenting unsupported colours as dry weather',()=>{
  const pixels=new Uint8ClampedArray(210*4);
  ca.COLOURS.slice().reverse().forEach((rgb,i)=>pixels.set([...rgb,255],(i*15+7)*4));
  ca.validateLegend(pixels);
  pixels[7*4]=0;assert.throws(()=>ca.validateLegend(pixels),/colour scale changed/);
});
test('Web Mercator tiles covering a station sample its source grid; remote tiles remain empty',()=>{
  const site=ca.sourceFor('CASHP'),z=8,n=2**z;
  const gx=(site.lon+180)/360*n*256;
  const gy=(1-Math.asinh(Math.tan(site.lat*Math.PI/180))/Math.PI)/2*n*256;
  const tile={x:Math.floor(gx/256),y:Math.floor(gy/256),z};
  const lookup=ca.tileLookup(tile,site);
  const index=lookup[Math.floor(gy%256)*256+Math.floor(gx%256)];
  assert.ok(Math.abs((index/4)%480-240)<3);
  assert.ok(Math.abs(Math.floor(index/4/480)-240)<3);
  assert.ok(ca.tileLookup({x:0,y:0,z:8},site).every(i=>i===-1));
});
