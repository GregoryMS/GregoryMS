const {test} = require('node:test');
const assert = require('node:assert/strict');
const {evaluate, format} = require('../assets/calc-core.js');
const fs = require('node:fs');
const path = require('node:path');
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('calculator follows arithmetic precedence, powers, unary signs and brackets', () => {
  for (const [expression, expected] of [['2+3*4',14],['(2+3)×4',20],['−2^2',-4],['(-2)^2',4],['2^3^2',512],['2^-2',.25],['6÷2',3],['2(3+4)',14],['2π',2*Math.PI],['1e-4 + 0.0002',.0003],['5!',120],['0!',1],['3--2',5]]) close(evaluate(expression),expected);
  assert.equal(format(evaluate('0.1+0.2')), '0.3');
  assert.equal(format(-0),'0');
});
test('percentages work for standalone values, products and relative changes', () => {
  for (const [expression, expected] of [['10%',.1],['200+10%',220],['200-10%',180],['200×10%',20],['200÷10%',2000],['100+10%+10%',121],['200+(10%)',220]]) close(evaluate(expression),expected);
});
test('scientific functions use the selected angle unit and last answer', () => {
  close(evaluate('sin(30)'),.5); close(evaluate('cos(60)'),.5); close(evaluate('tan(45)'),1);
  close(evaluate('sin(pi/2)',{angle:'rad'}),1); close(evaluate('asin(1)'),90);
  close(evaluate('acos(0)',{angle:'rad'}),Math.PI/2);
  close(evaluate('sqrt(81)+log(100)+ln(e)'),12); close(evaluate('abs(-7)'),7);
  close(evaluate('ans*2',{ans:21}),42);
});
test('undefined, incomplete, huge and non-mathematical inputs fail safely', () => {
  for (const expression of ['1/0','sqrt(-1)','ln(0)','tan(90)','asin(2)','171!','2.5!','1e999','2^99999','(2+3','2+)3','2+','sin30','alert(1)','globalThis.process','2;3', '('.repeat(100)+'1'+')'.repeat(100), '1'.repeat(301)]) assert.throws(()=>evaluate(expression),undefined,expression);
});
test('calculator page has the canonical host, app icons and shared launcher', () => {
  const root = path.join(__dirname,'..');
  const html = fs.readFileSync(path.join(root,'calc.html'),'utf8');
  assert.match(html,/rel="canonical" href="https:\/\/calc\.gregle\.uk\/"/);
  assert.match(html,/data-gregle-app-id="\/calc.html"/);
  for (const file of ['assets/calc-core.js','assets/calc.js','assets/calc.css','assets/calc-app/icon.svg','assets/calc-app/apple-touch-icon.png','calc.webmanifest']) assert(fs.existsSync(path.join(root,file)),file);
  assert(!/\beval\s*\(|new Function/.test(fs.readFileSync(path.join(root,'assets/calc-core.js'),'utf8')));
});
