const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../assets/weather-hourly.js');
const now=Date.parse('2025-11-02T08:30:00Z');
function fixture(){return {timezone:'America/Vancouver',hourly:{time:Array.from({length:26},(_,i)=>now/1000-1800+i*3600),temperature_2m:Array(26).fill(0),weather_code:Array(26).fill(0),is_day:Array(26).fill(0),precipitation_probability:Array(26).fill(0),wind_speed_10m:Array(26).fill(0)}};}
test('hourly timestamps use destination timezone across midnight and DST, with zero values preserved',()=>{
  const f=core.parseHours(fixture(),now);assert.equal(f.hours.length,24);
  assert.equal(f.hours[0].time,f.hours[1].time);assert.notEqual(f.hours[0].label,f.hours[1].label);
  assert.equal(f.hours[0].temperature,0);assert.equal(f.hours[0].chance,0);assert.equal(f.hours[0].wind,0);assert(f.hours[0].night);
  assert.match(f.hours.at(-1).day,/Nov 2/);
  const tokyo={...fixture(),timezone:'Asia/Tokyo'};assert.match(core.parseHours(tokyo,now).hours.at(-1).day,/Nov 3/);
  assert.equal(core.parseHours(fixture(),now+3600000).hours[0].timestamp,now-1800000+3600000);
});
test('malformed, stale and empty forecasts are rejected; missing measurements stay missing',()=>{
  for(const data of [{}, {...fixture(),timezone:'invalid'}, {...fixture(),hourly:{time:[]}}])assert.throws(()=>core.parseHours(data,now));
  assert.throws(()=>core.parseHours(fixture(),now+28*3600000));
  const data=fixture();data.hourly.temperature_2m[0]=null;data.hourly.precipitation_probability[0]=101;data.hourly.wind_speed_10m[0]=-1;
  const h=core.parseHours(data,now).hours[0];assert.equal(h.temperature,null);assert.equal(h.chance,null);assert.equal(h.wind,null);
  data.hourly.time[1]=data.hourly.time[0];assert.throws(()=>core.parseHours(data,now));
  assert.throws(()=>core.forecastURL({latitude:NaN,longitude:0}));assert.match(core.forecastURL({latitude:0,longitude:0}),/timeformat=unixtime&forecast_hours=24/);
});
function setup(){
  const elements=new Map(),requests=[],timers=new Map();let n=0;
  function node(){return {children:[],events:{},attrs:{},textContent:'',scrollLeft:0,clientWidth:600,scrollWidth:3900,addEventListener(k,f){this.events[k]=f;},setAttribute(k,v){this.attrs[k]=v;},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},scrollBy({left}){this.scrollLeft+=left;this.events.scroll?.();}};}
  const el=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const win={document:{getElementById:el,createElement:node},Date:{now:()=>now},AbortController,addEventListener(){},setTimeout(f){timers.set(++n,f);return n;},clearTimeout(id){timers.delete(id);},GregleWeather:require('../assets/weather-core.js'),fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));}};
  const api=core.createController(win),flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const respond=async(i,data=fixture())=>{requests[i].resolve({ok:true,json:async()=>data});await flush();};
  api.setLocation({name:'Vancouver',latitude:49.24,longitude:-123.12});
  return {api,el,requests,flush,respond,timers};
}
test('hourly loads on demand, returns to daily without losing daily cards, and reuses fresh hourly data',async()=>{
  const h=setup();h.el('forecastGrid').children=['daily'];assert.equal(h.requests.length,0);
  h.el('forecastHourly').events.change();assert(h.el('forecastGrid').hidden);await h.respond(0);assert.equal(h.el('hourlyGrid').children.length,24);
  assert.equal(h.el('hourlyPrevious').disabled,true);h.el('hourlyNext').events.click();assert(h.el('hourlyGrid').scrollLeft>0);
  h.el('forecastDaily').events.change();assert.equal(h.el('forecastGrid').hidden,false);assert.deepEqual(h.el('forecastGrid').children,['daily']);
  h.el('forecastHourly').events.change();assert.equal(h.requests.length,1);assert.equal(h.el('hourlyGrid').scrollLeft,0);
});
test('a location change discards a late response and preserves hourly mode',async()=>{
  const h=setup();h.api.setActive(true);h.api.setLocation({name:'London',latitude:51.5,longitude:-.12});assert(h.requests[0].options.signal.aborted);
  await h.respond(0);assert.equal(h.el('hourlyGrid').children.length,0);await h.respond(1);assert.match(h.el('hourlyStatus').textContent,/London/);
});
test('hourly failures offer retry and switching back cancels pending work',async()=>{
  const h=setup();h.api.setActive(true);h.requests[0].reject(Error('offline'));await h.flush();assert.equal(h.el('hourlyRetry').hidden,false);assert.equal(h.el('hourlyPanel').attrs['aria-busy'],'false');
  h.el('hourlyRetry').events.click();await h.respond(1);assert.equal(h.el('hourlyRetry').hidden,true);
  h.api.setLocation({name:'London',latitude:51.5,longitude:-.12});h.api.setActive(false);await h.respond(2);assert.equal(h.el('hourlyGrid').children.length,0);assert(h.el('hourlyPanel').hidden);
});


test('hourly feels-like preserves zero and missing values',()=>{
  const data=fixture();data.hourly.apparent_temperature=data.hourly.time.map((_,i)=>i===0?0:null);
  const parsed=core.parseHours(data,now);assert.equal(parsed.hours[0].feelsLike,0);assert.equal(parsed.hours[1].feelsLike,null);
  assert.match(core.forecastURL({latitude:0,longitude:0}),/apparent_temperature/);
});

test('solar events use exact destination times, span midnight and stay inside the 24-hour window',()=>{
  const data=fixture(),start=now-1800000;
  const rise=Date.parse('2025-11-02T15:02:00Z'),set=Date.parse('2025-11-03T00:48:00Z');
  data.daily={sunrise:[rise/1000,null,rise/1000],sunset:[set/1000,(start+24*3600000)/1000,'bad']};
  const parsed=core.parseHours(data,now);
  assert.deepEqual(parsed.events.map(e=>[e.kind,e.time]),[['sunrise','07:02'],['sunset','16:48']]);
  assert.match(parsed.events[0].label,/Sunrise/);
  data.timezone='Asia/Tokyo';
  const tokyo=core.parseHours(data,now).events;
  assert.equal(tokyo[0].time,'00:02');assert.match(tokyo[0].day,/Nov 3/);
  const url=new URL(core.forecastURL({latitude:48.42,longitude:-123.37}));
  assert.equal(url.searchParams.get('daily'),'sunrise,sunset');assert.equal(url.searchParams.get('forecast_days'),'2');
});

test('missing or invalid solar data preserves all hourly forecasts',()=>{
  for(const daily of [undefined,{}, {sunrise:[null,NaN,Infinity],sunset:[null]}, {sunrise:'invalid',sunset:[]}]) {
    const parsed=core.parseHours({...fixture(),daily},now);
    assert.equal(parsed.hours.length,24);assert.deepEqual(parsed.events,[]);
  }
});

test('sunrise and sunset cards are inserted chronologically with accessible exact times',async()=>{
  const h=setup(),data=fixture(),start=now-1800000;
  data.daily={sunrise:[(start+2*3600000+120000)/1000],sunset:[(start+10*3600000+2880000)/1000]};
  h.api.setActive(true);await h.respond(0,data);
  const cards=h.el('hourlyGrid').children;
  assert.equal(cards.length,26);
  assert.match(cards[3].className,/hourly-solar-card/);assert.match(cards[3].attrs['aria-label'],/^Sunrise ·/);
  assert.equal(cards[3].children[0].textContent,'02:02');assert.equal(cards[3].children[3].textContent,'Sunrise');
  assert.match(cards[12].attrs['aria-label'],/^Sunset ·/);
  assert.match(h.el('hourlyStatus').textContent,/24 hours/);
  h.api.setActive(false);h.api.setActive(true);
  assert.equal(h.requests.length,1);assert.equal(h.el('hourlyGrid').children.length,26);
});

