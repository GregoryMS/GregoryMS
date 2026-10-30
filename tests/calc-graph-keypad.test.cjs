const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const graph = require('../assets/calc-graph-core.js');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'calc.html'), 'utf8');

function setup(initialState) {
  const elements = new Map(), saved = new Map();
  if (initialState) saved.set('gregle-calc-graph', JSON.stringify(initialState));
  let activeElement;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {};
      this.attributes = {}; this.dataset = {}; this.value = ''; this.selectionStart = this.selectionEnd = 0;
      this.classList = {toggle() {}, contains() {return false;}}; this.style = {setProperty() {}};
    }
    set id(value) {this._id = value; elements.set(value, this);}
    get id() {return this._id;}
    setAttribute(name, value) {this.attributes[name] = value;}
    addEventListener(type, fn) {(this.listeners[type] ||= []).push(fn);}
    dispatch(type, event = {}) {for (const fn of this.listeners[type] || []) fn({target:this, ...event});}
    append(...children) {for (const child of children) {child.parent = this; this.children.push(child);}}
    remove() {this.parent.children.splice(this.parent.children.indexOf(this), 1);}
    closest(selector) {return selector === 'button' && this.tagName === 'BUTTON' ? this : null;}
    focus() {if (activeElement !== this) {activeElement = this; this.dispatch('focus');}}
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
    }
    setSelectionRange(start, end) {this.selectionStart = start; this.selectionEnd = end;}
    getContext() {return {};}
  }
  const document = new Element();
  document.documentElement = new Element();
  document.getElementById = id => elements.get(id);
  document.createElement = tag => new Element(tag);
  document.querySelectorAll = () => [];
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {const element = new Element(); element.id = id;}
  const buttons = [];
  const keyboard = html.split('id="graphKeyboard"')[1].split('</section>')[0];
  for (const [, attributes] of keyboard.matchAll(/<button\b([^>]+)>/g)) {
    const button = new Element('button');
    for (const [, key, value] of attributes.matchAll(/data-graph-(insert|action)="([^"]*)"/g)) {
      button.dataset[key === 'insert' ? 'graphInsert' : 'graphAction'] = value;
    }
    buttons.push(button);
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/calc-graph.js'), 'utf8'), {
    document, window:{GregleGraph:graph, location:{search:''}}, URLSearchParams,
    localStorage:{getItem:key => saved.get(key), setItem:(key,value) => saved.set(key,value)},
    setTimeout:() => 1, clearTimeout() {}, requestAnimationFrame:() => 1,
    ResizeObserver:class {observe() {}}, MutationObserver:class {observe() {}}
  });
  const get = id => elements.get(id);
  const inputs = () => get('equationList').children.map(row => row.children[0].children[2]);
  function key(value, action = false) {
    const button = buttons.find(b => b.dataset[action ? 'graphAction' : 'graphInsert'] === value);
    assert(button, `Missing keypad button ${value}`);
    let prevented = false;
    get('graphKeyboard').dispatch('pointerdown', {target:button, preventDefault() {prevented = true;}});
    assert(prevented, 'Pointer activation preserves the expression selection');
    get('graphKeyboard').dispatch('click', {target:button});
  }
  function type(input, value) {input.focus(); input.value = value; input.setSelectionRange(value.length,value.length); input.dispatch('input');}
  const state = () => {document.dispatch('gregle-calc-save-graph'); return JSON.parse(saved.get('gregle-calc-graph'));};
  const remove = input => input.parent.children[3].dispatch('click');
  return {get, inputs, key, type, state, remove};
}

test('keypad edits the selected equation at its cursor, replaces selections and saves updates', () => {
  const app = setup(), [first, second] = app.inputs();
  app.type(second, 'x+1'); second.setSelectionRange(2,3); app.key('2');
  assert.equal(second.value, 'x+2'); assert.equal(first.value, 'sin(x)');
  assert.equal(second.selectionStart, 3);
  second.setSelectionRange(1,1); app.key('^2');
  assert.equal(second.value, 'x^2+2');
  assert.equal(second.attributes['aria-invalid'], 'false');
  assert.match(app.get('graphKeypadTarget').textContent, /equation 2/);
  assert.equal(app.state().equations[1].expression, 'x^2+2');
});

test('clear, backspace and function keys keep errors and expression state in sync', () => {
  const app = setup(), [first] = app.inputs();
  app.key('clear', true); app.key('sin(');
  assert.equal(first.attributes['aria-invalid'], 'true');
  app.key('x'); app.key(')');
  assert.equal(first.value, 'sin(x)'); assert.equal(first.attributes['aria-invalid'], 'false');
  first.setSelectionRange(0,3); app.key('backspace', true);
  assert.equal(first.value, '(x)');
  first.setSelectionRange(0,0); app.key('backspace', true); assert.equal(first.value, '(x)');
  first.setSelectionRange(3,3); app.key('backspace', true); assert.equal(first.value, '(x');
  assert.equal(first.attributes['aria-invalid'], 'true');
  app.key('clear', true); assert.equal(first.value, ''); assert.equal(first.attributes['aria-invalid'], 'false');
});

test('keypad follows added and removed equations and recreates a row after the last is removed', () => {
  const app = setup();
  while (app.inputs().length < 8) app.get('addEquation').dispatch('click');
  assert.equal(app.get('addEquation').disabled, true);
  const last = app.inputs().at(-1); app.key('a'); assert.equal(last.value, 'a');
  app.remove(last); assert.equal(app.get('addEquation').disabled, false);
  app.key('x'); assert.equal(app.inputs().at(-1).value, 'x');
  for (const input of app.inputs()) app.remove(input);
  assert.match(app.get('graphKeypadTarget').textContent, /add an expression/);
  app.key('2'); app.key('x'); assert.equal(app.inputs()[0].value, '2x');
  assert.equal(app.state().equations[0].expression, '2x');
});

test('keypad respects the expression limit while allowing replacement and remains separate from arithmetic', () => {
  const app = setup(), [first] = app.inputs();
  app.type(first, '1'.repeat(300)); app.key('2'); assert.equal(first.value.length, 300);
  first.setSelectionRange(0,2); app.key('sin('); assert.equal(first.value.length, 300);
  first.setSelectionRange(0,4); app.key('sin('); assert.equal(first.value.length, 300);
  assert(first.value.startsWith('sin('));
  assert.equal(app.get('expression').value, '');
  const keyboard = html.split('id="graphKeyboard"')[1].split('</section>')[0];
  assert(!/\bdata-insert=/.test(keyboard), 'Graph buttons must not trigger the arithmetic input listener');
});


test('WINDOW applies independent axis ranges and rejects reversed or excessive ranges', () => {
  const app = setup();
  function apply(values) {
    ['graphXmin','graphXmax','graphYmin','graphYmax'].forEach((id,i) => {app.get(id).value = String(values[i]);});
    app.get('graphWindowForm').dispatch('submit', {preventDefault() {}});
    return app.state().view;
  }
  assert.deepEqual(apply([-5,15,-2,8]), {x:5,y:3,span:20,yspan:10});
  assert.equal(app.get('graphScreenTitle').textContent, 'GRAPH');
  const valid = app.state().view;
  for (const values of [[5,-5,-2,8],[-5,5,8,-2],[-5,5,0,0],[-5,5,-1e9,1e9],[-5,Infinity,-2,8]]) {
    assert.deepEqual(apply(values), valid);
    assert.match(app.get('graphWindowError').textContent, /increasing ranges/);
  }
});

test('window ranges restore from storage and zoom together without losing their aspect ratio', () => {
  const app = setup({equations:[{expression:'x',enabled:true}],view:{x:3,y:2,span:8,yspan:30}});
  app.get('graphZoomOut').dispatch('click');
  assert.deepEqual(app.state().view, {x:3,y:2,span:16,yspan:60});
  app.get('graphZoomIn').dispatch('click');
  assert.deepEqual(app.state().view, {x:3,y:2,span:8,yspan:30});
  app.get('graphReset').dispatch('click');
  assert.deepEqual(app.state().view, {x:0,y:0,span:20,yspan:20});
  const old = setup({equations:[{expression:'x'}],view:{x:0,y:0,span:20}});
  assert.deepEqual(old.state().view, {x:0,y:0,span:20});
});
