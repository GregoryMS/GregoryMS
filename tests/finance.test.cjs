const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'assets/finance-core.js'),'utf8'),context);
const core=context.GregleFinance;

test('finance lookup resolves company names, Canadian listings and currency pairs',()=>{
  assert.equal(core.search('apple')[0].symbol,'NASDAQ:AAPL');
  assert.equal(core.search('Google')[0].symbol,'NASDAQ:GOOGL');
  assert.equal(core.search('Royal Bank')[0].symbol,'TSX:RY');
  assert.equal(core.search('GBP / CAD')[0].symbol,'FX_IDC:GBPCAD');
  assert.equal(core.search('canadian dollar')[0].type,'Currency');
  assert.equal(core.search('TSX:WCN')[0].symbol,'TSX:WCN');
  assert.equal(core.search('brk.b')[0].symbol,'NYSE:BRK.B');
  assert.equal(core.search('not a company in the directory').length,0);
  assert.equal(core.search('').length,0);
});
test('finance symbol validation rejects unsafe and malformed deep links',()=>{
  for(const value of ['<script>alert(1)</script>','javascript:alert(1)','https://bad.example','AAPL&x=y','NASDAQ:','FX:USD/CAD','A'.repeat(90),null,{},'USD/USD']) assert.equal(core.normalizeSymbol(value),'');
  assert.equal(core.normalizeSymbol(' usd / cad '),'FX_IDC:USDCAD');
  assert.equal(core.normalizeSymbol('nasdaq:aapl'),'NASDAQ:AAPL');
  assert.equal(core.normalizeSymbol('LSE:BP.'),'LSE:BP.');
});
test('finance saved favourites reject corrupt data, duplicates and oversized lists',()=>{
  assert.equal(core.cleanFavourites(null).length,0);
  const clean=core.cleanFavourites([{symbol:'NASDAQ:AAPL',name:'Apple'},{symbol:'NASDAQ:AAPL',name:'Duplicate'},{symbol:'<script>',name:'Invalid'},null,{symbol:'TSX:RY',name:[]},{symbol:'TSX:TD',name:'x'.repeat(81)}]);
  assert.equal(clean.length,1);
  assert.equal(clean[0].name,'Apple');
  assert.equal(core.cleanFavourites(Array.from({length:20},(_,n)=>({symbol:`TICK${n}`,name:`Company ${n}`}))).length,12);
});
test('finance currency directory creates distinct directed pairs and navigation points to the page',()=>{
  assert.equal(new Set(core.currencies.map(c=>c[0])).size,core.currencies.length);
  for(const [a] of core.currencies) for(const [b] of core.currencies) if(a!==b) assert.equal(core.search(`${a}/${b}`)[0].symbol,`FX_IDC:${a}${b}`);
  assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/href="\/finance.html"[^>]*>[\s\S]*?<span>Finance<\/span>/);
  assert.match(fs.readFileSync(path.join(root,'links.html'),'utf8'),/href="finance.html"/);
});
