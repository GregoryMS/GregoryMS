const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'finance.html'),'utf8');

function calculator({width=1200,height=900,visual=null}={}) {
  let focused=null;
  class Element {
    constructor(tag='div') { this.tagName=tag.toUpperCase(); this.listeners={}; this.attrs={}; this.style={}; this.dataset={}; this.hidden=false; this.textContent=''; this.classes=new Set(); this.captures=new Set(); this.classList={toggle:(name,on)=>on ? this.classes.add(name) : this.classes.delete(name),add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)}; }
    setAttribute(name,value) { this.attrs[name]=String(value); }
    getAttribute(name) { return this.attrs[name]; }
    addEventListener(type,fn) { (this.listeners[type]??=[]).push(fn); }
    fire(type,extra={}) { const event={target:this,preventDefault(){this.prevented=true;},...extra}; for(const fn of this.listeners[type]||[]) fn(event); return event; }
    closest(selector) { return selector==='button' && this.tagName==='BUTTON' ? this : null; }
    focus(options) { focused=this; this.focusOptions=options; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); this.fire('lostpointercapture',{pointerId:id}); }
    getBoundingClientRect() {
      const left=parseFloat(this.style.left)||0,top=parseFloat(this.style.top)||0;
      const width=Math.min(304,window.innerWidth-24,parseFloat(this.style.maxWidth)||Infinity);
      const height=Math.min(469,window.innerHeight-24,parseFloat(this.style.maxHeight)||Infinity);
      return {left,top,width,height,right:left+width,bottom:top+height};
    }
  }
  const window=new Element(); window.innerWidth=width; window.innerHeight=height;
  if(visual) window.visualViewport=Object.assign(new Element(),visual);
  const nodes={};
  for(const [,tag,attrs,id] of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node=nodes[id]=new Element(tag); node.hidden=/\bhidden\b/.test(attrs);
    for(const [,key,value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) node.attrs[key]=value;
  }
  const keys=Array.from(html.matchAll(/<button\b([^>]*\bdata-calc="([^"]+)"[^>]*)>/g),([,attrs,action])=>{
    const node=new Element('button'); node.dataset.calc=action;
    for(const [,key,value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) node.attrs[key]=value;
    return node;
  });
  const panel=nodes.financeCalculator; panel.querySelectorAll=()=>keys;
  const document={getElementById:id=>nodes[id]};
  const context=vm.createContext({document,window,ResizeObserver:class { constructor(callback){this.callback=callback;} observe(){this.callback();} }});
  vm.runInContext(fs.readFileSync(path.join(root,'assets/finance-calculator.js'),'utf8'),context);
  const click=action=>{ const key=keys.find(key=>key.dataset.calc===action); assert(key,action); key.fire('click'); };
  return {nodes,keys,window,panel,click,read:()=>nodes.calculatorDisplay.textContent,focused:()=>focused,
    open:()=>nodes.calculatorToggle.fire('click'),
    type:text=>{ for(const key of text) panel.fire('keydown',{key}); },
    key:(key,extra={})=>panel.fire('keydown',{key,...extra})};
}

test('calculator opens in the page without a backdrop or focus trap and preserves a calculation when reopened',()=>{
  const p=calculator();
  assert.equal(p.panel.hidden,true); assert.equal(p.nodes.calculatorToggle.hidden,false);
  p.open(); assert.equal(p.panel.hidden,false); assert.equal(p.focused(),p.panel);
  assert.equal(p.nodes.calculatorToggle.attrs['aria-expanded'],'true');
  assert.equal(p.panel.attrs.role,'dialog'); assert.equal(p.panel.attrs['aria-modal'],undefined);
  assert.equal(p.key('Tab').prevented,undefined);
  p.type('42'); const position={...p.panel.style};
  p.nodes.calculatorClose.fire('click'); assert.equal(p.panel.hidden,true); assert.equal(p.focused(),p.nodes.calculatorToggle);
  p.open(); assert.equal(p.read(),'42'); assert.deepEqual(p.panel.style,position);
  p.key('Escape'); assert.equal(p.panel.hidden,true); assert.equal(p.nodes.calculatorToggle.attrs['aria-expanded'],'false');
  p.open(); p.open(); assert.equal(p.panel.hidden,true);
});

test('keypad and keyboard support decimals, signs, chaining, repeated equals and fresh entries',()=>{
  const p=calculator(); p.open();
  for(const action of ['0','.','1','+','0','.','2','equals']) p.click(action);
  assert.equal(p.read(),'0.3');
  p.click('equals'); assert.equal(p.read(),'0.5');
  p.type('12*3-6/2='); assert.equal(p.read(),'15');
  p.click('clear'); p.type('8'); p.click('sign'); p.type('*2='); assert.equal(p.read(),'−16'.replace('−','-'));
  p.type('7+*2='); assert.equal(p.read(),'14');
  p.click('clear'); p.type('2+'); p.click('sign'); p.type('3='); assert.equal(p.read(),'-1');
  p.click('clear'); p.type('5'); p.key('Enter'); assert.equal(p.read(),'5');
  assert.equal(p.key('Enter',{target:p.keys.find(k=>k.dataset.calc==='5')}).prevented,undefined);
});

test('percentage calculations support finance markups, discounts and multiplicative percentages',()=>{
  const p=calculator(); p.open();
  for(const [input,expected] of [['200+10%=','220'],['200-10%=','180'],['200*10%=','20'],['200/10%=','2,000'],['50%','0.5'],['0+10%=','0']]) {
    p.click('clear'); p.type(input); assert.equal(p.read(),expected,input);
  }
});

test('clearing, correction and error recovery do not leave stale operations',()=>{
  const p=calculator(); p.open();
  p.type('123'); p.key('Backspace'); assert.equal(p.read(),'12');
  p.key('Delete'); assert.equal(p.read(),'0'); p.type('4..5'); assert.equal(p.read(),'4.5');
  p.key('c'); p.type('12/0='); assert.equal(p.read(),'Error'); assert.match(p.nodes.calculatorExpression.textContent,/divide by zero/);
  p.type('2+3='); assert.equal(p.read(),'5');
  p.key('C'); p.type('0/0='); assert.equal(p.read(),'Error'); p.key('Backspace'); assert.equal(p.read(),'0');
  p.type('9'); p.click('sign'); p.key('Backspace'); assert.equal(p.read(),'0');
  p.type('12345678901234567890'); assert.equal(p.read().replaceAll(',','').length,15); assert(p.nodes.calculatorDisplay.classes.has('is-long'));
  assert.equal(p.key('x').prevented,undefined);
  assert.equal(p.key('1',{ctrlKey:true}).prevented,undefined);
});

test('pending operations are indicated and division by zero also recovers after a chained operation',()=>{
  const p=calculator(); p.open(); p.type('2+');
  const add=p.keys.find(key=>key.dataset.calc==='+'); assert.equal(add.attrs['aria-pressed'],'true');
  p.type('3'); assert.equal(add.attrs['aria-pressed'],'false');
  p.key('Delete'); p.type('12/0+'); assert.equal(p.read(),'Error');
  p.click('clear'); p.type('9*'); p.type('999999999999999=');
  for(let i=0;i<24;i++) p.click('equals');
  assert.equal(p.read(),'Error'); assert.match(p.nodes.calculatorExpression.textContent,/too large/);
  p.type('1'); assert.equal(p.read(),'1');
});

for(const pointerType of ['mouse','touch','pen']) test(`${pointerType} dragging captures the pointer, stays onscreen and releases on cancellation`,()=>{
  const p=calculator(); p.open(); const handle=p.nodes.calculatorHandle;
  const start=p.panel.getBoundingClientRect();
  const pointer={pointerId:1,pointerType,isPrimary:true,button:0,clientX:start.left+30,clientY:start.top+20};
  handle.fire('pointerdown',pointer); assert(handle.hasPointerCapture(1)); assert(p.panel.classes.has('is-dragging'));
  handle.fire('pointermove',{...pointer,pointerId:2,clientX:80,clientY:90}); assert.equal(p.panel.getBoundingClientRect().left,start.left);
  handle.fire('pointermove',{...pointer,clientX:80,clientY:90});
  assert.equal(p.panel.getBoundingClientRect().left,50); assert.equal(p.panel.getBoundingClientRect().top,70);
  handle.fire('pointermove',{...pointer,clientX:-200,clientY:-200}); assert.equal(p.panel.getBoundingClientRect().left,12); assert.equal(p.panel.getBoundingClientRect().top,12);
  handle.fire('pointermove',{...pointer,clientX:3000,clientY:3000});
  const end=p.panel.getBoundingClientRect(); assert.equal(end.right,1188); assert.equal(end.bottom,888);
  handle.fire('pointercancel',pointer); assert(!handle.hasPointerCapture(1)); assert(!p.panel.classes.has('is-dragging'));
  handle.fire('pointermove',{...pointer,clientX:80,clientY:90}); assert.equal(p.panel.getBoundingClientRect().left,end.left);
});

test('secondary mouse clicks and nonprimary touches do not begin a drag; closing releases capture',()=>{
  const p=calculator(); p.open(); const handle=p.nodes.calculatorHandle;
  handle.fire('pointerdown',{pointerId:1,isPrimary:true,button:2}); assert(!handle.hasPointerCapture(1));
  handle.fire('pointerdown',{pointerId:2,isPrimary:false,button:0}); assert(!handle.hasPointerCapture(2));
  handle.fire('pointerdown',{pointerId:3,isPrimary:true,button:0,clientX:50,clientY:50});
  p.nodes.calculatorClose.fire('click'); assert(!handle.hasPointerCapture(3)); assert(!p.panel.classes.has('is-dragging'));
});

test('keyboard movement, smaller screens, rotation and visual viewport changes keep controls reachable',()=>{
  const p=calculator(); p.open(); const handle=p.nodes.calculatorHandle;
  let rect=p.panel.getBoundingClientRect(); handle.fire('keydown',{key:'ArrowLeft'}); assert.equal(p.panel.getBoundingClientRect().left,rect.left-16);
  rect=p.panel.getBoundingClientRect(); handle.fire('keydown',{key:'ArrowUp',shiftKey:true}); assert.equal(p.panel.getBoundingClientRect().top,rect.top-48);
  handle.fire('keydown',{key:'Home'}); assert.equal(p.panel.getBoundingClientRect().right,1176);
  p.window.innerWidth=320; p.window.innerHeight=568; p.window.fire('resize');
  rect=p.panel.getBoundingClientRect(); assert(rect.left>=12); assert(rect.right<=308); assert(rect.bottom<=556);
  p.window.innerWidth=568; p.window.innerHeight=320; p.window.fire('resize');
  rect=p.panel.getBoundingClientRect(); assert(rect.top>=12); assert(rect.bottom<=308);
  const zoom=calculator({visual:{width:240,height:380,offsetLeft:90,offsetTop:100}}); zoom.open();
  rect=zoom.panel.getBoundingClientRect(); assert(rect.left>=102); assert(rect.right<=318); assert(rect.top>=112); assert(rect.bottom<=468);
  zoom.window.visualViewport.offsetTop=180; zoom.window.visualViewport.fire('scroll'); assert(zoom.panel.getBoundingClientRect().top>=192);
});

test('calculator uses local arithmetic, scoped keyboard events and fixed-position theme surfaces',()=>{
  const source=fs.readFileSync(path.join(root,'assets/finance-calculator.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'assets/finance.css'),'utf8');
  assert.doesNotMatch(source,/\beval\s*\(|new Function|window\.open|fetch\s*\(|document\.addEventListener/);
  assert.match(css,/\.finance-calculator\s*\{[^}]*position:fixed/);
  assert.match(css,/\.calculator-handle\s*\{[^}]*touch-action:none/);
  assert.match(css,/\.finance-calculator\s*\{[^}]*background:var\(--panel\)/);
  assert.match(html,/assets\/finance-calculator\.js\?v=20261029-floating-calculator/);
});
