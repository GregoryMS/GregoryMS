(() => {
  'use strict';
  const panel=document.getElementById('financeCalculator');
  const toggle=document.getElementById('calculatorToggle');
  if(!panel || !toggle) return;
  const handle=document.getElementById('calculatorHandle');
  const display=document.getElementById('calculatorDisplay');
  const expression=document.getElementById('calculatorExpression');
  const keys=Array.from(panel.querySelectorAll('[data-calc]'));
  const modeSwitch=document.getElementById('calculatorGraphingSwitch');
  const basic=document.getElementById('calculatorBasic');
  const graph=document.getElementById('calculatorGraph');
  const graphFrame=document.getElementById('calculatorGraphFrame');
  const resizeHandle=document.getElementById('calculatorResize');
  const symbols={'+':'+','-':'−','*':'×','/':'÷'};
  let entry='0',stored=null,operator=null,waiting=false,overwrite=false,repeat=null,error=false;
  let position=null,drag=null,resizing=null,graphing=false;
  const defaults={standard:{width:304,height:520},graphing:{width:720,height:640}};
  const sizes={standard:{...defaults.standard},graphing:{...defaults.graphing}};
  const mode=()=>graphing ? 'graphing' : 'standard';

  function format(value) {
    const [integer,fraction]=String(value).split('.');
    if(/[eE]/.test(value)) return String(value);
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined ? '' : '.'+fraction);
  }
  function render() {
    const text=error ? 'Error' : format(entry);
    display.textContent=text;
    display.classList.toggle('is-long',text.length>12);
    for(const key of keys) if(symbols[key.dataset.calc]) key.setAttribute('aria-pressed',String(operator===key.dataset.calc && waiting));
  }
  function clear() {
    entry='0'; stored=null; operator=null; waiting=false; overwrite=false; repeat=null; error=false;
    expression.textContent='';
  }
  function result(value) {
    if(!Number.isFinite(value)) {
      clear(); error=true; expression.textContent='Result is too large';
      return false;
    }
    // Keep ordinary decimal sums readable, including 0.1 + 0.2.
    entry=String(Number(value.toPrecision(15)));
    return true;
  }
  function calculate(left,op,right) {
    if(op==='/' && right===0) {
      clear(); error=true; expression.textContent='Cannot divide by zero';
      return false;
    }
    return result(op==='+' ? left+right : op==='-' ? left-right : op==='*' ? left*right : left/right);
  }
  function startEntry() {
    if(error || overwrite) clear();
    if(waiting) { entry='0'; waiting=false; }
  }
  function act(action) {
    if(/^\d$/.test(action) || action==='.') {
      startEntry();
      if(action==='.') {
        if(!entry.includes('.') && !/[eE]/.test(entry)) entry+='.';
      } else if(entry.replace(/[-.]/g,'').length<15 && !/[eE]/.test(entry)) {
        entry=entry==='0' ? action : entry==='-0' ? '-'+action : entry+action;
      }
    } else if(action==='clear') {
      clear();
    } else if(action==='backspace') {
      if(error) clear();
      else if(!waiting && !overwrite) {
        entry=/[eE]/.test(entry) ? '0' : entry.slice(0,-1);
        if(!entry || entry==='-') entry='0';
      }
    } else if(action==='sign') {
      if(error) clear();
      if(waiting) { entry='0'; waiting=false; }
      if(overwrite) { overwrite=false; repeat=null; expression.textContent=''; }
      entry=entry.startsWith('-') ? entry.slice(1) : '-'+entry;
    } else if(action==='percent') {
      if(!error) {
        const value=Number(entry)/100;
        const relative=stored!==null && (operator==='+' || operator==='-');
        if(result(relative ? stored*value : value)) {
          waiting=false;
          if(overwrite) { repeat=null; expression.textContent=''; }
          overwrite=false;
        }
      }
    } else if(symbols[action]) {
      if(error) return;
      if(operator && !waiting && !calculate(stored,operator,Number(entry))) { render(); return; }
      stored=Number(entry); operator=action; waiting=true; overwrite=false; repeat=null;
      expression.textContent=`${format(entry)} ${symbols[action]}`;
    } else if(action==='equals') {
      if(error) return;
      const op=operator || repeat?.operator;
      if(op) {
        const left=operator ? stored : Number(entry);
        const right=operator ? Number(entry) : repeat.value;
        if(calculate(left,op,right)) {
          expression.textContent=`${format(left)} ${symbols[op]} ${format(right)} =`;
          repeat={operator:op,value:right}; stored=null; operator=null; waiting=false; overwrite=true;
        }
      }
    }
    render();
  }

  function viewport() {
    const view=window.visualViewport;
    return {left:view?.offsetLeft || 0,top:view?.offsetTop || 0,width:view?.width || window.innerWidth,height:view?.height || window.innerHeight};
  }
  function setSize(width,height,remember=false) {
    const view=viewport(),availableWidth=Math.max(0,view.width-24),availableHeight=Math.max(0,view.height-24);
    const w=Math.max(Math.min(280,availableWidth),Math.min(width,availableWidth));
    const h=Math.max(Math.min(320,availableHeight),Math.min(height,availableHeight));
    panel.style.width=w+'px'; panel.style.height=h+'px';
    if(remember) sizes[mode()]={width:w,height:h};
  }
  function place(left,top) {
    const view=viewport(),gap=12;
    panel.style.maxWidth=Math.max(0,view.width-gap*2)+'px';
    panel.style.maxHeight=Math.max(0,view.height-gap*2)+'px';
    const rect=panel.getBoundingClientRect();
    const x=Math.max(view.left+gap,Math.min(left,view.left+view.width-rect.width-gap));
    const y=Math.max(view.top+gap,Math.min(top,view.top+view.height-rect.height-gap));
    panel.style.left=x+'px'; panel.style.top=y+'px'; panel.style.right='auto';
    position={left:x,top:y};
  }
  function resetPosition() {
    setSize(sizes[mode()].width,sizes[mode()].height);
    const view=viewport(),rect=panel.getBoundingClientRect();
    place(view.left+(view.width-rect.width)/2,view.top+Math.min(100,(view.height-rect.height)/2));
  }
  function keepVisible() {
    if(panel.hidden) return;
    setSize(sizes[mode()].width,sizes[mode()].height);
    if(position) place(position.left,position.top);
  }
  function stopDrag() {
    if(!drag) return;
    const id=drag.id;
    drag=null;
    panel.classList.remove('is-dragging');
    if(handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  function close() {
    stopDrag(); stopResize(); panel.hidden=true; toggle.setAttribute('aria-expanded','false'); toggle.focus({preventScroll:true});
  }
  function stopResize() {
    if(!resizing) return;
    const id=resizing.id; resizing=null;
    panel.classList.remove('is-resizing');
    if(resizeHandle.hasPointerCapture(id)) resizeHandle.releasePointerCapture(id);
  }
  modeSwitch.addEventListener('click',()=>{
    stopDrag(); stopResize();
    const before=panel.getBoundingClientRect();
    graphing=!graphing; modeSwitch.setAttribute('aria-checked',String(graphing));
    basic.hidden=graphing; graph.hidden=!graphing;
    document.getElementById('calculatorTitle').textContent=graphing ? 'Graphing calculator' : 'Calculator';
    setSize(sizes[mode()].width,sizes[mode()].height);
    const after=panel.getBoundingClientRect();
    place(before.left+(before.width-after.width)/2,before.top);
    if(graphing && !graphFrame.getAttribute('src')) graphFrame.setAttribute('src','assets/finance-graph.html?v=20261029-graphing-resize');
  });
  toggle.addEventListener('click',()=>{
    if(!panel.hidden) { close(); return; }
    panel.hidden=false; toggle.setAttribute('aria-expanded','true');
    if(position) keepVisible(); else resetPosition();
    panel.focus({preventScroll:true});
  });
  document.getElementById('calculatorClose').addEventListener('click',close);
  for(const key of keys) key.addEventListener('click',()=>act(key.dataset.calc));
  panel.addEventListener('keydown',event=>{
    if(event.ctrlKey || event.metaKey || event.altKey) return;
    if(event.key==='Escape') { event.preventDefault(); close(); return; }
    if(graphing) return;
    if(event.key==='Enter' && event.target.closest('button')) return;
    const action=/^[0-9.+\-*/]$/.test(event.key) ? event.key : ({Enter:'equals','=':'equals','%':'percent',Backspace:'backspace',Delete:'clear',c:'clear',C:'clear',Decimal:'.'})[event.key];
    if(action) { event.preventDefault(); act(action); }
  });
  handle.addEventListener('pointerdown',event=>{
    if(!event.isPrimary || event.button!==0) return;
    stopResize();
    event.preventDefault(); handle.focus({preventScroll:true});
    const rect=panel.getBoundingClientRect();
    drag={id:event.pointerId,x:event.clientX-rect.left,y:event.clientY-rect.top};
    handle.setPointerCapture(event.pointerId); panel.classList.add('is-dragging');
  });
  handle.addEventListener('pointermove',event=>{
    if(drag?.id!==event.pointerId) return;
    event.preventDefault(); place(event.clientX-drag.x,event.clientY-drag.y);
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(type,event=>{
    if(drag?.id===event.pointerId) stopDrag();
  });
  handle.addEventListener('keydown',event=>{
    const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(event.ctrlKey || event.metaKey || event.altKey) return;
    if(event.key==='Home') { event.preventDefault(); resetPosition(); }
    else if(moves[event.key]) {
      event.preventDefault();
      const step=event.shiftKey ? 48 : 16,rect=panel.getBoundingClientRect(),[x,y]=moves[event.key];
      place(rect.left+x*step,rect.top+y*step);
    }
  });
  resizeHandle.addEventListener('pointerdown',event=>{
    if(!event.isPrimary || event.button!==0) return;
    event.preventDefault(); stopDrag(); resizeHandle.focus({preventScroll:true});
    const rect=panel.getBoundingClientRect();
    resizing={id:event.pointerId,x:event.clientX,y:event.clientY,width:rect.width,height:rect.height,left:rect.left,top:rect.top};
    resizeHandle.setPointerCapture(event.pointerId); panel.classList.add('is-resizing');
  });
  resizeHandle.addEventListener('pointermove',event=>{
    if(resizing?.id!==event.pointerId) return;
    event.preventDefault();
    setSize(resizing.width+event.clientX-resizing.x,resizing.height+event.clientY-resizing.y,true);
    place(resizing.left,resizing.top);
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture']) resizeHandle.addEventListener(type,event=>{
    if(resizing?.id===event.pointerId) stopResize();
  });
  resizeHandle.addEventListener('keydown',event=>{
    if(event.ctrlKey || event.metaKey || event.altKey) return;
    const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(event.key==='Home') {
      event.preventDefault(); setSize(defaults[mode()].width,defaults[mode()].height,true); keepVisible();
    } else if(moves[event.key]) {
      event.preventDefault();
      const rect=panel.getBoundingClientRect(),[x,y]=moves[event.key],step=event.shiftKey ? 48 : 16;
      setSize(rect.width+x*step,rect.height+y*step,true); keepVisible();
    }
  });
  window.addEventListener('message',event=>{
    if(event.origin===window.location.origin && event.source===graphFrame.contentWindow && event.data?.type==='gregle-calculator-close' && !panel.hidden) close();
  });
  window.addEventListener('blur',()=>{ stopDrag(); stopResize(); });
  window.addEventListener('resize',keepVisible);
  window.visualViewport?.addEventListener('resize',keepVisible);
  window.visualViewport?.addEventListener('scroll',keepVisible);
  if(typeof ResizeObserver!=='undefined') new ResizeObserver(keepVisible).observe(panel);
  render(); toggle.hidden=false;
})();
