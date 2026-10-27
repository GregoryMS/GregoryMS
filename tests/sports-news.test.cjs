const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { usable } = require('../assets/sports-news.js');
const NOW = Date.now();
const fresh = title => ({ feedUpdatedAt: new Date(NOW).toISOString(), items: [{title: title || 'Sport headline', link:'https://www.bbc.co.uk/sport/football/articles/example'}] });

test('sport headlines reject stale, future, malformed and unsafe data and deduplicate URLs', () => {
  for (const data of [null, {}, {...fresh(), items:{}}, {...fresh(),feedUpdatedAt:new Date(NOW-7*3600000).toISOString()}, {...fresh(),feedUpdatedAt:new Date(NOW+3600000).toISOString()}, {...fresh(),items:[{title:'Unsafe',link:'https://bbc.com.evil.test/sport'}]}, {...fresh(),items:[{title:'Unsafe',link:'https://user@bbc.com/sport'}]}]) assert.equal(usable(data,NOW).length,0);
  const data = fresh(); data.items.push(data.items[0]); assert.equal(usable(data,NOW).length,1);
});
function harness(options = {}) {
  const timers = new Map(), intervals = [], classes = new Set();
  const ticker = { classList:{toggle(name,on){ on ? classes.add(name) : classes.delete(name); }} };
  const node = () => ({innerHTML:'',textContent:'',attributes:{},style:{},listeners:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.listeners[k]=v;}});
  const nodes = Object.fromEntries(['sport-news-track','sport-news-window','sport-news-status'].map(id=>[id,node()]));
  nodes['sport-news-window'].closest = () => ticker; nodes['sport-news-window'].contains = () => false;
  nodes['sport-news-track'].firstElementChild = {scrollWidth:2000};
  let fail=false, payload=fresh(options.title), timer=0, calls=0, frames=0;
  const context = {URL,AbortController,console,Date,document:{hidden:false,getElementById:id=>nodes[id],addEventListener(){}},
    fetch:async(url,{signal})=>{calls++; assert.equal(url,'data/bbc-sport.json'); if(options.stall && calls===1) return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Timed out')))); if(fail) throw Error('Offline'); return {ok:true,json:async()=>payload};},
    matchMedia:()=>({matches:!!options.reduced,addEventListener(){}}),addEventListener(){},
    setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout(id){timers.delete(id);},setInterval(fn){intervals.push(fn);},requestAnimationFrame(){frames++;return frames;},cancelAnimationFrame(){}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/sports-news.js'),'utf8'),context);
  return {nodes,classes,timers,intervals,calls:()=>calls,frames:()=>frames,setFail:v=>fail=v,setPayload:v=>payload=v,settle:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('ticker escapes headlines and removes duplicate links from keyboard navigation', async () => {
  const h=harness({title:'<img src=x> & sports'}); await h.settle(); const html=h.nodes['sport-news-track'].innerHTML;
  assert.match(html,/&lt;img src=x&gt; &amp; sports/); assert(!html.includes('<img')); assert.match(html,/aria-hidden="true" inert/); assert.match(html,/tabindex="-1"/); assert.equal(h.timers.size,0);
});
test('ticker retains fresh headlines through an outage, expires them, and recovers', async () => {
  const h=harness(); await h.settle(); const before=h.nodes['sport-news-track'].innerHTML;
  h.setFail(true); h.intervals[0](); await h.settle(); assert.equal(h.nodes['sport-news-track'].innerHTML,before);
  const expired=fresh('Old'); h.setFail(false); h.setPayload(expired); h.intervals[0](); await h.settle();
  expired.feedUpdatedAt=new Date(NOW-7*3600000).toISOString(); h.setFail(true); h.intervals[0](); await h.settle(); assert.match(h.nodes['sport-news-track'].innerHTML,/Headlines unavailable/);
  h.setFail(false); h.setPayload(fresh('Recovered')); h.intervals[0](); await h.settle(); assert.match(h.nodes['sport-news-track'].innerHTML,/Recovered/);
});
test('ticker works without a pause button and stops for hover, focus and reduced motion', async () => {
  const h=harness(); await h.settle(); const viewport=h.nodes['sport-news-window'];
  const frames=h.frames(); viewport.listeners.mouseenter(); assert.equal(h.frames(),frames);
  viewport.listeners.mouseleave(); assert(h.frames()>frames);
  viewport.listeners.focusin(); assert(h.classes.has('is-static'));
  viewport.listeners.focusout({relatedTarget:null}); assert(!h.classes.has('is-static'));
  const reduced=harness({reduced:true}); await reduced.settle(); assert.equal(reduced.frames(),0); assert(reduced.classes.has('is-static'));
});
test('stalled requests time out and retry without duplicate requests', async () => {
  const h=harness({stall:true}); h.intervals[0](); assert.equal(h.calls(),1);
  for(const callback of h.timers.values()) callback(); await h.settle(); assert.match(h.nodes['sport-news-track'].innerHTML,/Headlines unavailable/);
  h.intervals[0](); await h.settle(); assert.match(h.nodes['sport-news-track'].innerHTML,/Sport headline/);
});
