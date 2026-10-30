const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const graph = require('../assets/calc-graph-core.js');
const calc = require('../assets/calc-core.js');
const close = (a,b) => assert(Math.abs(a-b) < 1e-10,`${a} != ${b}`);
const bounds = {xmin:-5,xmax:5,ymin:-5,ymax:5,width:600,height:400};

test('compiled functions accept x, a, y=, implicit multiplication and angle units', () => {
  close(graph.compile('y = 2x^2 - 3x + 1')(2),3);
  close(graph.compile('f(x) = sin(a*x)')(Math.PI/2,{a:1}),1);
  close(graph.compile('sin(x)')(30,{angle:'deg'}),.5);
  close(graph.compile('x + a')(3,{a:-2}),1);
  close(graph.compile('x + 10%')(2),2.1);
  close(calc.evaluate('200+10%'),220);
  close(graph.compile('abs(x) + sqrt(4) + log(100)')(-3),7);
  assert.throws(()=>calc.evaluate('x+1'));
  assert.throws(()=>graph.compile('z+x'));
  assert.throws(()=>graph.compile('x^2+y^2=4'));
  assert.throws(()=>graph.compile('window.alert(1)'));
  assert.throws(()=>graph.compile('y='));
});
test('function domain errors become undefined samples while valid nearby points survive', () => {
  const fn=graph.compile('sqrt(x)');
  assert(Number.isNaN(graph.safe(fn,-1))); close(graph.safe(fn,4),2);
  const curves=graph.paths(fn,bounds);
  assert(curves.length>0); assert(curves.flat().every(([x])=>x>=0));
  assert.equal(graph.paths(graph.compile('sqrt(-1)'),bounds).length,0);
});
test('sampling preserves smooth functions and separates poles and jumps', () => {
  const lines=graph.paths(graph.compile('sin(x)'),bounds);
  assert.equal(lines.length,1); assert(lines[0].length>=600);
  for(const [x,y] of lines[0]) close(y,Math.sin(x));
  const pole=.137, reciprocal=graph.paths(graph.compile('1/(x-0.137)'),bounds);
  assert(reciprocal.length>=2);
  for(const line of reciprocal) assert(!(line[0][0]<pole && line.at(-1)[0]>pole),'must not draw through a vertical asymptote');
  const tangent=graph.paths(graph.compile('tan(x)'),bounds);
  for(const line of tangent) for(const pole of [-Math.PI/2,Math.PI/2]) assert(!(line[0][0]<pole && line.at(-1)[0]>pole));
  const steps=graph.paths(graph.compile('floor(x)'),bounds);
  for(const line of steps) assert(line.every(([,y])=>y===line[0][1]),'step functions must not have vertical connectors');
});
test('sampling work stays bounded for rapid oscillations and extreme functions', () => {
  let calls=0;
  graph.paths(x=>{calls++;return Math.sin(x*1e8);},{...bounds,width:200});
  assert(calls<8000,`${calls} samples exceed the work limit`);
  assert(graph.tickStep(20,800)>0); assert(graph.tickStep(.000001,400)>0);
});
test('graphing is local, default, keyboard-accessible and keeps calculator available', () => {
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'calc.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'assets/calc-graph.js'),'utf8');
  assert.match(html,/data-calc-mode="graph" aria-pressed="true"/);
  assert.match(html,/id="graphCanvas" tabindex="0"/);
  assert.match(html,/id="arithmeticPanel" hidden/);
  assert.match(html,/id="traceInput"/); assert.match(html,/id="graphTable"/);
  assert(!/<iframe\b/i.test(html));
  assert(!/https?:\/\/|fetch\(|\beval\s*\(|new Function/.test(js));
  for(const file of ['assets/calc-graph-core.js','assets/calc-graph.js','assets/calc-graph.css']) assert(fs.existsSync(path.join(root,file)));
});
