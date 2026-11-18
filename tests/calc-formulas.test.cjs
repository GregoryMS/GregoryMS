const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/calc-formulas.js'),'utf8');

function setup(saved) {
  function node(tag = '', dataset = {}) {
    return {
      tag, dataset, children: [], listeners: {}, attributes: {}, textContent: '',
      append(...children) {this.children.push(...children);},
      replaceChildren(...children) {this.children = children;},
      addEventListener(type,listener) {this.listeners[type] = listener;},
      setAttribute(name,value) {this.attributes[name] = value;},
      querySelector(selector) {return flatten(this).find(child => '.'+child.className === selector);},
      focus() {this.focused = true;},
      getContext() {return null;}
    };
  }
  function flatten(root) {return [root,...root.children.flatMap(flatten)];}
  const tabs = ['maths','physics','favourites'].map(formulaSubject => node('button',{formulaSubject}));
  const nodes = Object.fromEntries(['scientificMenu','scientificMenuSettings','formulaReference',
    'openFormulaReference','backFromFormulaReference','formulaSearch','formulaTopics','formulaStatus'].map(id => [id,node()]));
  nodes.scientificMenu.classList = {toggle() {}};
  nodes.formulaReference.querySelectorAll = () => tabs;
  nodes.formulaSearch.value = '';
  const storage = new Map([['gregle-calc-formula-favourites',JSON.stringify(saved ?? [])]]);
  const document = {getElementById:id => nodes[id],createElement:node,createDocumentFragment:() => node()};
  const localStorage = {getItem:key => storage.get(key),setItem:(key,value) => storage.set(key,value)};
  vm.runInNewContext(source,{document,localStorage});
  return {
    nodes, storage,
    open() {nodes.openFormulaReference.listeners.click();},
    tab(index) {tabs[index].listeners.click();},
    search(value) {nodes.formulaSearch.value = value;nodes.formulaSearch.listeners.input();},
    headings() {return flatten(nodes.formulaTopics).filter(child => child.tag === 'h3').map(child => child.textContent);}
  };
}

test('formula topics browse by subject and search by equation or description', () => {
  const app = setup();
  app.open();
  assert.equal(app.nodes.scientificMenuSettings.hidden,true);
  assert.equal(app.nodes.formulaReference.hidden,false);
  assert(app.headings().includes('Triangles'));
  app.search("heron's formula");
  assert.deepEqual(app.headings(),['Triangles']);
  app.tab(1);
  app.search('suvat');
  assert.deepEqual(app.headings(),['Constant acceleration']);
  app.search('no such formula');
  assert.equal(app.nodes.formulaStatus.textContent,'No matching formulas.');
  app.nodes.backFromFormulaReference.listeners.click();
  assert.equal(app.nodes.formulaReference.hidden,true);
});

test('favourites persist across subjects and can be removed', () => {
  const app = setup(['quadratic']);
  app.open();
  app.tab(2);
  assert.deepEqual(app.headings(),['Quadratic formula']);
  app.nodes.formulaTopics.querySelector('.formula-star').listeners.click();
  assert.deepEqual(app.headings(),[]);
  assert.equal(app.storage.get('gregle-calc-formula-favourites'),'[]');
  app.tab(1);
  app.search('ohm');
  app.nodes.formulaTopics.querySelector('.formula-star').listeners.click();
  assert.equal(app.storage.get('gregle-calc-formula-favourites'),'["ohm"]');
});
