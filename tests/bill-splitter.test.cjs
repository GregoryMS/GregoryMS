const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../assets/bill-splitter-core.js');
const defaults={mode:'equal',subtotal:'100',tax:'5',taxMode:'percent',tip:'15',tipMode:'percent',afterTax:false,
  people:[{name:'Alex'},{name:'Sam'}]};
test('equal shares include tax and tip, with an optional after-tax percentage tip',()=>{
  const r=C.calculate(defaults);
  assert.equal(r.total,12000);assert.deepEqual(r.people.map(p=>p.total),[6000,6000]);
  assert.equal(C.calculate({...defaults,afterTax:true}).total,12075);
});
test('individual costs and shared items allocate tax and tip proportionally',()=>{
  const r=C.calculate({...defaults,mode:'individual',subtotal:'30',tax:'10',tip:'20',
    people:[{name:'Alex',amount:'10'},{name:'Sam',amount:'30'}]});
  assert.equal(r.subtotal,7000);assert.equal(r.tax,700);assert.equal(r.tip,1400);
  assert.deepEqual(r.people.map(p=>p.subtotal),[2500,4500]);
  assert.deepEqual(r.people.map(p=>p.total),[3250,5850]);
});
test('fixed charges and shared penny remainders always sum to the original total',()=>{
  const r=C.calculate({...defaults,subtotal:'10.01',tax:'0.01',taxMode:'amount',tip:'0.02',tipMode:'amount',
    people:[{},{},{}]});
  assert.equal(r.total,1004);assert.equal(r.people.reduce((n,p)=>n+p.total,0),1004);
  for(const field of ['subtotal','tax','tip']) assert.equal(r.people.reduce((n,p)=>n+p[field],0),r[field]);
  assert.deepEqual(r.people.map(p=>p.total),[335,335,334]);
  for(const p of r.people) assert.equal(p.subtotal+p.tax+p.tip,p.total);
  assert.deepEqual(C.allocate(1,[1,1,1]),[1,0,0]);
});
test('tiny fixed charges can be divided equally without assigning negative pennies',()=>{
  const r=C.calculate({...defaults,subtotal:'0',tax:'0.01',taxMode:'amount',tip:'0.01',tipMode:'amount',people:[{},{},{}]});
  assert.deepEqual(r.people.map(p=>p.total),[1,1,0]);
  assert.equal(r.people.reduce((n,p)=>n+p.tax,0),1);
  for(const p of r.people) assert.ok(p.tax>=0 && p.tip>=0);
});
test('zero subtotals can split fixed charges and percentages support three decimal places',()=>{
  const r=C.calculate({...defaults,subtotal:'',tax:'5',taxMode:'amount',tip:'0'});
  assert.deepEqual(r.people.map(p=>p.total),[250,250]);
  assert.equal(C.calculate({...defaults,subtotal:'100',tax:'8.875',tip:'0'}).tax,888);
  assert.equal(C.money('.5'),50);assert.equal(C.money('0.29'),29);
});
test('invalid, negative and excessive input is rejected instead of returning a plausible split',()=>{
  for(const value of ['-1','NaN','1e3','0.001','Infinity','1000000.01']) assert.throws(()=>C.money(value));
  assert.throws(()=>C.percent('100.001'));
  assert.throws(()=>C.calculate({...defaults,people:[]}));
  assert.throws(()=>C.calculate({...defaults,people:Array.from({length:21},()=>({}))}));
});
test('large uneven bills allocate exactly without floating point rounding drift',()=>{
  const r=C.calculate({...defaults,mode:'individual',subtotal:'999999.99',tax:'100',tip:'100',afterTax:true,
    people:Array.from({length:20},(_,i)=>({amount:i%2 ? '999999.99' : '1000000'}))});
  assert.equal(r.people.reduce((n,p)=>n+p.total,0),r.total);
  assert.equal(r.people.reduce((n,p)=>n+p.tip,0),r.tip);
});
