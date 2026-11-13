const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=require('../assets/weather-alerts.js');
function setup(){
  const badge={hidden:true,dataset:{}},attrs={'aria-label':'Open weather for Victoria'};
  const chip={title:'Weather for Victoria',querySelector:()=>badge,setAttribute:(k,v)=>attrs[k]=v,getAttribute:k=>attrs[k]};
  let warnings=[],fail=false,now=Date.now(),counter=0;const timers=new Map();
  const win={document:{hidden:false,getElementById:()=>chip,addEventListener(){}},addEventListener(){},Date:{now:()=>now},AbortController,
    GregleWeatherAlertsCore:core,GregleWeather:{nearestStation:()=>({id:'bc-75'})},
    setTimeout(fn,ms){timers.set(++counter,{fn,ms});return counter;},clearTimeout:id=>timers.delete(id),
    fetch:async url=>{if(fail)throw Error('offline');return{ok:true,json:async()=>url.includes('/items/bc-75')?{properties:{lastUpdated:new Date(now).toISOString(),warnings}}:{features:[]}};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/home-weather-alerts.js'),'utf8'),{window:win,URLSearchParams});
  const alert=(colour,type='warning',expires=now+60000)=>({type:{en:type},description:{en:type==='statement'?'Special weather statement':colour+' warning'},alertColourLevel:{en:colour},eventIssue:{en:new Date(now-60000).toISOString()},expiryTime:{en:new Date(expires).toISOString()}});
  return{badge,chip,attrs,alert,timers,setWarnings:v=>warnings=v,setFailure:v=>fail=v,advance:ms=>now+=ms,load:()=>win.GregleHomeWeatherAlerts.setLocation({latitude:48.42,longitude:-123.36,country:'CA'}),refresh:async()=>{const entry=[...timers.values()].find(t=>t.ms===core.REFRESH_MS);assert(entry);await entry.fn();}};
}
test('home weather indicator uses highest official colour, grey statements, and hides for clear/unavailable data',async()=>{
  const h=setup();h.setWarnings([h.alert('yellow'),h.alert('red'),h.alert('orange')]);await h.load();
  assert.equal(h.badge.hidden,false);assert.equal(h.badge.dataset.colour,'red');assert.match(h.attrs['aria-label'],/red warning/);
  h.setWarnings([h.alert('red','statement')]);await h.refresh();assert.equal(h.badge.dataset.colour,'neutral');assert.match(h.chip.title,/Special weather statement/);
  h.setWarnings([]);await h.refresh();assert.equal(h.badge.hidden,true);assert.equal(h.chip.title,'Weather for Victoria');
  h.setWarnings([h.alert('yellow')]);await h.refresh();h.setFailure(true);await h.refresh();assert.equal(h.badge.hidden,true);
});
test('expired alerts are removed while later alerts remain',async()=>{
  const h=setup();h.setWarnings([h.alert('red'),h.alert('yellow','warning',Date.now()+120000)]);await h.load();
  const expiry=[...h.timers.values()].find(t=>t.ms<=60000);assert(expiry);h.advance(60001);expiry.fn();assert.equal(h.badge.hidden,false);assert.equal(h.badge.dataset.colour,'yellow');
});
