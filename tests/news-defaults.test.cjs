const {test}=require('node:test');
const assert=require('node:assert/strict');
const defaults=require('../assets/news-defaults.js');

const empty=()=>({feeds:[],articles:[],read:[],saved:[],updated:null});
test('new readers start with the requested six sources and original-language feeds',()=>{
  const state=defaults.apply(empty());
  assert.deepEqual(state.feeds.map(f=>f.name),['BBC News','SVT Nyheter','NRK','Reuters','CBC News','DW Deutsch']);
  assert.equal(state.feeds[1].url,'https://www.svt.se/nyheter/rss.xml');
  assert.equal(state.feeds[2].url,'https://www.nrk.no/toppsaker.rss');
  assert.equal(state.feeds[5].url,'https://rss.dw.com/xml/rss-de-all');
  const reuters=new URL(state.feeds[3].url);
  assert.equal(reuters.hostname,'news.google.com');
  assert.equal(reuters.searchParams.get('q'),'site:reuters.com');
  assert.equal(new Set(state.feeds.map(f=>f.url)).size,6);
});
test('existing subscriptions, names, folders, saved articles and read history survive migration',()=>{
  const existing={...empty(),feeds:[{...defaults.feeds[0],name:'My BBC',folder:'World'},{url:'https://example.com/rss',name:'Custom',folder:'Personal'}],articles:[{id:'saved-story'}],read:['saved-story'],saved:['saved-story'],updated:123};
  const migrated=defaults.apply(existing);
  assert.equal(migrated.feeds.length,7);
  assert.deepEqual(migrated.feeds.slice(0,2),existing.feeds);
  for(const key of ['articles','read','saved','updated'])assert.equal(migrated[key],existing[key]);
  assert.equal(existing.feeds.length,2);
});
test('removed defaults stay removed after reload, including an intentionally empty reader',()=>{
  const migrated=defaults.apply(empty());
  const removed={...migrated,feeds:migrated.feeds.filter(f=>f.name!=='BBC News')};
  assert.equal(defaults.apply(removed),removed);
  const cleared={...migrated,feeds:[]};
  assert.equal(defaults.apply(cleared),cleared);
  assert.equal(defaults.apply(JSON.parse(JSON.stringify(cleared))).feeds.length,0);
});
test('migration honours the subscription limit without dropping existing feeds',()=>{
  const state={...empty(),feeds:Array.from({length:499},(_,i)=>({url:`https://example.com/${i}`,name:String(i),folder:''}))};
  const migrated=defaults.apply(state);
  assert.equal(migrated.feeds.length,500);
  assert.deepEqual(migrated.feeds.slice(0,499),state.feeds);
});
test('bundled feeds use their own retrieval age and reject stale, future, malformed and unknown sources',()=>{
  const now=Date.parse('2026-10-19T22:00:00Z');
  const valid={url:defaults.feeds[0].url,xml:'<rss/>',fetchedAt:new Date(now).toISOString()};
  assert.equal(defaults.snapshots({version:1,feeds:[valid]},now).get(valid.url),valid);
  for(const change of [{fetchedAt:new Date(now-7200001).toISOString()},{fetchedAt:new Date(now+300001).toISOString()},{fetchedAt:'invalid'},{xml:'x'.repeat(500001)},{url:'https://example.com/custom'}]){
    assert.equal(defaults.snapshots({version:1,feeds:[{...valid,...change}]},now).size,0);
  }
  assert.equal(defaults.snapshots({version:1,feeds:[null,{},valid]},now).size,1);
  for(const value of [null,{},[],{version:2,feeds:[valid]}])assert.equal(defaults.snapshots(value,now).size,0);
});
