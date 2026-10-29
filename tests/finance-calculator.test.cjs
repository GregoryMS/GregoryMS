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
      const width=Math.min(parseFloat(this.style.width)||304,window.innerWidth-24,parseFloat(this.style.maxWidth)||Infinity);
      const height=Math.min(parseFloat(this.style.height)||520,window.innerHeight-24,parseFloat(this.style.maxHeight)||Infinity);
      return {left,top,width,height,right:left+width,bottom:top+height};
    }
  }
  const window=new Element(); window.innerWidth=width; window.innerHeight=height; window.location={origin:'https://finance.gregle.uk'};
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
  nodes.calculatorGraphFrame.contentWindow={};
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
  handle.fire('keydown',{key:'Home'}); rect=p.panel.getBoundingClientRect(); assert.equal(rect.left,(1200-rect.width)/2);
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
  assert.match(html,/assets\/finance-calculator\.js\?v=20261029-graphing-resize/);
});

test('graphing switch lazily loads a full graphing app and preserves both modes across switching and closing',()=>{
  const p=calculator(); p.open(); p.type('42');
  const frame=p.nodes.calculatorGraphFrame,modeSwitch=p.nodes.calculatorGraphingSwitch;
  assert.equal(frame.getAttribute('src'),undefined); assert.equal(p.nodes.calculatorGraph.hidden,true);
  modeSwitch.fire('click');
  assert.equal(modeSwitch.attrs.role,'switch'); assert.equal(modeSwitch.attrs['aria-checked'],'true');
  assert.equal(p.nodes.calculatorBasic.hidden,true); assert.equal(p.nodes.calculatorGraph.hidden,false);
  assert.equal(p.nodes.calculatorTitle.textContent,'Graphing calculator');
  assert.equal(p.panel.getBoundingClientRect().width,720); assert.equal(p.panel.getBoundingClientRect().height,640);
  const src=frame.getAttribute('src'); assert.match(src,/^assets\/finance-graph\.html\?/);
  frame.graphState='y=x^2';
  assert.equal(p.key('3').prevented,undefined); assert.equal(p.key('Backspace').prevented,undefined); assert.equal(p.read(),'42');
  modeSwitch.fire('click'); assert.equal(p.read(),'42'); assert.equal(p.panel.getBoundingClientRect().width,304);
  modeSwitch.fire('click'); assert.equal(frame.getAttribute('src'),src); assert.equal(frame.graphState,'y=x^2');
  p.nodes.calculatorClose.fire('click'); p.open(); assert.equal(modeSwitch.attrs['aria-checked'],'true'); assert.equal(frame.graphState,'y=x^2');
});

for(const pointerType of ['mouse','touch','pen']) test(`${pointerType} resizing changes both dimensions, remembers each mode and stops after release`,()=>{
  const p=calculator(); p.open(); const resize=p.nodes.calculatorResize;
  const start=p.panel.getBoundingClientRect();
  const event={isPrimary:true,button:0,pointerType,pointerId:5,clientX:start.right-10,clientY:start.bottom-10};
  resize.fire('pointerdown',event); assert(resize.hasPointerCapture(5)); assert(p.panel.classes.has('is-resizing'));
  resize.fire('pointermove',{...event,pointerId:6,clientX:event.clientX+100,clientY:event.clientY+80}); assert.equal(p.panel.getBoundingClientRect().width,start.width);
  resize.fire('pointermove',{...event,clientX:event.clientX+100,clientY:event.clientY+80});
  assert.equal(p.panel.getBoundingClientRect().width,start.width+100); assert.equal(p.panel.getBoundingClientRect().height,start.height+80);
  resize.fire('pointerup',event); assert(!resize.hasPointerCapture(5)); assert(!p.panel.classes.has('is-resizing'));
  resize.fire('pointermove',{...event,clientX:1000,clientY:1000}); assert.equal(p.panel.getBoundingClientRect().width,start.width+100);
  p.nodes.calculatorGraphingSwitch.fire('click'); assert.equal(p.panel.getBoundingClientRect().width,720);
  p.nodes.calculatorGraphingSwitch.fire('click'); assert.equal(p.panel.getBoundingClientRect().width,start.width+100);
  p.nodes.calculatorClose.fire('click'); p.open(); assert.equal(p.panel.getBoundingClientRect().height,start.height+80);
});

test('resizing enforces reachable minimums, viewport limits, cancellation and blur cleanup',()=>{
  const p=calculator({width:375,height:667}); p.open(); const resize=p.nodes.calculatorResize;
  const start=p.panel.getBoundingClientRect(),event={isPrimary:true,button:0,pointerId:7,clientX:start.right,clientY:start.bottom};
  resize.fire('pointerdown',{...event,button:2}); assert(!resize.hasPointerCapture(7));
  resize.fire('pointerdown',{...event,isPrimary:false}); assert(!resize.hasPointerCapture(7));
  resize.fire('pointerdown',event); resize.fire('pointermove',{...event,clientX:-1000,clientY:-1000});
  assert.equal(p.panel.getBoundingClientRect().width,280); assert.equal(p.panel.getBoundingClientRect().height,320);
  resize.fire('pointermove',{...event,clientX:4000,clientY:4000});
  let rect=p.panel.getBoundingClientRect(); assert.equal(rect.width,351); assert.equal(rect.height,643); assert(rect.left>=12); assert(rect.right<=363); assert(rect.bottom<=655);
  resize.fire('pointercancel',event); assert(!resize.hasPointerCapture(7));
  resize.fire('pointerdown',event); p.window.fire('blur'); assert(!resize.hasPointerCapture(7)); assert(!p.panel.classes.has('is-resizing'));
  resize.fire('pointerdown',event); p.nodes.calculatorClose.fire('click'); assert(!resize.hasPointerCapture(7));
  p.open(); p.window.innerWidth=667; p.window.innerHeight=375; p.window.fire('resize');
  rect=p.panel.getBoundingClientRect(); assert(rect.bottom<=363); assert(rect.top>=12);
});

test('resize handle supports keyboard sizing and per-mode Home defaults',()=>{
  const p=calculator(); p.open(); const handle=p.nodes.calculatorResize;
  handle.fire('keydown',{key:'ArrowRight'}); assert.equal(p.panel.getBoundingClientRect().width,320);
  handle.fire('keydown',{key:'ArrowDown',shiftKey:true}); assert.equal(p.panel.getBoundingClientRect().height,568);
  handle.fire('keydown',{key:'Home'}); assert.equal(p.panel.getBoundingClientRect().width,304); assert.equal(p.panel.getBoundingClientRect().height,520);
  p.nodes.calculatorGraphingSwitch.fire('click');
  handle.fire('keydown',{key:'ArrowLeft'}); assert.equal(p.panel.getBoundingClientRect().width,704);
  handle.fire('keydown',{key:'Home'}); assert.equal(p.panel.getBoundingClientRect().width,720); assert.equal(p.panel.getBoundingClientRect().height,640);
  assert.equal(handle.fire('keydown',{key:'ArrowRight',ctrlKey:true}).prevented,undefined);
});

test('only Escape messages from the calculator iframe on this origin can close the panel',()=>{
  const p=calculator(); p.open(); const source=p.nodes.calculatorGraphFrame.contentWindow;
  const event={origin:p.window.location.origin,source,data:{type:'gregle-calculator-close'}};
  p.window.fire('message',{...event,origin:'https://example.com'}); assert.equal(p.panel.hidden,false);
  p.window.fire('message',{...event,source:{}}); assert.equal(p.panel.hidden,false);
  p.window.fire('message',{...event,data:{type:'other'}}); assert.equal(p.panel.hidden,false);
  p.window.fire('message',event); assert.equal(p.panel.hidden,true); assert.equal(p.focused(),p.nodes.calculatorToggle);
});
