const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/earthquake-core.js');
const now = Date.parse('2026-09-28T20:00:00Z');
const quake = (id, magnitude, time, extra = {}) => ({ id, geometry:{type:'Point',coordinates:[-129,50,10]}, properties:{type:'earthquake',mag:magnitude,time,place:'Off the coast',url:'https://earthquake.usgs.gov/earthquakes/eventpage/'+id,...extra} });
const feed = features => ({type:'FeatureCollection',metadata:{generated:now},features});
function bulletin(category = 'Information', product = 'PAAQWEAK51') {
  return { TWCID:product.slice(0,4), WMOID:product.slice(4), bulletinIssueTime:'2026-09-28T19:00:00Z', eventDir:'/events/PAAQ/2026/09/28/example/1/WEAK51/', eventLat:50, eventLon:-129, quakeLocation:'Off British Columbia', alerts:{areaList:[[]]}, segments:[{category,headline:'Bulletin headline',recommendedActions:'Follow local authorities.'}] };
}
test('earthquakes are sorted by origin time, not magnitude or tsunami flag', () => {
  const data = core.earthquakes(feed([quake('large',7,now-5000,{tsunami:1}),quake('recent',3,now-1000)]));
  assert.equal(data[0].id,'recent'); assert.equal(data.length,2); assert.equal(data[1].kind,undefined);
});
test('missing magnitudes, invalid coordinates and non-earthquakes are excluded', () => {
  const invalid = quake('bad',3,now); invalid.geometry.coordinates[1] = 999;
  assert.equal(core.earthquakes(feed([invalid,quake('null',null,now),quake('blast',3,now,{type:'explosion'}),quake('ok',2.5,now)])).length,1);
  assert.throws(() => core.earthquakes({features:[]}));
});
test('period and magnitude filters exclude out-of-window and future events', () => {
  const data=core.earthquakes(feed([quake('day',4.5,now-1000),quake('week',6,now-2*86400000),quake('old',7,now-8*86400000),quake('future',6,now+3600000)]));
  assert.deepEqual(core.filterEarthquakes(data,2.5,'day',now).map(x=>x.id),['day']);
  assert.deepEqual(core.filterEarthquakes(data,6,'week',now).map(x=>x.id),['week']);
});
test('official links reject scripts, lookalike hosts, credentials and unrelated domains', () => {
  for (const url of ['javascript:alert(1)','https://www.tsunami.gov.evil.test/','https://user:pass@www.tsunami.gov/','https://evil.test/']) assert.equal(core.officialURL(url,'www.tsunami.gov'),null);
  assert.equal(core.officialURL('http://www.tsunami.gov/events/a.txt','www.tsunami.gov'),'https://www.tsunami.gov/events/a.txt');
  assert.equal(core.officialURL(undefined,'www.tsunami.gov'),null);
});
test('warnings, advisories, watches and international threats are distinguished', () => {
  for (const category of ['Warning','Advisory','Watch','Threat','Potential Threat','>3.0 meters','1-3 meters','0.3-1 meters']) {
    const result=core.tsunamiBulletin(bulletin(category),'PAAQWEAK51');
    assert.ok(result.kind); assert.deepEqual(result.areas,['Bulletin headline']); assert.equal(result.latitude,50);
  }
});
test('information and cancellation messages never become warnings', () => {
  for (const category of ['Information','Cancellation','No Threat']) assert.equal(core.tsunamiBulletin(bulletin(category),'PAAQWEAK51').kind,null);
});
test('persistent alert areas remain visible when another area is cancelled', () => {
  const input=bulletin('Cancellation'); input.alerts.areaList=[[{category:'Warning',bkp_start_location:'Northern coast',bkp_end_location:'Southern coast'}]];
  const result=core.tsunamiBulletin(input,'PAAQWEAK51');
  assert.equal(result.kind,'Warning'); assert.deepEqual(result.areas,['Northern coast to Southern coast']);
});
test('NOAA encoded CDATA headlines render as text without hiding affected countries', () => {
  const input=bulletin('Potential Threat','PHEBWEPA40');
  input.quakeLocation='PANAMA';
  input.alerts.areaList=[[{category:'Potential Threat',zone:'Ecuador',headLine:' &lt;![CDATA[ ...PTWC TSUNAMI THREAT MESSAGE... ]]&gt; ',recommendedActions:' '},
    {category:'Potential Threat',zone:'Colombia',recommendedActions:' '}]];
  input.segments[0].headline=' &lt;![CDATA[ ...PTWC TSUNAMI THREAT MESSAGE... ]]&gt; ';
  input.segments[0].recommendedActions=' ';
  const result=core.tsunamiBulletin(input,'PHEBWEPA40');
  assert.equal(result.kind,'Threat');
  assert.deepEqual(result.areas,['Ecuador','Colombia','...PTWC TSUNAMI THREAT MESSAGE...']);
  assert.deepEqual(result.instructions,[]);
  assert.match(result.links[0].url,/WEPA40\.txt$/);
});
test('bulletin text decodes raw, numeric and nested wrappers, preserving instructions and comparisons', () => {
  for(const headline of ['<![CDATA[Coast &amp; islands]]>','&lt;![CDATA[Coast &amp; islands]]&gt;','&amp;lt;![CDATA[Coast &amp;amp; islands]]&amp;gt;','&#60;![CDATA[Coast &#x26; islands]]&#62;']) {
    const input=bulletin('Warning');input.segments[0].headline=headline;
    input.segments[0].recommendedActions=' &lt;![CDATA[ Follow local authorities. Waves &lt; 0.3 m. ]]&gt; ';
    input.segments.push({category:'Warning',headline:'Coast & islands',recommendedActions:'Follow local authorities. Waves < 0.3 m.'});
    const result=core.tsunamiBulletin(input,'PAAQWEAK51');
    assert.deepEqual(result.areas,['Coast & islands']);
    assert.deepEqual(result.instructions,['Follow local authorities. Waves < 0.3 m.']);
  }
});
test('unknown categories, incomplete products and invalid times fail closed', () => {
  assert.throws(()=>core.tsunamiBulletin(bulletin('Unexpected'),'PAAQWEAK51'));
  assert.throws(()=>core.tsunamiBulletin(bulletin(),'PHEBWEPA40'));
  assert.throws(()=>core.tsunamiBulletin({...bulletin(),alerts:null},'PAAQWEAK51'));
  assert.throws(()=>core.tsunamiBulletin({...bulletin(),bulletinIssueTime:'unknown'},'PAAQWEAK51'));
});
test('freshness becomes unknown after three minutes, including future timestamps', () => {
  assert.equal(core.fresh(null,now),false); assert.equal(core.fresh(now-180001,now),false);
  assert.equal(core.fresh(now-60000,now),true); assert.equal(core.fresh(now+120000,now),false);
});

// Exercise the page's asynchronous feeds and failure states with no map library.
async function page({failProduct,category='Information',failEarthquakes=false,transformBulletin=value=>value} = {}) {
  class Element {
    constructor(tag='div') { this.tag=tag; this.children=[]; this.dataset={}; this.listeners={}; this.attributes={}; this._text=''; this.value=''; }
    set textContent(value) { this._text=String(value); this.children=[]; }
    get textContent() { return this._text+this.children.map(x=>x.textContent).join(' '); }
    append(...nodes) { this.children.push(...nodes); if(this.tag==='head') for(const node of nodes) if(node.tag==='script') {
      const product = /\/([^/]+)\.js/.exec(node.src)[1];
      queueMicrotask(()=>{ if(product===options.failProduct) node.onerror(); else { context[product]=options.transformBulletin(bulletin(product==='PAAQWEAK51'?options.category:'Information',product)); node.onload(); } });
    } }
    replaceChildren(...nodes) { this._text=''; this.children=nodes; }
    setAttribute(key,value) { this.attributes[key]=value; }
    addEventListener(key,fn) { this.listeners[key]=fn; }
    querySelectorAll() { return []; }
    remove() {}
  }
  const options={failProduct,category,failEarthquakes,transformBulletin};
  const nodes=new Map(), get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  get('period').value='day'; get('magnitude').value='2.5';
  const context={ GregleEarthquakes:core, document:{getElementById:get,createElement:tag=>new Element(tag),head:new Element('head'),hidden:false,addEventListener(){}},
    Date, URL, AbortController, setTimeout:()=>1, clearTimeout(){},setInterval(){},
    fetch:async()=>{if(options.failEarthquakes)throw Error('offline');return {ok:true,json:async()=>feed([quake('recent',4,Date.now()-10000)])};} };
  context.window=context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/earthquakes.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {get,options,refresh:async()=>{await get('refresh').listeners.click();}};
}
test('live warning rendering includes affected coasts, instructions and source links',async()=>{
  const app=await page({category:'Warning'});
  assert.equal(app.get('tsunami-panel').dataset.state,'active');
  assert.match(app.get('tsunami-alerts').textContent,/Tsunami warning.*Bulletin headline.*Follow local authorities/s);
  assert.match(app.get('latest-content').textContent,/M4.0/);
});
test('rendered bulletin cards contain no CDATA debris or empty instruction paragraphs',async()=>{
  const app=await page({category:'Threat',transformBulletin:value=>{
    value.segments[0].headline=' &lt;![CDATA[ ...PTWC TSUNAMI THREAT MESSAGE... ]]&gt; ';
    value.segments[0].recommendedActions=' ';return value;
  }});
  const card=app.get('tsunami-alerts').children[0];
  assert.match(card.textContent,/PTWC TSUNAMI THREAT MESSAGE/);
  assert.doesNotMatch(card.textContent,/CDATA|&lt;|&gt;/);
  assert.equal(card.children.filter(node=>node.tag==='p' && !node.textContent.trim()).length,0);
});
test('decoded markup stays literal text instead of becoming executable HTML',async()=>{
  const app=await page({category:'Warning',transformBulletin:value=>{
    value.segments[0].headline='&lt;![CDATA[&lt;img src=x onerror=alert(1)&gt;]]&gt;';return value;
  }});
  const card=app.get('tsunami-alerts').children[0];
  const headline=card.children.find(node=>node.textContent==='<img src=x onerror=alert(1)>');
  assert.ok(headline);assert.equal(headline.tag,'p');assert.equal(headline.innerHTML,undefined);
});
test('a single missing regional feed prevents a false all-clear while preserving known warnings',async()=>{
  const app=await page({category:'Warning',failProduct:'PHEBWEPA40'});
  assert.equal(app.get('tsunami-panel').dataset.state,'unknown');
  assert.match(app.get('tsunami-status').textContent,/cannot be confirmed/);
  assert.match(app.get('tsunami-alerts').textContent,/Tsunami warning/);
});
test('failed refresh retains warnings and earthquake reports with explicit uncertainty',async()=>{
  const app=await page({category:'Warning'});
  app.options.failProduct='PAAQWEAK51'; app.options.failEarthquakes=true; await app.refresh();
  assert.match(app.get('tsunami-status').textContent,/Previously received/);
  assert.match(app.get('tsunami-alerts').textContent,/Tsunami warning/);
  assert.match(app.get('quake-status').textContent,/last received reports/);
  assert.equal(app.get('refresh').disabled,false);
});
test('a confirmed cancellation removes prior warning cards',async()=>{
  const app=await page({category:'Warning'}); app.options.category='Cancellation'; await app.refresh();
  assert.equal(app.get('tsunami-panel').dataset.state,'quiet'); assert.equal(app.get('tsunami-alerts').children.length,0);
});
test('earthquake failures do not prevent successful tsunami checks',async()=>{
  const app=await page({failEarthquakes:true});
  assert.match(app.get('latest-content').textContent,/unavailable/);
  assert.equal(app.get('tsunami-panel').dataset.state,'quiet');
});
