const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');

// DOM and provider doubles exercise the page's own interactions without fetching quotes.
function page({url='https://finance.gregle.uk/',saved=null,blocked=false,dark=false}={}) {
  let focused;
  class Element {
    constructor(tag='div') { this.tagName=tag.toUpperCase(); this.children=[]; this.attrs={}; this.listeners={}; this.dataset={}; this.className=''; this.hidden=false; this.value=''; this._text=''; }
    get classList() { return {contains:name=>this.className.split(' ').includes(name),toggle:(name,on)=>{ const set=new Set(this.className.split(' ').filter(Boolean)); const enabled=on===undefined ? !set.has(name) : on; if(enabled) set.add(name); else set.delete(name); this.className=[...set].join(' '); return enabled; }}; }
    set textContent(value) { this._text=value; this.replaceChildren(); }
    get textContent() { return this._text+this.children.map(n=>n.textContent).join(''); }
    setAttribute(key,value) { this.attrs[key]=String(value); }
    getAttribute(key) { return this.attrs[key]; }
    addEventListener(type,fn) { (this.listeners[type]??=[]).push(fn); }
    fire(type,extra={}) { const event={target:this,preventDefault(){this.prevented=true;},...extra}; for(const fn of this.listeners[type]||[]) fn(event); return event; }
    append(...nodes) { for(const node of nodes) { if(node.parentElement) node.parentElement.children=node.parentElement.children.filter(n=>n!==node); node.parentElement=this; this.children.push(node); } }
    replaceChildren(...nodes) { for(const node of this.children) node.parentElement=null; this.children=[]; this.append(...nodes); }
    replaceWith(node) { const parent=this.parentElement,index=parent.children.indexOf(this); parent.children[index]=node; node.parentElement=parent; this.parentElement=null; }
    querySelector(selector) { const match=node=>selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.tagName===selector.toUpperCase(); for(const node of this.children) { if(match(node)) return node; const result=node.querySelector(selector); if(result) return result; } return null; }
    contains(node) { return this===node || this.children.some(child=>child.contains(node)); }
    focus() { focused=this; }
    scrollIntoView() { this.scrolled=true; }
  }
  const document=new Element('document'),window=new Element('window'),nodes={};
  const html=fs.readFileSync(path.join(root,'finance.html'),'utf8');
  for(const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node=new Element(match[1]); node.id=match[3]; node.className=match[2].match(/\bclass="([^"]+)"/)?.[1]||'';
    node.hidden=/\bhidden\b/.test(match[2]);
    const view=match[2].match(/data-finance-view="([^"]+)"/)?.[1]; if(view) node.dataset.financeView=view;
    nodes[node.id]=node; document.append(node);
  }
  const lookup=new Element('section'); lookup.className='lookup-panel'; document.append(lookup);
  for(const id of ['symbolForm','symbolSearch','searchResults','favouritesRow','favourites','saveStatus']) lookup.append(nodes[id]);
  const tabs=['marketsTab','exploreTab','currenciesTab'].map(id=>nodes[id]);
  document.documentElement=new Element('html');
  document.getElementById=id=>{ assert(nodes[id],`Missing page element: ${id}`); return nodes[id]; };
  document.createElement=tag=>new Element(tag);
  document.querySelectorAll=selector=>{ assert.equal(selector,'[data-finance-view]'); return tabs; };
  window.matchMedia=()=>({matches:dark});
  const location=new URL(url),timers=new Map(),observers=[];
  let timerID=0,stored=saved;
  const context=vm.createContext({document,window,location,URL,URLSearchParams,
    history:{replaceState(_state,_title,url){location.href=String(url);}},
    localStorage:{getItem(key){ if(blocked) throw Error('Storage unavailable'); return key==='gregle-finance-favourites' ? stored : null; },setItem(key,value){ if(blocked) throw Error('Storage unavailable'); if(key==='gregle-finance-favourites') stored=value; }},
    setTimeout(fn){timers.set(++timerID,fn);return timerID;},clearTimeout(id){timers.delete(id);},
    MutationObserver:class { constructor(fn){this.fn=fn;observers.push(this);} observe(target){this.target=target;} disconnect(){this.disconnected=true;} }
  });
  for(const file of ['theme.js','finance-core.js','finance.js']) vm.runInContext(fs.readFileSync(path.join(root,'assets',file),'utf8'),context);
  const script=id=>nodes[id].querySelector('script');
  return {nodes,tabs,document,window,location,timers,observers,script,config:id=>JSON.parse(script(id).textContent),focused:()=>focused,stored:()=>stored,Element};
}

test('finance initially shows only Markets and defers the other provider widgets',()=>{
  const p=page(),n=p.nodes;
  assert.equal(n.markets.hidden,false); assert.equal(n.explore.hidden,true); assert.equal(n.currencies.hidden,true);
  assert(p.script('marketWidget')); assert.equal(p.script('chartWidget'),null); assert.equal(p.script('currencyWidget'),null); assert.equal(p.script('cadTickerWidget'),null);
  assert.equal(n.financeViews.attrs.role,'tablist');
  assert.equal(p.tabs[0].attrs['aria-selected'],'true'); assert.equal(p.tabs[1].tabIndex,-1);
  for(const tab of p.tabs) { const id=tab.dataset.financeView; assert.equal(tab.attrs['aria-controls'],id); assert.equal(n[id].attrs['aria-labelledby'],tab.id); assert.equal(n[id].attrs.role,'tabpanel'); }
  assert.equal(n.baseCurrency.children.length,10); assert.equal(n.quoteCurrency.value,'CAD');
});

test('view switches preserve existing widgets and load currencies only when opened',()=>{
  const p=page(),n=p.nodes,market=n.marketWidget.children[0];
  n.exploreTab.fire('click'); const chart=n.chartWidget.children[0];
  assert.equal(n.explore.hidden,false); assert.equal(p.location.hash,'#explore');
  n.marketsTab.fire('click'); assert.equal(n.marketWidget.children[0],market);
  n.exploreTab.fire('click'); assert.equal(n.chartWidget.children[0],chart);
  n.currenciesTab.fire('click'); assert.equal(n.currencies.hidden,false); assert(p.script('currencyWidget')); assert(p.script('cadTickerWidget'));
  assert.equal(p.config('cadTickerWidget').symbols.length,9);
  const event=n.marketsTab.fire('click',{metaKey:true}); assert.equal(event.prevented,undefined); assert.equal(n.currencies.hidden,false);
});

test('finance tabs support arrows, wraparound, Home, End, Space and fragment changes',()=>{
  const p=page(),n=p.nodes;
  n.marketsTab.fire('keydown',{key:'ArrowLeft'}); assert.equal(p.focused(),n.currenciesTab); assert.equal(n.currencies.hidden,false);
  n.currenciesTab.fire('keydown',{key:'Home'}); assert.equal(p.focused(),n.marketsTab);
  n.marketsTab.fire('keydown',{key:'ArrowRight'}); assert.equal(p.focused(),n.exploreTab);
  n.exploreTab.fire('keydown',{key:'End'}); assert.equal(p.focused(),n.currenciesTab);
  n.exploreTab.fire('keydown',{key:' '}); assert.equal(n.explore.hidden,false);
  p.location.hash='currencies'; p.window.fire('hashchange'); assert.equal(n.currencies.hidden,false);
  p.location.hash='unrelated'; p.window.fire('hashchange'); assert.equal(n.currencies.hidden,false);
});

test('symbol deep links open Explore and explicit view fragments take priority',()=>{
  for(const query of ['symbol=TSX%3ARY','tvwidgetsymbol=TSX%3ARY']) {
    const p=page({url:`https://finance.gregle.uk/?${query}`});
    assert.equal(p.nodes.explore.hidden,false); assert.equal(p.config('chartWidget').symbol,'TSX:RY'); assert.equal(p.script('marketWidget'),null);
  }
  const p=page({url:'https://finance.gregle.uk/?symbol=TSX%3ARY#currencies'});
  assert.equal(p.nodes.currencies.hidden,false); assert.equal(p.script('chartWidget'),null);
  p.nodes.exploreTab.fire('click'); assert.equal(p.config('chartWidget').symbol,'TSX:RY');
  const unsafe=page({url:'https://finance.gregle.uk/?symbol=%3Cscript%3E'});
  assert.equal(unsafe.config('chartWidget').symbol,'NASDAQ:AAPL');
});

test('search, favourite saving and selecting a symbol open the full chart without losing saved symbols',()=>{
  const p=page(),n=p.nodes;
  n.symbolSearch.value='NVIDIA'; n.symbolSearch.fire('input');
  assert.equal(n.searchResults.hidden,false); assert.equal(n.searchResults.children.length,1);
  n.searchResults.children[0].children[1].fire('click');
  assert.equal(JSON.parse(p.stored()).length,5); assert.equal(n.searchResults.children[0].children[1].disabled,true);
  assert.equal(p.focused(),n.searchResults.children[0].children[0]);
  n.searchResults.children[0].children[0].fire('click');
  assert.equal(n.explore.hidden,false); assert.equal(p.config('chartWidget').symbol,'NASDAQ:NVDA');
  assert.equal(p.location.searchParams.get('symbol'),'NASDAQ:NVDA'); assert.equal(p.location.hash,'#explore');
  assert.equal(n.symbolSearch.value,''); assert.equal(n.searchResults.hidden,true); assert.equal(p.focused(),n.exploreTitle); assert.equal(n.financeViews.scrolled,true);
  n.favourites.children[1].children[0].fire('click'); assert.equal(p.config('chartWidget').symbol,'NASDAQ:MSFT');
});

test('search submission, Escape, outside clicks and leaving the search dismiss results',()=>{
  const p=page(),n=p.nodes;
  n.symbolSearch.value='GBP/CAD'; n.symbolSearch.fire('input'); n.symbolSearch.fire('keydown',{key:'Escape'}); assert.equal(n.searchResults.hidden,true);
  n.symbolSearch.fire('input'); p.document.fire('click',{target:n.symbolSearch}); assert.equal(n.searchResults.hidden,false);
  p.document.fire('focusin',{target:n.marketsTab}); assert.equal(n.searchResults.hidden,true);
  n.symbolSearch.fire('input'); p.document.fire('click',{target:n.marketsTab}); assert.equal(n.searchResults.hidden,true);
  n.symbolForm.fire('submit'); assert.equal(p.config('chartWidget').symbol,'FX_IDC:GBPCAD');
});

test('editing favourites preserves storage and keyboard focus, including the last removal',()=>{
  const p=page({saved:'[{"symbol":"NASDAQ:AAPL","name":"Apple"}]'}),n=p.nodes;
  n.editFavourites.fire('click'); assert(n.favouritesRow.classList.contains('is-editing')); assert.equal(n.editFavourites.attrs['aria-pressed'],'true');
  n.favourites.children[0].children[1].fire('click');
  assert.equal(p.stored(),'[]'); assert.equal(p.focused(),n.editFavourites); assert.match(n.favourites.textContent,/Search above/);
  n.editFavourites.fire('click'); assert.equal(n.favouritesRow.classList.contains('is-editing'),false);
});

test('currency form prevents identical pairs and opens the selected directed pair',()=>{
  const p=page(),n=p.nodes;
  n.baseCurrency.value='CAD'; n.baseCurrency.fire('change'); assert.equal(n.viewPair.disabled,true);
  n.pairForm.fire('submit'); assert.equal(p.script('chartWidget'),null);
  n.baseCurrency.value='EUR'; n.baseCurrency.fire('change'); assert.equal(n.viewPair.disabled,false);
  n.pairForm.fire('submit'); assert.equal(p.config('chartWidget').symbol,'FX_IDC:EURCAD'); assert.equal(n.explore.hidden,false);
});

test('theme changes refresh only the visible view and later views use the new theme',()=>{
  const p=page(),n=p.nodes;
  n.exploreTab.fire('click'); n.currenciesTab.fire('click'); n.marketsTab.fire('click');
  const oldObservers=[...p.observers]; n.themeToggle.fire('click');
  assert.equal(p.config('marketWidget').colorTheme,'dark'); assert.equal(p.script('chartWidget'),null); assert.equal(p.script('currencyWidget'),null); assert.equal(p.script('cadTickerWidget'),null);
  assert(oldObservers.every(observer=>observer.disconnected)); assert.equal(p.timers.size,1);
  n.exploreTab.fire('click'); assert.equal(p.config('chartWidget').theme,'dark'); assert.equal(p.config('chartWidget').backgroundColor,'#23232c');
  n.currenciesTab.fire('click'); assert.equal(p.config('currencyWidget').colorTheme,'dark');
});

test('provider errors and timeouts retain retry controls and direct fallback links',()=>{
  const p=page(),n=p.nodes,old=p.script('marketWidget');
  old.onerror(); const error=n.marketWidget.children[0];
  assert.equal(error.className,'widget-error'); assert.match(error.textContent,/could not load/); assert.equal(error.children[2].href,'https://www.tradingview.com/markets/');
  error.children[1].fire('click'); assert(p.script('marketWidget')); assert.notEqual(p.script('marketWidget'),old);
  [...p.timers.values()][0](); assert.equal(n.marketWidget.children[0].className,'widget-error');
});

test('ticker frames receive accessible titles and dispose their loading timer',()=>{
  const p=page({url:'https://finance.gregle.uk/#currencies'}),n=p.nodes;
  const observer=p.observers.find(o=>o.target===n.cadTickerWidget.children[0]);
  const frame=new p.Element('iframe'); observer.target.append(frame); observer.fn();
  assert.equal(frame.title,'CAD currency ticker'); assert.equal(frame.parentElement.className,'cad-ticker-frame'); assert.equal(observer.disconnected,true); assert.equal(p.timers.size,1);
});

test('unavailable storage still permits favourites for the visit and the twelve-symbol limit is enforced',()=>{
  const p=page({blocked:true}),n=p.nodes;
  n.symbolSearch.value='NVIDIA'; n.symbolSearch.fire('input'); n.searchResults.children[0].children[1].fire('click');
  assert.equal(n.favourites.children.length,5); assert.match(n.saveStatus.textContent,/cannot save/);
  const saved=JSON.stringify(Array.from({length:12},(_,i)=>({symbol:`TICK${i}`,name:`Company ${i}`})));
  const full=page({saved}); full.nodes.symbolSearch.value='NVIDIA'; full.nodes.symbolSearch.fire('input'); full.nodes.searchResults.children[0].children[1].fire('click');
  assert.equal(full.nodes.favourites.children.length,12); assert.match(full.nodes.saveStatus.textContent,/Use Edit/);
  assert.equal(page({saved:'{broken'}).nodes.favourites.children.length,4);
});
