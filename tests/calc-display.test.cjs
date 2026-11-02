const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'../calc.html'),'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function setup({ios = false, standalone = false, search = '', legacy = false} = {}) {
  const classes = new Set(); let change;
  const display = {matches:standalone};
  if (legacy) display.addListener = fn => {change = fn;};
  else display.addEventListener = (type,fn) => {assert.equal(type,'change'); change = fn;};
  const context = {
    location:{search}, navigator:{standalone:ios}, URLSearchParams,
    window:{matchMedia:query => {assert.equal(query,'(display-mode: standalone)'); return display;}},
    document:{documentElement:{classList:{toggle(name,value) {if (value) classes.add(name); else classes.delete(name);}}}}
  };
  vm.runInNewContext(script,context);
  return {classes,setDisplay(value) {display.matches = value; change();}};
}
test('ordinary browser visits keep the full calculator page', () => {
  const app = setup(); assert(!app.classes.has('calculator-popout')); assert(!app.classes.has('calculator-standalone'));
});
test('an iOS home-screen launch selects the calculator-only layout independently of media-query support', () => {
  const app = setup({ios:true,legacy:true});
  assert(app.classes.has('calculator-popout')); assert(app.classes.has('calculator-standalone'));
  app.setDisplay(false); assert(app.classes.has('calculator-popout'));
});
test('standalone display mode hides the page and responds to mode changes', () => {
  const app = setup({standalone:true});
  assert(app.classes.has('calculator-popout')); assert(app.classes.has('calculator-standalone'));
  app.setDisplay(false); assert(!app.classes.has('calculator-popout')); assert(!app.classes.has('calculator-standalone'));
  app.setDisplay(true); assert(app.classes.has('calculator-popout')); assert(app.classes.has('calculator-standalone'));
});
test('leaving standalone mode preserves an explicitly opened pop-out', () => {
  const app = setup({standalone:true,search:'?popout=1'}); app.setDisplay(false);
  assert(app.classes.has('calculator-popout')); assert(!app.classes.has('calculator-standalone'));
});
