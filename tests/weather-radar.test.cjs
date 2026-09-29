const {test}=require('node:test');
const assert=require('node:assert/strict');
const radar=require('../assets/weather-radar.js');
const frame=time=>({time,path:`/v2/radar/${time}`});
const feed=frames=>({host:'https://tilecache.rainviewer.com',radar:{past:frames}});
test('radar uses sorted, unique observed frames, excluding forecast and malformed entries',()=>{
  const data=feed([frame(1200),frame(600),frame(1200),{time:1800,path:'//evil.test/tile'},frame(1800)]);
  data.radar.nowcast=[frame(2400)];
  assert.deepEqual(radar.framesFrom(data).frames,[frame(600),frame(1200),frame(1800)]);
});
test('radar rejects empty feeds and untrusted image hosts',()=>{
  assert.throws(()=>radar.framesFrom(feed([])));
  for(const host of ['http://tilecache.rainviewer.com','https://rainviewer.com.evil.test','https://user@rainviewer.com','https://evil.test']) {
    assert.throws(()=>radar.framesFrom({...feed([frame(600)]),host}));
  }
});
test('radar bounds history and generates the supported blue, 512px tile URL with snow colours enabled',()=>{
  const data=radar.framesFrom(feed(Array.from({length:20},(_,i)=>frame(600+i*600))));
  assert.equal(data.frames.length,13);
  assert.equal(data.frames[0].time,4800);
  assert.equal(radar.tileURL(data.host,data.frames[0]),'https://tilecache.rainviewer.com/v2/radar/4800/512/{z}/{x}/{y}/2/1_1.png');
});
test('delayed radar is distinguished from fresh imagery',()=>{
  assert.equal(radar.stale(frame(600),2400000),false);
  assert.equal(radar.stale(frame(600),2400001),true);
  assert.equal(radar.stale(null),true);
});

test('accepts the opaque paths supplied by the live radar feed',()=>{
  assert.equal(radar.framesFrom(feed([{time:1790699400,path:'/v2/radar/ce40b91ba6de'}])).frames[0].path,'/v2/radar/ce40b91ba6de');
});
