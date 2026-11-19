const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/calc-scientific.js'),'utf8');

function setup({vibration = 'supported', savedTheme = null} = {}) {
  const calls = [], events = {}, angles = ['deg','rad'].map(value => ({dataset:{scientificAngle:value},setAttribute(name,value) {this[name]=value;}}));
  let angle = 'rad';
  const shift = {setAttribute(name,value) {this[name] = value;}};
  const clearLabel = {textContent:'AC'};
  const clearKey = {
    dataset:{scientificAction:'clear',shiftLabel:'CLR ALL',shiftAria:'Clear calculation and saved history'},
    'aria-label':'Clear calculation',
    querySelector(selector) {return selector === '[data-key-label]' ? clearLabel : this.hint;},
    getAttribute(name) {return this[name];},
    setAttribute(name,value) {this[name] = value;},
    prepend(hint) {this.hint = hint;}
  };
  const controls = {
    querySelectorAll(selector) {return selector === '[data-scientific-angle]' ? angles : [clearKey];},
    addEventListener(type,callback) {events[type] = callback;}
  };
  const menuEvents = {}, themesButtonEvents = {};
  const themesButton = {
    'aria-expanded':'false',
    setAttribute(name,value) {this[name] = value;},
    addEventListener(type,callback) {themesButtonEvents[type] = callback;}
  };
  const themesPanel = {
    inert:true,
    hasAttribute(name) {return this[name];},
    toggleAttribute(name,value) {this[name] = value;}
  };
  const themes = ['gregle','graphite','chalk','silver','evo','evo-dark'].map(value => ({value,checked:value === 'gregle'}));
  const menu = {
    querySelectorAll() {return themes;},
    addEventListener(type,callback) {menuEvents[type] = callback;},
    showModal() {this.open = true;}
  };
  const page = {dataset:{}};
  const menuButton = {
    focus() {calls.push(['menu focus']);},
    blur() {calls.push(['menu blur']);}
  };
  const storage = new Map([['gregle-calc-scientific-theme',savedTheme]]);
  const localStorage = {getItem:key => storage.get(key),setItem:(key,value) => storage.set(key,value)};
  const select = {value:'rad',dispatchEvent() {angle=this.value;calls.push(['angle',angle]);}};
  const nodes = {
    scientificControls:controls, graphAngle:select, scientificShift:shift, scientificMenu:menu,
    calcPage:page, scientificMenuOpen:menuButton, scientificThemeToggle:themesButton, scientificThemePanel:themesPanel, copyResult:{click() {calls.push(['copy']);}}
  };
  const navigator = {};
  if (vibration !== 'absent') navigator.vibrate = duration => {calls.push(['vibrate',duration]);if (vibration === 'throws') throw Error('Unavailable');};
  const scientific = {getState:() => ({angle}),insert:(...args) => calls.push(['insert',...args]),calculate:() => calls.push(['calculate']),reset:(all=false) => calls.push(['reset',all]),navigate:direction => calls.push(['navigate',direction]),recallEntry:() => calls.push(['recall']),insertFraction:() => calls.push(['fraction']),toggleFraction:() => calls.push(['format'])};
  const document = {getElementById:id => nodes[id],createElement:() => ({setAttribute() {}})};
  vm.runInNewContext(source,{document,localStorage,navigator,Event:class {},window:{GregleScientific:scientific,GregleCalculator:{openScreen:(...args) => calls.push(['open',...args])}}});
  const click = (dataset,extra = {}) => events.click({target:{closest:() => ({dataset})},isTrusted:true,detail:1,...extra});
  return {calls,angles,click,events,shift,clearKey,clearLabel,menu,menuEvents,page,themes,storage,document,menuButton,themesButton,themesButtonEvents,themesPanel};
}

test('old graph bookmarks open scientific mode and the saved angle is shown and changed',() => {
  const app=setup();assert.deepEqual(app.calls[0],['open','calculate',false]);
  assert.equal(app.angles[1]['aria-pressed'],'true');
  app.click({scientificAngle:'deg'});
  assert.equal(app.angles[0]['aria-pressed'],'true');assert.equal(app.angles[1]['aria-pressed'],'false');
  assert(app.calls.some(call => call[0]==='angle' && call[1]==='deg'));
});
test('tap controls route entry, calculate, editing, cursor and recall to the calculator',() => {
  const app=setup();
  app.click({scientificInsert:'asin('});app.click({scientificInsert:'neg'});
  for (const action of ['calculate','clear','backspace','left','right','recall','copy']) app.click({scientificAction:action});
  assert.deepEqual(app.calls.filter(call => !['vibrate','open'].includes(call[0])),[
    ['insert','asin('],['insert','neg'],['calculate'],['reset',false],['insert','','backspace'],['navigate','left'],['navigate','right'],['recall'],['copy']
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

test('Shift makes AC clear saved history once and restores normal AC', () => {
  const app = setup();
  app.click({scientificAction:'shift'});
  assert.equal(app.clearLabel.textContent, 'CLR ALL');
  assert.equal(app.clearKey['aria-label'], 'Clear calculation and saved history');
  app.click(app.clearKey.dataset);
  assert.equal(app.shift['aria-pressed'], 'false');
  assert.equal(app.clearLabel.textContent, 'AC');
  app.click(app.clearKey.dataset);
  assert.deepEqual(app.calls.filter(call => call[0] === 'reset'), [['reset',true],['reset',false]]);
});

test('Menu restores a saved theme and applies and stores a new selection without resetting the calculator', () => {
  const app = setup({savedTheme:'graphite'});
  assert.equal(app.page.dataset.scientificTheme,'graphite');
  assert.equal(app.themes[1].checked,true);
  app.click({scientificAction:'menu'});
  assert.equal(app.menu.open,true);
  app.menuEvents.change({target:app.themes[3]});
  assert.equal(app.page.dataset.scientificTheme,'silver');
  assert.equal(app.storage.get('gregle-calc-scientific-theme'),'silver');
  app.document.activeElement = app.menuButton;
  app.menuEvents.close();
  assert(app.calls.some(call => call[0] === 'menu blur'));
  assert(!app.calls.some(call => call[0] === 'menu focus'));
  assert(!app.calls.some(call => call[0] === 'reset'));
  assert.equal(setup({savedTheme:'evo-dark'}).page.dataset.scientificTheme,'evo-dark');
  app.menuEvents.change({target:app.themes[4]});
  assert.equal(app.storage.get('gregle-calc-scientific-theme'),'evo');
  assert.equal(setup({savedTheme:'unknown'}).page.dataset.scientificTheme,undefined);
});

test('closing a keyboard-opened menu returns focus to its button', () => {
  const app = setup();
  app.click({scientificAction:'menu'},{detail:0});
  app.menuEvents.close();
  assert(app.calls.some(call => call[0] === 'menu focus'));
});

test('the Themes dropdown expands, collapses and resets when the menu closes', () => {
  const app = setup();
  assert.equal(app.themesPanel.inert,true);
  app.themesButtonEvents.click();
  assert.equal(app.themesButton['aria-expanded'],'true');
  assert.equal(app.themesPanel.inert,false);
  app.themesButtonEvents.click();
  assert.equal(app.themesButton['aria-expanded'],'false');
  assert.equal(app.themesPanel.inert,true);
  app.themesButtonEvents.click();
  app.menuEvents.close();
  assert.equal(app.themesButton['aria-expanded'],'false');
  assert.equal(app.themesPanel.inert,true);
});
