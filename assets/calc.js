(() => {
  'use strict';
  const $ = id => document.getElementById(id), {evaluate, format} = window.GregleCalc;
  const input = $('expression'), output = $('result'), message = $('calcMessage');
  const popout = new URLSearchParams(window.location.search).get('popout') === '1';
  let ans = 0, completed = false, history = [], angle = 'deg', historyIndex = -1, draft = '', restored = null;
  if (popout) {
    document.documentElement.classList.add('calculator-popout');
    try {
      const state = JSON.parse(sessionStorage.getItem('gregle-calc-popout') || 'null');
      sessionStorage.removeItem('gregle-calc-popout');
      if (state && typeof state.expression === 'string' && state.expression.length <= 300) {
        restored = state; input.value = state.expression; ans = Number.isFinite(state.ans) ? state.ans : 0;
        angle = state.angle === 'rad' ? 'rad' : 'deg'; completed = state.completed === true;
      }
    } catch (_) {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem('gregle-calc-history') || '[]');
    if (Array.isArray(saved)) history = saved.filter(item => item && typeof item.expression === 'string' && item.expression.length <= 300 && Number.isFinite(item.value)).slice(0,50);
  } catch (_) {}
  const touchInput = window.matchMedia?.('(pointer: coarse)').matches === true;
  function prepareInput(field) {
    field.inputMode = 'none'; field.setAttribute('inputmode','none');
    field.readOnly = touchInput;
    if (touchInput) field.setAttribute('readonly','');
  }
  prepareInput(input);
  function handleReadonlyKey(event, edit) {
    if (!event.target.readOnly || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return false;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault(); edit('',event.key === 'Backspace' ? 'backspace' : 'delete'); return true;
    }
    if (event.key.length === 1 && /^[a-z0-9.+*/^()%!,= π√−×÷-]$/i.test(event.key)) {
      event.preventDefault(); edit(event.key); return true;
    }
    return false;
  }
  const options = () => ({angle,ans});
  const focus = () => input.focus({preventScroll:true});
  function update() {
    input.removeAttribute('aria-invalid'); message.textContent = '';
    try {output.textContent = format(completed ? ans : evaluate(input.value,options())); output.dataset.valid = 'true';}
    catch (_) {output.textContent = '…'; output.dataset.valid = 'false';}
  }
  function renderHistory() {
    const list = $('historyList'); list.replaceChildren();
    $('historyEmpty').hidden = history.length > 0; list.hidden = !history.length; $('clearHistory').disabled = !history.length;
    for (const item of history.slice().reverse()) {
      const row = document.createElement('li'), button = document.createElement('button'); button.type = 'button';
      const expression = document.createElement('span'), result = document.createElement('strong');
      expression.textContent = item.expression + (item.angle ? ` · ${item.angle.toUpperCase()}` : ''); result.textContent = '= ' + format(item.value);
      button.append(expression,result); button.title = 'Use this result';
      button.addEventListener('click', () => insert(format(item.value)));
      row.append(button); list.append(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  function insert(value, action) {
    if (completed && !action) {
      input.value = /^[+×÷*/^%!)−-]/.test(value) ? format(ans) : '';
      input.setSelectionRange(input.value.length,input.value.length);
    }
    let start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
    if (action === 'clear') {start = 0; end = input.value.length;}
    else if (action === 'backspace' && start === end) start = Math.max(0,start - 1);
    else if (action === 'delete' && start === end) end = Math.min(input.value.length,end + 1);
    if (input.value.length - (end - start) + value.length > 300) return;
    input.setRangeText(value,start,end,'end'); completed = false; historyIndex = -1;
    update(); focus();
  }
  function calculate() {
    if (!input.value.trim()) return;
    try {
      const value = evaluate(input.value,options());
      history.unshift({expression:input.value.trim(),value,angle:/sin|cos|tan/.test(input.value) ? angle : undefined}); history = history.slice(0,50);
      try {localStorage.setItem('gregle-calc-history',JSON.stringify(history));} catch (_) {}
      ans = value; completed = true; historyIndex = -1; renderHistory();
      output.textContent = format(value); output.dataset.valid = 'true'; input.removeAttribute('aria-invalid'); message.textContent = '';
      focus(); input.setSelectionRange(input.value.length,input.value.length);
    } catch (error) {
      message.textContent = error.message; input.setAttribute('aria-invalid','true'); output.textContent = '—'; output.dataset.valid = 'false'; focus();
    }
  }
  function navigate(direction) {
    if (direction === 'enter') {calculate(); return;}
    if (direction === 'up' || direction === 'down') {
      if (!history.length) return;
      if (historyIndex === -1) draft = input.value;
      historyIndex = Math.max(-1,Math.min(history.length - 1,historyIndex + (direction === 'up' ? 1 : -1)));
      input.value = historyIndex === -1 ? draft : history[historyIndex].expression;
      completed = false; input.setSelectionRange(input.value.length,input.value.length); update();
    } else {
      completed = false; const position = Math.max(0,Math.min(input.value.length,(input.selectionStart ?? input.value.length) + (direction === 'left' ? -1 : 1)));
      input.setSelectionRange(position,position);
    }
    focus();
  }
  function setAngle(value) {angle = value === 'rad' ? 'rad' : 'deg'; update();}
  $('calculatorForm').addEventListener('submit',event => {event.preventDefault(); calculate();});
  input.addEventListener('input',() => {completed = false; historyIndex = -1; update();});
  input.addEventListener('pointerdown',() => {completed = false;});
  input.addEventListener('keydown',event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter' || event.key === '=') {event.preventDefault(); calculate();}
    else if (event.key === 'Escape') {event.preventDefault(); insert('','clear');}
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {event.preventDefault(); navigate(event.key === 'ArrowUp' ? 'up' : 'down');}
    else if (handleReadonlyKey(event,insert)) return;
    else if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) completed = false;
    else if (completed && event.key.length === 1) {
      input.value = /^[+×÷*/^%!)−-]$/.test(event.key) ? format(ans) : '';
      input.setSelectionRange(input.value.length,input.value.length); completed = false;
    }
  });
  $('copyResult').addEventListener('click',async () => {
    if (output.dataset.valid !== 'true') {message.textContent = 'Finish the calculation before copying.'; return;}
    try {await navigator.clipboard.writeText(output.textContent); message.textContent = 'Result copied.';}
    catch (_) {message.textContent = 'Select the result to copy it.';}
  });
  $('clearHistory').addEventListener('click',() => {
    history = []; historyIndex = -1; try {localStorage.removeItem('gregle-calc-history');} catch (_) {} renderHistory();
  });
  const getState = () => ({expression:input.value,ans,angle,completed,screen:window.GregleCalculator?.getScreen() || 'calculate'});
  window.GregleScientific = {insert,calculate,navigate,setAngle,getState,prepareInput,handleReadonlyKey,initialScreen:restored?.screen,restoredAngle:restored?.angle};
  $('popoutCalculator').addEventListener('click',() => {
    document.dispatchEvent(new Event('gregle-calc-save-graph'));
    const state = getState(), url = new URL(window.location.href); url.searchParams.set('popout','1');
    url.searchParams.set('mode',state.screen === 'calculate' ? 'standard' : 'graph');
    const width = Math.min(560,Math.max(280,screen.availWidth - 40)), height = Math.min(1080,Math.max(400,screen.availHeight - 60));
    const left = Math.round((screen.availLeft || 0) + (screen.availWidth - width)/2), top = Math.round((screen.availTop || 0) + (screen.availHeight - height)/2);
    const popup = window.open(url.href,'_blank',`popup=yes,toolbar=no,menubar=no,location=no,status=no,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`);
    if (!popup) {$('popoutStatus').textContent = 'The new window was blocked. Allow pop-ups for this site and try again.'; return;}
    $('popoutStatus').textContent = '';
    try {popup.sessionStorage.setItem('gregle-calc-popout',JSON.stringify(state)); popup.opener = null; popup.focus();} catch (_) {}
  });
  const sizer = $('calculatorSizer'), fit = $('calculatorFit'), calculator = $('graphCalculator'), handle = $('calculatorResize');
  let resizeFrame = 0;
  function fitCalculator() {
    resizeFrame = 0;
    const baseWidth = calculator.offsetWidth, baseHeight = calculator.offsetHeight;
    if (!baseWidth || !baseHeight || !sizer.clientWidth || !sizer.clientHeight) return;
    sizer.style.aspectRatio = `${baseWidth} / ${baseHeight}`;
    const scale = Math.min(sizer.clientWidth/baseWidth,sizer.clientHeight/baseHeight);
    fit.style.transform = `translate(-50%, -50%) scale(${scale})`;
    sizer.style.setProperty('--calculator-scale',String(scale));
    document.dispatchEvent(new Event('gregle-calc-resize'));
  }
  function requestFit() {if (!resizeFrame) resizeFrame = requestAnimationFrame(fitCalculator);}
  new ResizeObserver(requestFit).observe(sizer); new ResizeObserver(requestFit).observe(calculator);
  window.addEventListener('resize',requestFit);
  let drag = null;
  handle.addEventListener('pointerdown',event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault(); handle.setPointerCapture(event.pointerId);
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,width:sizer.clientWidth,height:sizer.clientHeight};
  });
  function size(width,height) {
    const available = sizer.parentElement.clientWidth;
    sizer.style.width = `${Math.max(Math.min(260,available),Math.min(available,width))}px`;
    sizer.style.height = `${Math.max(420,Math.min(1800,height))}px`;
  }
  handle.addEventListener('pointermove',event => {if (drag && drag.id === event.pointerId) size(drag.width+event.clientX-drag.x,drag.height+event.clientY-drag.y);});
  function endResize(event) {if (drag?.id === event.pointerId) drag = null;}
  handle.addEventListener('pointerup',endResize); handle.addEventListener('pointercancel',endResize); handle.addEventListener('lostpointercapture',endResize);
  handle.addEventListener('keydown',event => {
    if (event.key === 'Home') {event.preventDefault(); sizer.style.width = ''; sizer.style.height = ''; requestFit();}
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault(); const step = event.shiftKey ? 50 : 20;
      size(sizer.clientWidth+(event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),sizer.clientHeight+(event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
    }
  });
  document.addEventListener('keydown',event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || $('gregleAppMenu')?.open || window.GregleCalculator?.getScreen() !== 'calculate' || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (/^[0-9.+*/^()%!−×÷-]$/.test(event.key)) {event.preventDefault(); insert(event.key);}
    else if (event.key === 'Backspace') {event.preventDefault(); insert('','backspace');}
    else if (event.key === 'Enter' && event.target === document.body) {event.preventDefault(); calculate();}
  });
  renderHistory(); update(); requestFit();
})();
