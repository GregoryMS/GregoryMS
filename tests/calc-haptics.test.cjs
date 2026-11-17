const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/calc-haptics.js'),'utf8');
function setup({ios=true,switchSupport=true,vibrate=false} = {}) {
  const make = tag => ({tag,style:{},children:[],attributes:{},listeners:{},setAttribute(k,v) {this.attributes[k]=v;},append(child) {this.children.push(child);},addEventListener(k,fn) {this.listeners[k]=fn;}});
  const buttons = [make('button'),make('button')];
  const document = {createElement(tag) {const e=make(tag);if(tag==='input'&&switchSupport)e.switch=false;return e;},querySelectorAll(selector) {assert.equal(selector,'#scientificControls button');return buttons;}};
  const navigator = {userAgent:ios?'iPhone':'Android',platform:ios?'iPhone':'Linux',maxTouchPoints:5};
  if(vibrate)navigator.vibrate=()=>true;
  vm.runInNewContext(source,{navigator,document});return buttons;
}
test('iOS switch fallback retains buttons and forwards exactly one calculator activation',() => {
  for(const b of setup()) {
    assert.equal(b.style.position,'relative');const surface=b.children[0],pulse=surface.children[0];
    assert.equal(surface.tag,'label');assert.equal(surface.attributes['aria-hidden'],'true');
    assert.equal(pulse.type,'checkbox');assert('switch' in pulse.attributes);assert.equal(pulse.tabIndex,-1);
    assert.equal(pulse.style.visibility,'hidden');assert.equal(pulse.style.pointerEvents,'none');
    let stopped=false;pulse.listeners.click({stopPropagation() {stopped=true;}});assert(stopped);
  }
});
test('native vibration and browsers without iOS switch support keep their original buttons',() => {
  for(const config of [{vibrate:true},{ios:false},{switchSupport:false}])for(const b of setup(config))assert.equal(b.children.length,0);
});
