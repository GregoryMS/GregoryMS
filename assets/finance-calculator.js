(() => {
  'use strict';
  const panel=document.getElementById('financeCalculator');
  const toggle=document.getElementById('calculatorToggle');
  if(!panel || !toggle) return;
  const handle=document.getElementById('calculatorHandle');
  const display=document.getElementById('calculatorDisplay');
  const expression=document.getElementById('calculatorExpression');
  const keys=Array.from(panel.querySelectorAll('[data-calc]'));
  const symbols={'+':'+','-':'−','*':'×','/':'÷'};
  let entry='0',stored=null,operator=null,waiting=false,overwrite=false,repeat=null,error=false;
  let position=null,drag=null;

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
    const view=viewport(),rect=panel.getBoundingClientRect();
    place(view.left+view.width-rect.width-24,view.top+view.height-rect.height-24);
  }
  function keepVisible() {
    if(!panel.hidden && position) place(position.left,position.top);
  }
  function stopDrag() {
    if(!drag) return;
    const id=drag.id;
    drag=null;
    panel.classList.remove('is-dragging');
    if(handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  function close() {
    stopDrag(); panel.hidden=true; toggle.setAttribute('aria-expanded','false'); toggle.focus({preventScroll:true});
  }
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
    if(event.key==='Enter' && event.target.closest('button')) return;
    const action=/^[0-9.+\-*/]$/.test(event.key) ? event.key : ({Enter:'equals','=':'equals','%':'percent',Backspace:'backspace',Delete:'clear',c:'clear',C:'clear',Decimal:'.'})[event.key];
    if(action) { event.preventDefault(); act(action); }
  });
  handle.addEventListener('pointerdown',event=>{
    if(!event.isPrimary || event.button!==0) return;
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
  window.addEventListener('resize',keepVisible);
  window.visualViewport?.addEventListener('resize',keepVisible);
  window.visualViewport?.addEventListener('scroll',keepVisible);
  if(typeof ResizeObserver!=='undefined') new ResizeObserver(keepVisible).observe(panel);
  render(); toggle.hidden=false;
})();
