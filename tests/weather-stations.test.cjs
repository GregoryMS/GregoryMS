const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assets/weather-core.js');
const feature=(id,name,latitude,longitude,observation=name)=>({geometry:{coordinates:[longitude,latitude]},properties:{identifier:id,name:{en:name},currentConditions:{station:{value:{en:observation}}}}});
const directory={features:[
  feature('bc-75','Victoria Harbour',48.42,-123.39),
  feature('bc-85','Victoria',48.43,-123.36,"Victoria Int'l Airport"),
  feature('bc-59','Victoria (Hartland)',48.57,-123.46,"Victoria Int'l Airport"),
  feature('bc-66','Victoria (University of)',48.47,-123.30,'University of Victoria'),
  feature('bc-74','Vancouver',49.24,-123.12),
  feature('mb-55','Victoria Beach',50.71,-96.56),
  feature('bc-999','Victoria (Far away)',51,-123.39),
  feature('mb-99','Victoria',48.42,-123.39),
  feature('on-143','Toronto',43.65,-79.38),
  feature('on-128','Toronto Island',43.63,-79.39),
  feature('on-118','Ottawa (Kanata - Orléans)',45.4,-75.69),
  feature('on-52','Ottawa (Richmond - Metcalfe)',45.24,-75.47)
]};
const victoria={name:'Victoria',latitude:48.42,longitude:-123.39,country:'CA'};
test('station choices group local feeds without including other cities, provinces or distant namesakes',()=>{
  const choices=core.stationChoices(directory,victoria,{id:'bc-75'});
  assert.deepEqual(choices.map(s=>s.id).sort(),['bc-59','bc-66','bc-75','bc-85']);
  assert.equal(choices.find(s=>s.id==='bc-85').label,"Victoria Int'l Airport");
  assert.equal(choices.find(s=>s.id==='bc-59').label,'Victoria (Hartland)');
  assert.equal(core.stationChoices(directory,victoria,{id:'missing'}).length,0);
  assert.equal(core.stationChoices(directory,victoria,{id:'bc-74'}).length,1);
  assert.equal(core.stationChoices(directory,{latitude:43.65,longitude:-79.38},{id:'on-143'}).length,2);
  assert.equal(core.stationChoices(directory,{latitude:45.4,longitude:-75.69},{id:'on-118'}).length,2);
});
test('station choices reject incomplete directories and skip invalid station entries',()=>{
  assert.throws(()=>core.stationChoices({...directory,links:[{rel:'next'}]},victoria,{id:'bc-75'}));
  const bad={features:[feature('not/an-id','Victoria',48.43,-123.36),feature('bc-1','Victoria',NaN,0),feature('bc-2',123,48.43,-123.36),...directory.features]};
  assert.equal(core.stationChoices(bad,victoria,{id:'bc-75'}).length,4);
});

const weather=id=>({properties:{currentConditions:{temperature:{value:{en:id==='bc-85'?12:9}},station:{value:{en:id}}},forecastGroup:{forecasts:[{period:{value:{en:'Today'}},textSummary:{en:'Clear'},temperatures:{temperature:[]}}]}}});
const globalWeather={timezone:'Europe/London',current:{time:'2026-10-21T12:00',temperature_2m:15},daily:{time:['2026-10-21'],weather_code:[0],temperature_2m_max:[15],temperature_2m_min:[8]}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function environment(fetch) {
  const nodes=new Map();
  const element=()=>({value:'',textContent:'',children:[],style:{},listeners:{},hidden:false,
    classList:{toggle(){},contains(){return false;}},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;},
    replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const document={getElementById:get,createElement:element,querySelectorAll:()=>[],documentElement:element()};
  const context=vm.createContext({document,fetch,console,URL,AbortController,Intl,setTimeout:()=>1,clearTimeout(){},
    navigator:{},localStorage:{getItem(){},setItem(){}},matchMedia:()=>({matches:false}),
    GregleWeather:core,GregleTides:{locationFromURL:()=>null},GregleTideUI:{weatherPreview(){}}});
  context.window=context;
  const html=fs.readFileSync(path.join(__dirname,'../weather.html'),'utf8');
  const inline=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim()).join('\n');
  vm.runInContext(inline,context);
  return {context,get,run:code=>vm.runInContext(code,context)};
}
const response=data=>({ok:true,json:async()=>data});
const normalFetch=async url=>response(url.includes('limit=1000')?directory:url.includes('open-meteo.com')?globalWeather:weather(url.match(/items\/([^?]+)/)?.[1]));
test('Victoria defaults to Harbour, explicit Airport selection updates data and survives refresh',async()=>{
  const env=environment(normalFetch);
  await env.run('selectCity("victoria")');
  await flush();
  assert.equal(env.get('weatherStation').value,'bc-75');
  assert.equal(env.get('stationControl').hidden,false);
  assert.equal(env.get('weatherStation').children.length,4);
  env.get('weatherStation').value='bc-85';env.get('weatherStation').listeners.change();await flush();
  assert.equal(env.get('temperature').textContent,'12°C');
  assert.equal(env.get('weatherStation').value,'bc-85');
  assert.equal(env.get('cityName').textContent,'Victoria');
  await env.run('loadWeather()');assert.equal(env.get('weatherStation').value,'bc-85');
  await env.run('selectCity("vancouver")');assert.equal(env.get('stationControl').hidden,true);
  await env.run('selectCity("victoria")');assert.equal(env.get('weatherStation').value,'bc-75');
});
test('Victoria city lookups default to Harbour even when another local feed is nearest',async()=>{
  const env=environment(normalFetch);
  for(const [latitude,longitude] of [[48.43,-123.36],[48.47,-123.30],[48.57,-123.46]]) {
    await env.run(`selectLocation({name:"Victoria",country:"CA",latitude:${latitude},longitude:${longitude},timezone:"America/Vancouver"})`);
    await flush();
    assert.equal(env.get('weatherStation').value,'bc-75');
  }
});
test('directory failure preserves a working forecast and hides unavailable station choices',async()=>{
  const env=environment(async url=>{if(url.includes('limit=1000'))throw Error('Unavailable');return normalFetch(url);});
  await env.run('selectCity("victoria")');
  await flush();
  assert.equal(env.get('temperature').textContent,'9°C');
  assert.equal(env.get('stationControl').hidden,true);
  assert.match(env.get('sourceCredit').textContent,/Environment/);
});
test('switching to an international city hides choices and ignores late Canadian responses',async()=>{
  let finish;
  const env=environment(async url=>url.includes('items/bc-85?')?new Promise(resolve=>{finish=resolve;}):normalFetch(url));
  await env.run('selectCity("victoria")');
  await flush();
  env.get('weatherStation').value='bc-85';env.get('weatherStation').listeners.change();
  await env.run('selectLocation({name:"London",country:"GB",latitude:51.5,longitude:-0.12,timezone:"Europe/London"})');
  finish(response(weather('bc-85')));await flush();
  assert.equal(env.get('cityName').textContent,'London');
  assert.equal(env.get('temperature').textContent,'15°C');
  assert.equal(env.get('stationControl').hidden,true);
});
