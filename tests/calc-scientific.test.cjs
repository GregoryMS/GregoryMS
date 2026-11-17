const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/calc-scientific.js'),'utf8');

function setup({vibration = 'supported'} = {}) {
  const calls = [], events = {}, angles = ['deg','rad'].map(value => ({dataset:{scientificAngle:value},setAttribute(name,value) {this[name]=value;}}));
  let angle = 'rad';
  const controls = {querySelectorAll:selector => selector === '[data-scientific-angle]' ? angles : [],addEventListener(type,callback) {events[type]=callback;}};
  const select = {value:'rad',dispatchEvent() {angle=this.value;calls.push(['angle',angle]);}};
  const nodes = {scientificControls:controls,graphAngle:select,copyResult:{click() {calls.push(['copy']);}},clearHistory:{click() {calls.push(['history']);}}};
  const navigator = {};
  if (vibration !== 'absent') navigator.vibrate = duration => {calls.push(['vibrate',duration]);if (vibration === 'throws') throw Error('Unavailable');};
  const scientific = {getState:() => ({angle}),insert:(...args) => calls.push(['insert',...args]),calculate:() => calls.push(['calculate']),reset:(all=false) => calls.push(['reset',all]),navigate:direction => calls.push(['navigate',direction]),recallEntry:() => calls.push(['recall']),insertFraction:() => calls.push(['fraction']),toggleFraction:() => calls.push(['format'])};
  vm.runInNewContext(source,{document:{getElementById:id => nodes[id]},navigator,Event:class {},window:{GregleScientific:scientific,GregleCalculator:{openScreen:(...args) => calls.push(['open',...args])}}});
  const click = (dataset,extra = {}) => events.click({target:{closest:() => ({dataset})},isTrusted:true,detail:1,...extra});
  return {calls,angles,click,events};
}

test('old graph bookmarks open scientific mode and the saved angle is shown and changed',() => {
  const app=setup();assert.deepEqual(app.calls[0],['open','calculate',false]);
  assert.equal(app.angles[1]['aria-pressed'],'true');
  app.click({scientificAngle:'deg'});
  assert.equal(app.angles[0]['aria-pressed'],'true');assert.equal(app.angles[1]['aria-pressed'],'false');
  assert(app.calls.some(call => call[0]==='angle' && call[1]==='deg'));
});
test('tap controls route entry, calculate, editing, cursor, recall and history to the calculator',() => {
  const app=setup();
  app.click({scientificInsert:'asin('});app.click({scientificInsert:'neg'});
  for (const action of ['calculate','clear','backspace','left','right','recall','copy','history']) app.click({scientificAction:action});
  assert.deepEqual(app.calls.filter(call => !['vibrate','open'].includes(call[0])),[
    ['insert','asin('],['insert','neg'],['calculate'],['reset',false],['insert','','backspace'],['navigate','left'],['navigate','right'],['recall'],['copy'],['reset',true]
  ]);
  let prevented=false;app.events.pointerdown({target:{closest:() => ({})},preventDefault() {prevented=true;}});assert(prevented);
});
test('a short haptic pulse accompanies real taps; unsupported or blocked vibration leaves calculation working',() => {
  const app=setup();app.click({scientificInsert:'7'});assert(app.calls.some(call => call[0]==='vibrate' && call[1]===8));
  const count=app.calls.filter(call => call[0]==='vibrate').length;
  app.click({scientificInsert:'8'},{isTrusted:false});app.click({scientificInsert:'9'},{detail:0});
  assert.equal(app.calls.filter(call => call[0]==='vibrate').length,count);
  for (const vibration of ['absent','throws']) {const app=setup({vibration});app.click({scientificAction:'calculate'});assert(app.calls.some(call => call[0]==='calculate'));}
});
