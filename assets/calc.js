(() => {
  'use strict';
  const $ = id => document.getElementById(id), {evaluate, format, toFraction} = window.GregleCalc;
  const input = $('expression'), output = $('result'), message = $('calcMessage');
  const popout = new URLSearchParams(window.location.search).get('popout') === '1';
  let ans = 0, completed = false, history = [], angle = 'deg', restored = null, fractionMode = false;
  let homeHistory = [], historySelection = null, entryRecall = -1, lastEntry = '', errorState = null, errorChoice = 0, keyMode = 'normal';
  if (popout) {
    document.documentElement.classList.add('calculator-popout');
    try {
      const state = JSON.parse(sessionStorage.getItem('gregle-calc-popout') || 'null');
      sessionStorage.removeItem('gregle-calc-popout');
      if (state && typeof state.expression === 'string' && state.expression.length <= 300) {
        restored = state; fractionMode = state.fractionMode === true; input.value = state.completed ? '' : state.expression;
        ans = Number.isFinite(state.ans) ? state.ans : 0; angle = state.angle === 'rad' ? 'rad' : 'deg'; completed = state.completed === true;
        lastEntry = typeof state.lastEntry === 'string' ? state.lastEntry.slice(0,300) : completed ? state.expression : '';
      }
    } catch (_) {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem('gregle-calc-history') || '[]');
    if (Array.isArray(saved)) history = saved.filter(item => item && typeof item.expression === 'string' && item.expression.length <= 300 && Number.isFinite(item.value)).slice(0,50);
  } catch (_) {}
  if (!restored && history.length) ans = history[0].value;
  if (!lastEntry) lastEntry = history[0]?.expression || '';
  homeHistory = restored?.homeCleared ? [] : history.slice().reverse();
  const touchInput = window.matchMedia?.('(pointer: coarse)').matches === true;
  function prepareInput(field) {
    field.inputMode = 'none'; field.setAttribute('inputmode','none'); field.readOnly = touchInput;
    if (touchInput) field.setAttribute('readonly','');
  }
  prepareInput(input);
  function handleReadonlyKey(event, edit) {
    if (!event.target.readOnly || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return false;
    if (event.key === 'Backspace' || event.key === 'Delete') {event.preventDefault(); edit('',event.key === 'Backspace' ? 'backspace' : 'delete'); return true;}
    if (event.key.length === 1 && /^[a-z0-9.+*/^()%!,= π√−×÷-]$/i.test(event.key)) {event.preventDefault(); edit(event.key); return true;}
    return false;
  }
  const options = () => ({angle,ans});
  const focus = () => {if (!touchInput) input.focus({preventScroll:true}); updateCursor();};
  function updateCursor() {
    const cursor = $('homeCursor'), position = input.selectionStart ?? input.value.length;
    cursor.style.setProperty('--cursor-column',String(position));
    if (window.getComputedStyle && input.clientWidth) {
      const cell = parseFloat(window.getComputedStyle(cursor).width) || 11, x = position * cell, available = Math.max(0,input.clientWidth-cell-1);
      if (x < input.scrollLeft) input.scrollLeft = Math.max(0,x);
      else if (x-input.scrollLeft > available) input.scrollLeft = x-available;
      cursor.style.left = `${Math.max(0,Math.min(available,x-input.scrollLeft))}px`;
    }
    cursor.style.setProperty('--cursor-scroll',`${input.scrollLeft || 0}px`);
  }
  function setKeyMode(mode) {keyMode = mode; $('homeCursor').textContent = mode === 'alpha' ? 'A' : mode === 'second' ? '↑' : '';}
  function fractionAnswer() {
    const scientificExpression = /[a-zπ√]/i.test(lastEntry.replace(/ans/gi,'').replace(/(?:[0-9]|\.)[eE][+-]?[0-9]+/g,''));
    return toFraction(ans,{maxDenominator:scientificExpression ? 10000 : 1000000000});
  }
  function resultText() {
    const value = fractionMode && fractionAnswer();
    return value && value.denominator !== 1 ? `${value.numerator}/${value.denominator}` : format(ans);
  }
  function renderAnswer() {
    const value = fractionMode && fractionAnswer();
    if (!value || value.denominator === 1) {output.textContent = format(ans); return;}
    const fraction = document.createElement('span'); fraction.className = 'fraction-value';
    const top = document.createElement('span'), slash = document.createElement('span'), bottom = document.createElement('span');
    top.className = 'fraction-numerator'; bottom.className = 'fraction-denominator'; slash.className = 'sr-only';
    top.textContent = String(value.numerator); slash.textContent = '/'; bottom.textContent = String(value.denominator);
    fraction.append(top,slash,bottom); output.replaceChildren(fraction);
  }
  function toggleFraction() {
    if (errorState) return;
    if (!fractionMode && !fractionAnswer()) {$('homeStatus').textContent = 'This answer cannot be shown as a simple fraction.'; return;}
    fractionMode = !fractionMode; update();
  }
  function update() {input.removeAttribute('aria-invalid'); renderAnswer(); output.dataset.valid = errorState ? 'false' : 'true'; updateCursor();}
  function selectedHistory() {return historySelection === null ? null : {item:history[Math.floor(historySelection/2)],part:historySelection%2 ? 'expression' : 'answer'};}
  function renderHistory() {
    const list = $('historyList'), selected = selectedHistory(); list.replaceChildren();
    $('clearHistory').disabled = !history.length;
    for (const item of homeHistory) {
      const row = document.createElement('li');
      for (const part of ['expression','answer']) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `home-history-${part}`;
        button.textContent = part === 'expression' ? item.expression : format(item.value);
        button.setAttribute('aria-label',`Recall ${part}: ${button.textContent}`);
        const active = selected?.item === item && selected.part === part; button.classList.toggle('is-selected',active); button.setAttribute('aria-pressed',String(active));
        button.addEventListener('click',() => recall(item,part)); row.append(button);
        if (active) requestAnimationFrame(() => button.scrollIntoView?.({block:'nearest',inline:'nearest'}));
      }
      list.append(row);
    }
    if (!selected) list.scrollTop = list.scrollHeight;
  }
  function leaveHistory() {if (historySelection !== null) {historySelection = null; renderHistory();}}
  function recall(item,part) {
    completed = false; leaveHistory(); insert(part === 'expression' ? item.expression : fractionMode ? String(item.value) : format(item.value),'',{literal:true});
  }
  function recallEntry() {
    if (!history.length) return;
    entryRecall = Math.min(history.length-1,entryRecall+1); leaveHistory(); completed = false;
    input.value = history[entryRecall].expression; input.setSelectionRange(input.value.length,input.value.length); update(); focus();
  }
  function chooseError(index) {
    errorChoice = index;
    [$('errorQuit'),$('errorGoto')].forEach((button,i) => {button.classList.toggle('is-selected',i === index); button.setAttribute('aria-pressed',String(i === index));});
  }
  function dismissError(goto) {
    if (!errorState) return;
    const failed = errorState; errorState = null; $('calcError').hidden = true; message.textContent = '';
    input.value = goto ? failed.expression : ''; completed = false; input.setSelectionRange(input.value.length,input.value.length); update(); focus();
  }
  function showError(error,expression) {
    const kind = /divide by zero/i.test(error.message) ? 'DIVIDE BY 0' : /finite real|factorial|undefined/i.test(error.message) ? 'DOMAIN' : 'SYNTAX';
    errorState = {expression}; $('calcErrorTitle').textContent = `ERR:${kind}`; message.textContent = error.message; $('calcError').hidden = false;
    input.setAttribute('aria-invalid','true'); output.dataset.valid = 'false'; chooseError(0); $('errorQuit').focus({preventScroll:true});
  }
  function insert(value,action, {literal = false} = {}) {
    if (errorState) {if (action === 'clear' || value === '1') dismissError(false); else if (value === '2') dismissError(true); return;}
    if (action === 'clear' && !input.value && historySelection === null) {homeHistory = []; renderHistory(); update(); focus(); return;}
    leaveHistory(); entryRecall = -1;
    if (value === 'neg') {value = '−'; literal = true;}
    if (value === 'ans') value = 'Ans';
    if (!input.value && !action && !literal && /^[+×÷*/^%!−-]/.test(value)) value = 'Ans' + value;
    let start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
    if (action === 'clear') {start = 0; end = input.value.length;}
    else if (action === 'backspace' && start === end) start = Math.max(0,start-1);
    else if (action === 'delete' && start === end) end = Math.min(input.value.length,end+1);
    if (input.value.length - (end-start) + value.length > 300) return;
    input.setRangeText(value,start,end,'end'); completed = false; update(); focus();
  }
  function insertFraction() {
    if (errorState) return;
    let start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
    if (start === end && start > 0) {
      if (input.value[start-1] === ')') {
        let depth = 0;
        for (let i = start-1; i >= 0; i--) {if (input.value[i] === ')') depth++; else if (input.value[i] === '(' && --depth === 0) {start = i; break;}}
      } else {
        const atom = input.value.slice(0,start).match(/(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+|Ans|π|e)$/);
        if (atom) start -= atom[0].length;
      }
    }
    if (start < end && input.value[start] === '(') {const name = input.value.slice(0,start).match(/[a-z]+$/i); if (name) start -= name[0].length;}
    const numerator = input.value.slice(start,end), template = `(${numerator})/()`;
    if (input.value.length-(end-start)+template.length > 300) return;
    input.setSelectionRange(start,end); insert(template); fractionMode = true;
    const position = start + (numerator ? numerator.length+4 : 1);
    input.setSelectionRange(position,position); update(); focus();
    $('homeStatus').textContent = numerator ? 'Enter the denominator. Right exits the fraction.' : 'Enter the numerator. Down moves to the denominator.';
  }
  function navigateFraction(direction) {
    if (!input.value || input.selectionStart !== input.selectionEnd) return false;
    const position = input.selectionStart, fields = [];
    function closing(open) {let depth = 0; for (let i = open; i < input.value.length; i++) {if (input.value[i] === '(') depth++; else if (input.value[i] === ')' && --depth === 0) return i;} return -1;}
    for (let i = 0; i < input.value.length; i++) {
      if (input.value[i] !== '(') continue;
      const numeratorEnd = closing(i);
      if (numeratorEnd < 0 || input.value.slice(numeratorEnd+1,numeratorEnd+3) !== '/(') continue;
      const denominatorEnd = closing(numeratorEnd+2);
      if (denominatorEnd >= 0) fields.push({start:i,numeratorStart:i+1,numeratorEnd,denominatorStart:numeratorEnd+3,denominatorEnd});
    }
    fields.sort((a,b) => (a.denominatorEnd-a.start)-(b.denominatorEnd-b.start));
    for (const field of fields) {
      const inNumerator = position >= field.numeratorStart && position <= field.numeratorEnd;
      const inDenominator = position >= field.denominatorStart && position <= field.denominatorEnd;
      let next;
      if ((direction === 'down' && inNumerator) || (direction === 'right' && position === field.numeratorEnd)) next = field.denominatorStart;
      else if ((direction === 'up' && inDenominator) || (direction === 'left' && position === field.denominatorStart)) next = field.numeratorStart;
      else if (direction === 'right' && position === field.denominatorEnd) next = field.denominatorEnd+1;
      if (next !== undefined) {input.setSelectionRange(next,next); focus(); return true;}
    }
    return false;
  }
  function calculate() {
    if (errorState) {dismissError(errorChoice === 1); return;}
    const selected = selectedHistory(); if (selected) {recall(selected.item,selected.part); return;}
    const expression = input.value.trim() || lastEntry; if (!expression) return;
    try {
      const value = evaluate(expression,options()), item = {expression,value,angle:/sin|cos|tan/.test(expression) ? angle : undefined};
      history.unshift(item); history = history.slice(0,50); homeHistory.push(item); homeHistory = homeHistory.slice(-50);
      try {localStorage.setItem('gregle-calc-history',JSON.stringify(history));} catch (_) {}
      ans = value; lastEntry = expression; completed = true; entryRecall = -1; historySelection = null;
      input.value = ''; input.setSelectionRange(0,0); renderHistory(); update(); focus();
    } catch (error) {showError(error,expression);}
  }
  function navigate(direction) {
    if (errorState) {
      if (direction === 'enter') {dismissError(errorChoice === 1); return;}
      chooseError(errorChoice === 0 ? 1 : 0); [$('errorQuit'),$('errorGoto')][errorChoice].focus({preventScroll:true}); return;
    }
    if (direction === 'enter') {calculate(); return;}
    if (navigateFraction(direction)) return;
    if (direction === 'up' || direction === 'down') {
      if (!history.length || (direction === 'down' && historySelection === null)) return;
      const next = (historySelection ?? -1) + (direction === 'up' ? 1 : -1);
      historySelection = next < 0 ? null : Math.min(history.length*2-1,next); homeHistory = history.slice().reverse(); renderHistory();
      const selected = selectedHistory(); $('homeStatus').textContent = selected ? `History ${selected.part}: ${selected.part === 'answer' ? format(selected.item.value) : selected.item.expression}. Press ENTER to copy.` : 'Entry line.';
    } else {
      leaveHistory(); const position = Math.max(0,Math.min(input.value.length,(input.selectionStart ?? input.value.length)+(direction === 'left' ? -1 : 1)));
      input.setSelectionRange(position,position);
    }
    focus();
  }
  function setAngle(value) {angle = value === 'rad' ? 'rad' : 'deg'; update();}
  $('calculatorForm').addEventListener('submit',event => {event.preventDefault(); calculate();});
  input.addEventListener('input',() => {completed = false; entryRecall = -1; leaveHistory(); update();});
  for (const type of ['click','select','keyup','scroll','focus']) input.addEventListener(type,updateCursor);
  input.addEventListener('keydown',event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter' || event.key === '=') {
      event.preventDefault();
      if (keyMode === 'second' && !errorState) {recallEntry(); document.dispatchEvent(new Event('gregle-calc-release-second'));} else calculate();
    } else if (event.key === 'Escape') {event.preventDefault(); insert('','clear');}
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {event.preventDefault(); navigate(event.key === 'ArrowUp' ? 'up' : 'down');}
    else if (handleReadonlyKey(event,insert)) return;
    else if (event.key.length === 1 && !input.value && /^[+*/^%!−×÷-]$/.test(event.key)) {event.preventDefault(); insert(event.key);}
    else if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      if (navigateFraction(event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : '')) {event.preventDefault(); return;}
      leaveHistory();
      if (input.readOnly) {
        event.preventDefault();
        const position = event.key === 'Home' ? 0 : event.key === 'End' ? input.value.length : Math.max(0,Math.min(input.value.length,(input.selectionStart ?? input.value.length)+(event.key === 'ArrowLeft' ? -1 : 1)));
        input.setSelectionRange(position,position); updateCursor();
      }
    }
  });
  $('errorQuit').addEventListener('click',() => dismissError(false)); $('errorGoto').addEventListener('click',() => dismissError(true));
  $('copyResult').addEventListener('click',async () => {
    try {await navigator.clipboard.writeText(resultText()); $('copyStatus').textContent = 'Copied';}
    catch (_) {$('copyStatus').textContent = 'Unavailable';}
  });
  $('clearHistory').addEventListener('click',() => {
    history = []; homeHistory = []; historySelection = null; entryRecall = -1; lastEntry = '';
    try {localStorage.removeItem('gregle-calc-history');} catch (_) {} renderHistory();
  });
  function reset(clearSavedHistory = false) {
    ans = 0; fractionMode = false; completed = false; lastEntry = ''; historySelection = null; entryRecall = -1;
    errorState = null; errorChoice = 0; input.value = ''; input.setSelectionRange(0,0);
    $('calcError').hidden = true; message.textContent = ''; $('homeStatus').textContent = ''; $('copyStatus').textContent = 'Copy';
    homeHistory = [];
    if (clearSavedHistory) {
      history = [];
      try {localStorage.removeItem('gregle-calc-history');} catch (_) {}
    }
    renderHistory(); update(); focus();
  }
  const getState = () => ({expression:input.value,ans,angle,completed,lastEntry,fractionMode,homeCleared:homeHistory.length === 0,screen:window.GregleCalculator?.getScreen() || 'calculate'});
  window.GregleScientific = {insert,insertFraction,toggleFraction,calculate,reset,navigate,setAngle,getState,prepareInput,handleReadonlyKey,recallEntry,setKeyMode,hasError:() => Boolean(errorState),initialScreen:restored?.screen,restoredAngle:restored?.angle};
  $('popoutCalculator').addEventListener('click',async () => {
    document.dispatchEvent(new Event('gregle-calc-save-graph'));
    const state = getState(), url = new URL(window.location.href); url.searchParams.set('popout','1');
    url.searchParams.set('mode',state.screen === 'calculate' ? 'standard' : 'graph');
    const width = Math.min(560,Math.max(280,screen.availWidth - 40)), height = Math.min(1080,Math.max(400,screen.availHeight - 60));
    const left = Math.round((screen.availLeft || 0) + (screen.availWidth - width)/2), top = Math.round((screen.availTop || 0) + (screen.availHeight - height)/2);
    const emulating = window.GregleEmulator?.isActive();
    if (emulating) url.searchParams.set('engine',window.GregleEmulator.selectedEngine());
    else url.searchParams.delete('engine');
    const popup = window.open(emulating ? 'about:blank' : url.href,'_blank',`popup=yes,toolbar=no,menubar=no,location=no,status=no,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`);
    if (!popup) {$('popoutStatus').textContent = 'The new window was blocked. Allow pop-ups for this site and try again.'; return;}
    $('popoutStatus').textContent = '';
    if (emulating) {
      try {await window.GregleEmulator.beforePopout(); popup.location.replace(url.href);}
      catch (_) {popup.close(); $('popoutStatus').textContent = 'The calculator could not be moved. Try again.'; return;}
    }
    try {popup.sessionStorage.setItem('gregle-calc-popout',JSON.stringify(state)); popup.opener = null; popup.focus();} catch (_) {}
  });
  const sizer = $('calculatorSizer'), fit = $('calculatorFit'), calculator = $('graphCalculator'), handle = $('calculatorResize');
  let resizeFrame = 0;
  function fitCalculator() {
    resizeFrame = 0;
    // The native calculator uses a responsive grid, so it must never enter the TI scale/resize path.
    if ($('calcPage').classList.contains('scientific-only') && !window.GregleEmulator?.isActive()) {
      fit.style.top = ''; fit.style.transform = ''; sizer.style.aspectRatio = '';
      sizer.style.setProperty('--calculator-scale','1'); return;
    }
    const baseWidth = calculator.offsetWidth, baseHeight = calculator.offsetHeight;
    if (!baseWidth || !baseHeight || !sizer.clientWidth || !sizer.clientHeight) return;
    // Reserve an unscaled strip for the drag tab, including at small sizes.
    // The tab is hidden in installed/pop-out windows, which use the full area.
    const gutter = handle.offsetHeight ? handle.offsetHeight + 12 : 0;
    sizer.style.aspectRatio = `${baseWidth} / ${baseHeight + gutter*baseWidth/sizer.clientWidth}`;
    const availableHeight = Math.max(1,sizer.clientHeight-gutter);
    const scale = Math.min(sizer.clientWidth/baseWidth,availableHeight/baseHeight);
    fit.style.top = `${availableHeight/2}px`;
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
    if (event.defaultPrevented || window.GregleEmulator?.isActive() || event.ctrlKey || event.metaKey || event.altKey || $('gregleAppMenu')?.open || window.GregleCalculator?.getScreen() !== 'calculate' || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (/^[0-9.+*/^()%!−×÷-]$/.test(event.key)) {event.preventDefault(); insert(event.key);}
    else if (event.key === 'Backspace') {event.preventDefault(); insert('','backspace');}
    else if (event.key === 'Enter' && event.target === document.body) {event.preventDefault(); calculate();}
  });
  renderHistory(); update(); requestFit();
})();
