const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/calc-picker.js'),'utf8');
function setup(initial = 'scientific') {
  let listener,notify;
  const clicks = [];
  const picker = {value:'scientific',disabled:false,addEventListener(type,fn) {if (type === 'change') listener=fn;}};
  const buttons = Object.fromEntries(['ti84','ti89','tinspire'].map(engine => [engine,{
    checked:engine===initial,disabled:false,getAttribute() {return String(this.checked);},click() {clicks.push(engine);}
  }]));
  const nodes = {calculatorEngine:picker,emulatorOpen:buttons.ti84,ti89Open:buttons.ti89,tinspireOpen:buttons.tinspire};
  vm.runInNewContext(source,{document:{getElementById:id=>nodes[id]},MutationObserver:class {constructor(fn) {notify=fn;} observe() {}}});
  return {picker,buttons,clicks,choose(engine) {picker.value=engine;listener();},show(engine) {for(const [name,b] of Object.entries(buttons))b.checked=name===engine;notify();},notify};
}
test('picker lists the requested model names and restores the selected TI name',() => {
  const html=fs.readFileSync(path.join(__dirname,'../calc.html'),'utf8');
  const options=[...html.matchAll(/<option value="(scientific|ti84|ti89|tinspire)">([^<]+)<\/option>/g)];
  assert.deepEqual(options.map(m=>[m[1],m[2]]),[['scientific','Calculator'],['ti84','TI-84 CE'],['ti89','TI-89 T'],['tinspire','TI-Nspire CAS']]);
  for(const engine of ['scientific','ti84','ti89','tinspire'])assert.equal(setup(engine).picker.value,engine);
});
test('switching waits for the actual model and busy download state before enabling the picker',() => {
  const app=setup('ti84');app.choose('ti89');assert.deepEqual(app.clicks,['ti89']);assert(app.picker.disabled);
  app.show('scientific');assert(app.picker.disabled);app.buttons.ti89.disabled=true;app.show('ti89');
  assert.equal(app.picker.value,'ti89');assert(app.picker.disabled);
  app.buttons.ti89.disabled=false;app.notify();assert.equal(app.picker.disabled,false);
});
test('returning to Calculator uses the active TI control so its normal pause and save behavior runs',() => {
  const app=setup('tinspire');app.choose('scientific');assert.deepEqual(app.clicks,['tinspire']);assert(app.picker.disabled);
  app.show('scientific');assert.equal(app.picker.value,'scientific');assert.equal(app.picker.disabled,false);
  app.choose('scientific');assert.equal(app.clicks.length,1);
});
