const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../assets/tide-core.js');
const weather=require('../assets/weather-core.js');
const now=Date.parse('2026-09-29T16:00:00Z');
const victoria={name:'Victoria',latitude:48.43,longitude:-123.36,country:'CA',timezone:'America/Vancouver',region:'British Columbia, Canada'};
const london={name:'London',latitude:51.5,longitude:-.1,country:'GB',timezone:'Europe/London'};
const points=Array.from({length:241},(_,i)=>({time:now-48*3600000+i*3600000,height:2+Math.cos(i*Math.PI/6)}));
const dataset=()=>({points,events:core.extremes(points),timezone:'America/Vancouver',source:'Test source',sourceURL:'https://www.tides.gc.ca/',station:'Victoria Harbour',datum:'Metres above chart datum',model:false,note:'Station predictions.'});
const marine=()=>({latitude:48.42,longitude:-123.37,timezone:'America/Vancouver',hourly_units:{sea_level_height_msl:'m'},hourly:{time:points.map(p=>p.time/1000),sea_level_height_msl:points.map(p=>p.height)}});
const station={id:'5cebf1df3d0f4a073c4bbd1e',code:'07120',officialName:'Victoria Harbour',latitude:48.424,longitude:-123.37,timeSeries:[{code:'wlp'},{code:'wlp-hilo'}]};
const response=value=>({ok:true,json:async()=>value});
const flush=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('weather and tide URLs round-trip selected coordinates, names and time zones safely',()=>{
 const location={...victoria,name:'<Coast> & Inlet #1'};
 const url=core.locationURL('tides.html',location);
 assert.deepEqual(core.locationFromURL('https://gregle.uk/'+url),location);
 assert.equal(new URL(core.locationURL('weather.html',location),'https://gregle.uk').pathname,'/weather.html');
 for(const query of ['', '?lat=&lon=', '?lat=91&lon=0','?lat=0&lon=181','?lat=no&lon=1'])assert.equal(core.locationFromURL('https://gregle.uk/'+query),null);
 assert.equal(core.locationFromURL('https://gregle.uk/?lat=0&lon=0&tz=invalid').timezone,'UTC');
});
test('day boundaries use destination time zone, including daylight-saving transitions',()=>{
 assert.equal(core.dayKey(Date.parse('2026-09-30T01:00:00Z'),'America/Vancouver'),'2026-09-29');
 assert.equal(core.dayKey(Date.parse('2026-09-30T01:00:00Z'),'Pacific/Auckland'),'2026-09-30');
 assert.deepEqual(core.dayKeys(Date.parse('2026-10-31T20:00:00Z'),'America/Vancouver',3),['2026-10-31','2026-11-01','2026-11-02']);
});
test('nearest station requires predictions and rejects remote inland matches',()=>{
 assert.equal(core.nearestStation([station,{...station,latitude:49}],victoria).code,'07120');
 assert.equal(core.nearestStation([station],london),null);
 assert.equal(core.nearestStation([{...station,timeSeries:[{code:'wlo'}]}],victoria),null);
 assert.throws(()=>core.nearestStation({},victoria));
});
test('turning points handle plateaus without duplicate tides and never bridge missing samples',()=>{
 const p=heights=>heights.map((height,i)=>({height,time:i*3600000}));
 assert.deepEqual(core.extremes(p([0,2,2,0,-1,0]),3600000).map(x=>[x.type,x.time]),[['High',5400000],['Low',14400000]]);
 assert.deepEqual(core.extremes(p([0,2,null,0]),3600000),[]);
 const gap=p([0,2,0]);gap[2].time+=3600000;assert.deepEqual(core.extremes(gap,3600000),[]);
 assert.deepEqual(core.extremes(p([1,1,1])),[]);
});
test('station predictions preserve zero and reject null heights and duplicate times',()=>{
 assert.equal(core.predictions([{eventDate:new Date(now).toISOString(),value:0}])[0].height,0);
 assert.throws(()=>core.predictions([{eventDate:new Date(now).toISOString(),value:null}]));
 assert.throws(()=>core.predictions([{eventDate:'bad',value:1}]));
 const p={eventDate:new Date(now).toISOString(),value:1};assert.throws(()=>core.predictions([p,p]));
});
test('marine forecasts keep their datum and estimated status and reject distant or empty sea cells',()=>{
 const result=core.marine(marine(),victoria);assert.equal(result.model,true);assert.equal(result.datum,'Metres above mean sea level');assert.ok(result.events.length);
 assert.equal(core.marine(marine(),london),null);
 const empty=marine();empty.hourly.sea_level_height_msl.fill(null);assert.equal(core.marine(empty,victoria),null);
 const invalid=marine();invalid.hourly.time.pop();assert.throws(()=>core.marine(invalid,victoria));
 assert.equal(new URL(core.marineURL(victoria)).searchParams.get('timeformat'),'unixtime');
});
test('current tide interpolation does not invent values beyond coverage or across gaps',()=>{
 assert.equal(core.current([{time:0,height:0},{time:1000,height:2}],500).height,1);
 assert.equal(core.current([{time:0,height:0},{time:1000,height:2}],2000),null);
 assert.equal(core.current([{time:0,height:0},{time:1000,height:null}],500),null);
});
function dataService(fetch) {
 const c={GregleTides:core,fetch,AbortController,setTimeout,clearTimeout,Intl,Date};vm.createContext(c);vm.runInContext(fs.readFileSync(require.resolve('../assets/tide-data.js'),'utf8'),c);return c.GregleTideData;
}
test('Canadian service loads official curve and extrema, and caches the station directory',async()=>{
 const urls=[];const service=dataService(async url=>{urls.push(url);return response(url.endsWith('/stations')?[station]:(url.includes('wlp-hilo')?core.extremes(points):points).map(p=>({eventDate:new Date(p.time).toISOString(),value:p.height})));});
 const result=await service.load(victoria,new AbortController().signal,now);assert.equal(result.model,false);assert.equal(result.timezone,'America/Vancouver');assert.ok(result.sourceURL.endsWith('07120'));
 await service.load(victoria,new AbortController().signal,now);assert.equal(urls.filter(u=>u.endsWith('/stations')).length,1);
});
test('Canadian errors fall back with explicit model attribution; abort does not start another provider',async()=>{
 const urls=[];const service=dataService(async url=>{urls.push(url);if(url.includes('dfo-mpo'))throw Error('offline');return response(marine());});
 const result=await service.load(victoria,new AbortController().signal,now);assert.equal(result.model,true);assert.match(result.note,/Canadian station data is unavailable/);
 const c=new AbortController();c.abort();await assert.rejects(service.load(victoria,c.signal,now));assert.equal(urls.length,2);
});
class Element {
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.listeners={};this.style={};this.value='';this._text='';this.classList={toggle(){},contains(){return false;}};}
 set textContent(v){this._text=String(v);this.children=[];} get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ');}
 append(...v){this.children.push(...v);} appendChild(v){this.append(v);} replaceChildren(...v){this._text='';this.children=v;}
 setAttribute(k,v){this.attributes[k]=String(v);} addEventListener(k,v){this.listeners[k]=v;}
}
function app({page='tides',load=async()=>dataset(),fetch=async()=>response({}),href='https://gregle.uk/tides.html',geolocation={getCurrentPosition(){} }}={}) {
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 let geolocationCalls=0;
 const document={getElementById:get,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),querySelectorAll:()=>[],addEventListener(){},documentElement:new Element()};
 const c={GregleTides:core,GregleWeather:weather,GregleTideData:{load},document,fetch,URL,AbortController,Intl,console,
 Date:class extends Date{static now(){return now;}},setTimeout:()=>1,clearTimeout(){},setInterval(){},matchMedia:()=>({matches:false}),
 localStorage:{getItem:()=>null,setItem(){}},navigator:{geolocation:{getCurrentPosition(...args){geolocationCalls++;geolocation.getCurrentPosition(...args);}}},location:{href},history:{replaceState(_,__,url){c.location.href=new URL(url,c.location.href).href;}}};c.window=c;
 vm.createContext(c);vm.runInContext(fs.readFileSync(require.resolve('../assets/tide-ui.js'),'utf8'),c);
 if(page==='tides') vm.runInContext(fs.readFileSync(require.resolve('../assets/tides.js'),'utf8'),c);
 if(page==='weather') {const html=fs.readFileSync(require.resolve('../weather.html'),'utf8');const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');vm.runInContext(inline,c);}
 return {get,c,geolocationCalls:()=>geolocationCalls};
}
test('linked weather opens at the tide location without geolocation overriding it and preview links back',async()=>{
 const a=app({page:'weather',href:'https://gregle.uk/'+core.locationURL('weather.html',victoria)});await flush();
 assert.equal(a.get('cityName').textContent,'Victoria');assert.equal(a.geolocationCalls(),0);
 assert.equal(core.locationFromURL('https://gregle.uk/'+a.get('tideLink').href).latitude,victoria.latitude);
 assert.equal(a.get('tidePreview').href,a.get('tideLink').href);assert.match(a.get('tidePreviewContent').textContent,/Victoria Harbour/);
});
test('weather preview ignores late results from a previous location and clears old tides on error',async()=>{
 const first=deferred(),second=deferred();let calls=0;
 const a=app({page:'ui',load:()=>++calls===1?first.promise:second.promise});
 const old=a.c.GregleTideUI.weatherPreview(victoria),latest=a.c.GregleTideUI.weatherPreview(london);
 second.resolve({...dataset(),station:'London model'});await latest;first.resolve(dataset());await old;
 assert.match(a.get('tidePreviewContent').textContent,/London model/);assert.equal(core.locationFromURL('https://gregle.uk/'+a.get('tidePreview').href).name,'London');
 a.c.GregleTideData.load=async()=>{throw Error('offline');};await a.c.GregleTideUI.weatherPreview(victoria);assert.match(a.get('tidePreviewContent').textContent,/temporarily unavailable/);assert.doesNotMatch(a.get('tidePreviewContent').textContent,/London model/);
});
test('tide page renders curve and seven days, preserving location in weather link',async()=>{
 const a=app({href:'https://gregle.uk/'+core.locationURL('tides.html',victoria)});await flush();
 assert.equal(a.get('tideCity').textContent,'Victoria');assert.equal(a.get('tideDays').children.length,7);assert.equal(a.get('tideChart').children[0].tagName,'SVG');
 assert.equal(core.locationFromURL('https://gregle.uk/'+a.get('weatherLink').href).name,'Victoria');
 a.get('tideDays').children[1].listeners.click();assert.match(a.get('tideDayTitle').textContent,/Sep 30/);
});
test('new Weather and Tides roots preserve the selected location across origins and keep history on Tides',async()=>{
 const href=core.locationURL('https://tides.gregle.uk/',victoria);
 const tide=app({href});await flush();
 assert.equal(new URL(tide.c.location.href).origin,'https://tides.gregle.uk');
 assert.equal(new URL(tide.c.location.href).pathname,'/');
 assert.equal(new URL(tide.get('weatherLink').href).origin,'https://weather.gregle.uk');
 assert.equal(core.locationFromURL(tide.get('weatherLink').href).name,'Victoria');
 const forecast=app({page:'weather',href:tide.get('weatherLink').href});await flush();
 assert.equal(new URL(forecast.get('tideLink').href).origin,'https://tides.gregle.uk');
 assert.equal(core.locationFromURL(forecast.get('tideLink').href).latitude,victoria.latitude);
 assert.equal(forecast.geolocationCalls(),0);
});
test('tide search treats names as text and retains selected location after service errors',async()=>{
 const a=app({fetch:async()=>response({results:[{name:'<Coast & Bay>',latitude:51.5,longitude:-.1,country_code:'GB',timezone:'Europe/London'}]})});await flush();
 a.get('tideQuery').value='Coast';await a.get('tideSearch').listeners.submit({preventDefault(){}});
 const result=a.get('tideResults').children[0];assert.equal(result.textContent,'<Coast & Bay>');result.listeners.click();await flush();assert.equal(a.get('tideCity').textContent,'<Coast & Bay>');
 a.c.GregleTideData.load=async()=>{throw Error('offline');};await a.get('refreshTides').listeners.click();assert.equal(a.get('tideContent').hidden,true);assert.match(a.get('tideStatus').textContent,/temporarily unavailable/);assert.equal(a.get('refreshTides').disabled,false);
});
test('uncovered inland locations show a useful empty state',async()=>{
 const a=app({load:async()=>null});await flush();assert.equal(a.get('tideContent').hidden,true);assert.match(a.get('tideStatus').textContent,/Search for a coastal city/);assert.equal(a.get('refreshTides').disabled,false);
});
test('tide search ignores responses cancelled by a newer search',async()=>{
 const pending=deferred();let count=0;const a=app({fetch:()=>++count===1?pending.promise:Promise.resolve(response({results:[]}))});await flush();
 a.get('tideQuery').value='Victoria';const old=a.get('tideSearch').listeners.submit({preventDefault(){}});a.get('tideQuery').value='Other';await a.get('tideSearch').listeners.submit({preventDefault(){}});
 pending.resolve(response({results:[{name:'Old result',latitude:1,longitude:1,country_code:'GB'}]}));await old;assert.equal(a.get('tideResults').children.length,0);assert.match(a.get('tideLocationStatus').textContent,/No locations found/);
});
