const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/calc-viewport.js'),'utf8');
function setup() {
  const events = {};
  let scientific = true;
  const document = {
    documentElement: {classList: {contains: name => name === 'calculator-standalone'}},
    getElementById: () => ({matches: () => scientific}),
    addEventListener: (name, handler) => {events[name] = handler;}
  };
  const window = {visualViewport: {scale: 1}, matchMedia: () => ({matches: true})};
  vm.runInNewContext(source, {document, window});

  function move({scrollHeight=0,clientHeight=0,scrollTop=0,delta=-10,pinch=false,zoom=1}={}) {
    window.visualViewport.scale=zoom;let prevented=false;
    const scroller=scrollHeight?{scrollHeight,clientHeight,scrollTop}:null;
    events.touchstart({touches:[{clientY:100}]});
    events.touchmove({touches:pinch?[{},{}]:[{clientY:100+delta}],target:{closest:()=>scroller},cancelable:true,preventDefault(){prevented=true;}});
    return prevented;
  }

  return {move, setScientific(value) {scientific = value;}};
}
test('root bounce is blocked while history scrolling and pinch zoom remain available',()=>{
  const app=setup();assert(app.move());
  assert.equal(app.move({scrollHeight:500,clientHeight:100,scrollTop:50}),false);
  assert(app.move({scrollHeight:500,clientHeight:100,scrollTop:0,delta:10}));
  assert(app.move({scrollHeight:500,clientHeight:100,scrollTop:400,delta:-10}));
  assert.equal(app.move({pinch:true}),false);assert.equal(app.move({zoom:2}),false);
});
test('switching to a TI calculator releases the scientific touch lock', () => {
  const app = setup();
  app.setScientific(false);
  assert.equal(app.move(), false);
  app.setScientific(true);
  assert.equal(app.move(), true);
});
test('the viewport and installed-app mode are established before stylesheet loading',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../calc.html'),'utf8');
  assert(html.indexOf('name="viewport"')<html.indexOf('assets/preferences.js'));
  assert(html.indexOf("classList.toggle('calculator-standalone'")<html.indexOf('<link rel="stylesheet"'));
});
