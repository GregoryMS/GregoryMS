(() => {
  'use strict';
  const $ = id => document.getElementById(id), core = window.GregleGraph, scientific = window.GregleScientific;
  const canvas = $('graphCanvas'), ctx = canvas.getContext('2d'), stage = $('graphStage');
  const colours = ['#9850ff', '#159a91', '#e36d37', '#3d8ee9', '#db518c', '#a29a22', '#a26643', '#708090'];
  let equations = [], angle = 'deg', parameter = 1, view = {x: 0, y: 0, span: 20}, traceX = null;
  let width = 1, height = 1, frame = 0, saveTimer, counter = 0, tableVisible = false;
  const pointers = new Map(); let gesture = null, moved = false;
  let activeEquation = null;
  let screen = 'calculate', editTarget = 'calculate', menuReturn = 'calculate', menuIndex = 0, second = false, alpha = false, activeNumberInput = null, traceEquation = 0, tableRow = 0;
  try {
    const saved = JSON.parse(localStorage.getItem('gregle-calc-graph') || 'null');
    if (saved && Array.isArray(saved.equations)) {
      equations = saved.equations.filter(e => e && typeof e.expression === 'string').slice(0, 8).map(e => ({expression: e.expression.slice(0, 300), enabled: e.enabled !== false, colour: colours.includes(e.colour) ? e.colour : colours[0]}));
      angle = saved.angle === 'deg' ? 'deg' : 'rad';
      parameter = Number.isFinite(saved.parameter) ? Math.min(10, Math.max(-10, saved.parameter)) : 1;
      if (saved.view && [saved.view.x, saved.view.y, saved.view.span].every(Number.isFinite) && saved.view.span >= .000001 && saved.view.span <= 1e8 && Math.abs(saved.view.x) <= 1e10 && Math.abs(saved.view.y) <= 1e10) view = {x:saved.view.x, y:saved.view.y, span:saved.view.span};
      if (Number.isFinite(saved.view?.yspan) && saved.view.yspan >= 1e-6 && saved.view.yspan <= 1e8) view.yspan = saved.view.yspan;
    }
  } catch (_) {}
  if (scientific.restoredAngle) angle = scientific.restoredAngle === 'rad' ? 'rad' : 'deg';
  scientific.setAngle(angle);
  if (!equations.length) equations = [{expression: 'sin(x)', enabled: true, colour: colours[0]}, {expression: 'x^2 / 4 - 2', enabled: true, colour: colours[1]}];
  function persist() {
    try {localStorage.setItem('gregle-calc-graph', JSON.stringify({equations: equations.map(({expression, enabled, colour}) => ({expression, enabled, colour})), angle, parameter, view}));} catch (_) {}
  }
  function save() {clearTimeout(saveTimer); saveTimer = setTimeout(persist, 180);}
  document.addEventListener('gregle-calc-save-graph', () => {clearTimeout(saveTimer); persist();});
  document.addEventListener('gregle-calc-resize', request);
  function bounds() {
    const yspan = view.yspan || view.span * height / width;
    return {xmin: view.x - view.span / 2, xmax: view.x + view.span / 2, ymin: view.y - yspan / 2, ymax: view.y + yspan / 2, width, height};
  }
  const px = x => (x - view.x) * width / view.span + width / 2;
  const py = y => height / 2 - (y - view.y) * height / (view.yspan || view.span * height / width);
  const world = (x, y) => ({x: view.x + (x - width / 2) * view.span / width, y: view.y - (y - height / 2) * (view.yspan || view.span * height / width) / height});
  function compact(value) {
    if (Math.abs(value) < 1e-12) return '0';
    return Number(value.toPrecision(6)).toString();
  }
  const fn = equation => x => equation.compiled(x, {angle, a: parameter});
  function compile(equation) {
    equation.compiled = null; equation.error = '';
    if (equation.expression.trim()) {
      try {equation.compiled = core.compile(equation.expression);} catch (error) {equation.error = error.message;}
    }
    equation.input?.setAttribute('aria-invalid', String(Boolean(equation.error)));
    if (equation.status) equation.status.textContent = equation.error;
  }
  function activateEquation(equation) {
    activeEquation = equation;
    equations.forEach(e => e.row?.classList.toggle('is-active', e === equation));
    $('graphKeypadTarget').textContent = equation ? `Editing equation ${equation.id}` : 'Tap a key to add an expression';
  }
  function editEquation(value, action) {
    if (!activeEquation || !equations.includes(activeEquation)) add();
    const equation = activeEquation;
    if (!equation) return;
    const input = equation.input;
    let start = input.selectionStart, end = input.selectionEnd;
    if (action === 'clear') {start = 0; end = input.value.length;}
    else if (action === 'backspace' && start === end) start = Math.max(0, start - 1);
    else if (action === 'delete' && start === end) end = Math.min(input.value.length,end + 1);
    if (input.value.length - (end - start) + value.length > input.maxLength) return;
    input.setRangeText(value, start, end, 'end');
    equation.expression = input.value; compile(equation); request(); save();
    openScreen('equations', false);
    input.focus({preventScroll: true});
  }
  function makeEquation(equation, focus = false) {
    const id = ++counter, row = document.createElement('div'); row.className = 'graph-equation'; row.style.setProperty('--curve', equation.colour);
    const top = document.createElement('div'); top.className = 'equation-main';
    const visible = document.createElement('button'); visible.type = 'button'; visible.className = 'curve-toggle';
    visible.textContent = `Y${id}=`; visible.setAttribute('aria-label', `Show equation ${id}`); visible.setAttribute('aria-pressed', String(equation.enabled)); visible.title = 'Show or hide curve';
    const label = document.createElement('label'); label.className = 'sr-only'; label.htmlFor = `equation-${id}`; label.textContent = `Equation ${id}`;
    const input = document.createElement('input'); input.id = `equation-${id}`; input.type = 'text'; input.value = equation.expression; input.placeholder = 'y = f(x)'; input.maxLength = 300; input.autocomplete = 'off'; input.spellcheck = false; input.autocapitalize = 'off'; scientific.prepareInput(input);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-equation'; remove.textContent = '×'; remove.title = 'Remove equation'; remove.setAttribute('aria-label', `Remove equation ${id}`);
    const status = document.createElement('p'); status.className = 'equation-status'; status.id = `equation-status-${id}`; status.setAttribute('aria-live', 'polite'); input.setAttribute('aria-describedby', status.id);
    top.append(visible, label, input, remove); row.append(top, status); $('equationList').append(row);
    Object.assign(equation, {id, row, input, status}); compile(equation);
    input.addEventListener('focus', () => {activateEquation(equation); if (screen !== 'equations') openScreen('equations', false);});
    input.addEventListener('input', () => {equation.expression = input.value; compile(equation); request(); save();});
    input.addEventListener('keydown', event => {if (event.key === 'Enter') {event.preventDefault(); openScreen('graph');} else scientific.handleReadonlyKey(event,editEquation);});
    visible.addEventListener('click', () => {equation.enabled = !equation.enabled; visible.setAttribute('aria-pressed', String(equation.enabled)); request(); save();});
    remove.addEventListener('click', () => {
      const position = equations.indexOf(equation); equations.splice(position, 1); row.remove(); $('addEquation').disabled = false;
      if (activeEquation === equation) activateEquation(equations[Math.min(position, equations.length - 1)] || null);
      (equations[Math.min(position, equations.length - 1)]?.input || $('addEquation')).focus(); request(); save();
    });
    if (!activeEquation) activateEquation(equation);
    if (focus) input.focus();
  }
  function add(expression = '') {
    openScreen('equations', false);
    if (equations.length >= 8) return;
    const colour = colours.find(c => !equations.some(e => e.colour === c)) || colours[equations.length % colours.length];
    const equation = {expression, enabled: true, colour}; equations.push(equation); makeEquation(equation, true);
    $('addEquation').disabled = equations.length >= 8; request(); save();
  }
  function request() { if (!frame) frame = requestAnimationFrame(draw); }
  function drawGrid(b) {
    ctx.fillStyle = '#dce7df'; ctx.fillRect(0, 0, width, height);
    const step = core.tickStep(view.span, width), minor = step / 5;
    function grid(spacing, colour) {
      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = 1;
      for (let x = Math.ceil(b.xmin / spacing) * spacing, n = 0; x <= b.xmax && n < 400; x += spacing, n++) {const p = Math.round(px(x)) + .5; ctx.moveTo(p, 0); ctx.lineTo(p, height);}
      for (let y = Math.ceil(b.ymin / spacing) * spacing, n = 0; y <= b.ymax && n < 400; y += spacing, n++) {const p = Math.round(py(y)) + .5; ctx.moveTo(0, p); ctx.lineTo(width, p);}
      ctx.stroke();
    }
    grid(minor, '#d4e0d6'); grid(step, '#c2d2c6');
    ctx.beginPath(); ctx.strokeStyle = '#718b79'; ctx.lineWidth = 1.25;
    ctx.moveTo(px(0), 0); ctx.lineTo(px(0), height); ctx.moveTo(0, py(0)); ctx.lineTo(width, py(0)); ctx.stroke();
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#536f5e';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const labelY = Math.max(5, Math.min(height - 19, py(0) + 6));
    for (let x = Math.ceil(b.xmin / step) * step, n = 0; x <= b.xmax && n < 80; x += step, n++) if (Math.abs(x / step) > .001) ctx.fillText(compact(x), Math.max(20, Math.min(width - 20, px(x))), labelY);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const labelX = Math.max(6, Math.min(width - 45, px(0) + 8));
    for (let y = Math.ceil(b.ymin / step) * step, n = 0; y <= b.ymax && n < 80; y += step, n++) if (Math.abs(y / step) > .001) ctx.fillText(compact(y), labelX, Math.max(10, Math.min(height - 10, py(y))));
    ctx.fillText('0', Math.max(5, Math.min(width - 15, px(0) + 7)), Math.max(12, Math.min(height - 12, py(0) + 13)));
    ctx.fillStyle = '#334e3e'; ctx.font = 'italic 12px system-ui';
    ctx.fillText('x', width - 15, Math.max(13, Math.min(height - 14, py(0) - 12))); ctx.fillText('y', Math.max(10, Math.min(width - 15, px(0) - 17)), 13);
  }
  function updateTrace() {
    $('traceValues').replaceChildren();
    if (traceX === null) { $('traceX').textContent = 'Ready'; return; }
    $('traceX').textContent = `x = ${compact(traceX)}`;
    for (const [index, e] of traceable().entries()) {
      const y = core.safe(fn(e), traceX), chip = document.createElement('span'); chip.style.setProperty('--curve', e.colour); chip.className = 'trace-chip';
      chip.classList.toggle('is-traced', screen === 'trace' && index === traceEquation);
      chip.textContent = `Y${e.id} = ${Number.isFinite(y) ? compact(y) : 'undefined'}`; chip.title = e.expression; $('traceValues').append(chip);
    }
  }
  function draw() {
    frame = 0;
    if ($('graphPanel').hidden) return;
    const rect = stage.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);}
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = bounds(); drawGrid(b);
    for (const e of equations) {
      if (!e.compiled || !e.enabled) {if (e.status && !e.error) e.status.textContent = ''; continue;}
      const lines = core.paths(fn(e), b); ctx.strokeStyle = e.colour; ctx.lineWidth = 2.3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
      for (const points of lines) {points.forEach(([x, y], i) => {if (!i) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y));});}
      ctx.stroke();
      e.status.textContent = lines.length ? '' : 'No real values in this view.';
    }
    if (traceX !== null) {
      ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = '#9584ab'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px(traceX), 0); ctx.lineTo(px(traceX), height); ctx.stroke(); ctx.restore();
      for (const [index, e] of traceable().entries()) {
        const y = core.safe(fn(e), traceX);
        if (Number.isFinite(y) && y >= b.ymin && y <= b.ymax) {ctx.beginPath(); ctx.arc(px(traceX), py(y), screen === 'trace' && index === traceEquation ? 6 : 3.5, 0, 2 * Math.PI); ctx.fillStyle = e.colour; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#dce7df'; ctx.stroke();}
      }
    }
    $('graphRange').textContent = `x: ${compact(b.xmin)} to ${compact(b.xmax)} · y: ${compact(b.ymin)} to ${compact(b.ymax)}`;
    updateTrace(); if (tableVisible) drawTable();
  }
  function drawTable() {
    const valid = equations.filter(e => e.enabled && e.compiled), table = $('graphTable'); table.replaceChildren();
    const caption = document.createElement('caption'); caption.textContent = 'Function values across the visible x range'; table.append(caption);
    const head = document.createElement('thead'), header = document.createElement('tr'), xhead = document.createElement('th'); xhead.scope = 'col'; xhead.textContent = 'x'; header.append(xhead);
    for (const e of valid) {const th = document.createElement('th'); th.scope = 'col'; th.textContent = e.expression; th.style.color = e.colour; header.append(th);}
    head.append(header); table.append(head); const body = document.createElement('tbody'), b = bounds();
    for (let i = 0; i <= 10; i++) {
      const x = b.xmin + (b.xmax - b.xmin) * i / 10, row = document.createElement('tr'), xcell = document.createElement('th'); xcell.scope = 'row'; xcell.textContent = compact(x); row.append(xcell);
      for (const e of valid) {const td = document.createElement('td'), value = core.safe(fn(e), x); td.textContent = Number.isFinite(value) ? compact(value) : 'undefined'; row.append(td);}
      body.append(row);
    }
    table.append(body);
    highlightTable();
  }
  function clampView() {view.span = Math.max(1e-6, Math.min(1e8, view.span)); if (view.yspan) view.yspan = Math.max(1e-6, Math.min(1e8, view.yspan)); view.x = Math.max(-1e10, Math.min(1e10, view.x)); view.y = Math.max(-1e10, Math.min(1e10, view.y));}
  function zoom(factor, x = width / 2, y = height / 2) {
    const before = world(x, y); view.span *= factor; if (view.yspan) view.yspan *= factor; clampView(); const after = world(x, y);
    view.x += before.x - after.x; view.y += before.y - after.y; clampView(); request(); save();
  }
  function reset() {view = {x: 0, y: 0, span: 20}; traceX = null; request(); save();}
  function position(event) {const rect = canvas.getBoundingClientRect(); return {x: event.clientX - rect.left, y: event.clientY - rect.top};}
  function startGesture() {
    const p = Array.from(pointers.values());
    if (!p.length) {gesture = null; return;}
    const center = p.length > 1 ? {x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2} : p[0];
    gesture = {center, distance: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, view: {...view}, anchor: world(center.x, center.y)};
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.focus({preventScroll: true}); canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, position(event)); moved = pointers.size > 1; startGesture();
  });
  canvas.addEventListener('pointermove', event => {
    const point = position(event);
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse' && event.buttons === 0) {traceX = world(point.x, point.y).x; request();}
      return;
    }
    pointers.set(event.pointerId, point); const points = Array.from(pointers.values());
    const center = points.length > 1 ? {x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2} : points[0];
    if (Math.hypot(center.x - gesture.center.x, center.y - gesture.center.y) > 3 || points.length > 1) moved = true;
    if (!moved) return;
    const distance = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    if (gesture.view.yspan) view.yspan = gesture.view.yspan * (gesture.distance > 0 && distance > 0 ? gesture.distance / distance : 1);
    view.span = gesture.distance > 0 && distance > 0 ? gesture.view.span * gesture.distance / distance : gesture.view.span; clampView();
    view.x = gesture.anchor.x - (center.x - width / 2) * view.span / width; view.y = gesture.anchor.y + (center.y - height / 2) * (view.yspan || view.span * height / width) / height;
    clampView(); traceX = null; request(); save();
  });
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    const point = position(event);
    if (!moved && pointers.size === 1 && event.type === 'pointerup') {traceX = world(point.x, point.y).x; request();}
    pointers.delete(event.pointerId); startGesture();
  }
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer); canvas.addEventListener('lostpointercapture', endPointer);
  canvas.addEventListener('wheel', event => {event.preventDefault(); const p = position(event); zoom(Math.exp(Math.max(-.4, Math.min(.4, event.deltaY * .0015))), p.x, p.y);}, {passive: false});
  $('addEquation').addEventListener('click', () => add());
  $('graphKeyboard').addEventListener('pointerdown', event => {
    if (event.target.closest('button')) event.preventDefault();
  });
  $('graphKeyboard').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.dataset.graphNav) return;
    if (alpha && button.dataset.alphaInsert !== undefined) {insertActive(button.dataset.alphaInsert); return;}
    if ((screen === 'zoom' || screen === 'math') && /^[1-6]$/.test(button.dataset.graphInsert || '')) {menuIndex = Number(button.dataset.graphInsert) - 1; navigate('enter'); return;}
    const primary = editTarget === 'calculate' && button.dataset.calcInsert ? button.dataset.calcInsert : button.dataset.graphInsert || '';
    insertActive(second && button.dataset.secondInsert ? button.dataset.secondInsert : primary, button.dataset.graphAction);
    setSecond(false);
  });
  document.querySelectorAll('[data-graph-example]').forEach(button => button.addEventListener('click', () => add(button.dataset.graphExample)));
  $('graphZoomIn').addEventListener('click', () => {zoom(.5); openScreen('graph');}); $('graphZoomOut').addEventListener('click', () => {zoom(2); openScreen('graph');}); $('graphReset').addEventListener('click', () => {view = {x:0,y:0,span:20,yspan:20}; traceX = null; openScreen('graph'); request(); save();});
  $('graphAngle').value = angle; $('graphAngle').addEventListener('change', event => {angle = event.target.value; scientific.setAngle(angle); $('graphAngleStatus').textContent = angle.toUpperCase(); request(); save();});
  $('graphAngleStatus').textContent = angle.toUpperCase();
  $('graphParameter').value = parameter; $('parameterValue').textContent = compact(parameter);
  $('graphParameter').addEventListener('input', event => {parameter = Number(event.target.value); $('parameterValue').textContent = compact(parameter); request(); save();});
  $('traceForm').addEventListener('submit', event => {
    event.preventDefault(); const x = Number($('traceInput').value);
    if (!$('traceInput').value.trim() || !Number.isFinite(x) || Math.abs(x) > 1e10) {$('traceMessage').textContent = 'Enter a number between −10000000000 and 10000000000.'; $('traceInput').setAttribute('aria-invalid','true'); return;}
    $('traceMessage').textContent = ''; $('traceInput').setAttribute('aria-invalid','false');
    traceX = x; openScreen('trace'); const b = bounds(); if (x < b.xmin || x > b.xmax) view.x = x; request(); save();
  });
  $('graphExport').addEventListener('click', () => {
    draw(); canvas.toBlob(blob => {if (!blob) return; const link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = 'gregle-graph.png'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);});
  });
  const screenPanels = {calculate:'scientificScreen', equations:'graphEquations', window:'graphWindowMenu', zoom:'graphZoomMenu', mode:'graphModeMenu', math:'graphMathMenu', table:'graphTableWrap'};
  const screenHints = {calculate:'ENTER: calculate · ↑↓: history · 2nd ENTER: recall', graph:'Arrows: pan · ENTER: trace', equations:'↑↓ function · ←→ cursor · ENTER: graph', window:'↑↓ field · ENTER: apply · CLEAR: back', zoom:'↑↓ choose · ENTER: select', trace:'←→ trace · ↑↓ curve · CLEAR: back', mode:'↑↓ setting · ←→ change · CLEAR: back', math:'↑↓ choose · ENTER: insert', table:'↑↓ row · ←→ columns · CLEAR: back'};
  const traceable = () => equations.filter(e => e.enabled && e.compiled);
  const keyButtons = Array.from(document.querySelectorAll('#graphKeyboard [data-graph-insert]'));
  function renderKeyModes() {
    $('graphSecond').setAttribute('aria-pressed',String(second));
    $('graphAlpha').setAttribute('aria-pressed',String(alpha));
    $('graphKeyboard').classList.toggle('is-alpha',alpha);
    $('graphKeypadHeading').textContent = alpha ? 'Alphabet keypad' : 'Scientific keypad';
    for (const button of keyButtons) {
      if (button.dataset.normalHtml === undefined) {
        button.dataset.normalHtml = button.innerHTML;
        button.dataset.normalAria = button.getAttribute('aria-label') || button.textContent.trim();
      }
      button.innerHTML = button.dataset.normalHtml;
      let aria = button.dataset.normalAria;
      if (button.dataset.calcInsert) {
        button.textContent = editTarget === 'calculate' ? button.dataset.calcLabel : button.dataset.graphLabel;
        aria = editTarget === 'calculate' ? button.dataset.calcAria : button.dataset.graphInsert === 'x' ? 'Variable x' : 'Parameter a';
      }
      if (second && button.dataset.secondInsert) {
        const label = button.querySelector('span');
        if (label) label.textContent = button.dataset.secondLabel; else button.textContent = button.dataset.secondLabel;
        aria = button.dataset.secondLabel;
      }
      if (alpha) {button.textContent = button.dataset.alphaLabel; aria = button.dataset.alphaAria;}
      button.setAttribute('aria-label',aria);
    }
    scientific.setKeyMode(alpha ? 'alpha' : second ? 'second' : 'normal');
    $('graphScreenTitle').textContent = `${alpha ? 'ALPHA ' : second ? '2nd ' : ''}${screen === 'equations' ? 'Y=' : screen === 'calculate' ? 'HOME' : screen.toUpperCase()}`;
    $('graphScreenHint').textContent = alpha ? 'A–Z: type · ALPHA: return to numbers' : screenHints[screen];
  }
  function setSecond(value) {second = value; if (value) alpha = false; renderKeyModes();}
  function setAlpha(value) {alpha = value; if (value) second = false; renderKeyModes();}
  const numericFields = ['graphXmin','graphXmax','graphYmin','graphYmax','traceInput'].map($);
  function editNumber(value,action) {
    const field = activeNumberInput; if (!field) return;
    value = value.replace(/[−–]/g,'-');
    let start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? start;
    if (action === 'clear') {start = 0; end = field.value.length;}
    else if (action === 'backspace' && start === end) start = Math.max(0,start - 1);
    else if (action === 'delete' && start === end) end = Math.min(field.value.length,end + 1);
    if (field.value.length - (end-start) + value.length > 32) return;
    field.setRangeText(value,start,end,'end'); field.setAttribute('aria-invalid','false'); field.focus({preventScroll:true});
  }
  for (const field of numericFields) {
    scientific.prepareInput(field);
    field.addEventListener('focus',() => {activeNumberInput = field;});
    field.addEventListener('keydown',event => {
      if (event.key === 'Enter') {event.preventDefault(); $(field.id === 'traceInput' ? 'traceForm' : 'graphWindowForm').requestSubmit();}
      else scientific.handleReadonlyKey(event,editNumber);
    });
  }
  function openScreen(next, focus = true) {
    if ((next === 'mode' || next === 'math') && screen !== 'mode' && screen !== 'math') menuReturn = screen;
    if (next === 'calculate') editTarget = 'calculate';
    else if (!['mode','math'].includes(next)) editTarget = 'equations';
    screen = next; menuIndex = 0; tableVisible = next === 'table';
    for (const [name,id] of Object.entries(screenPanels)) $(id).hidden = name !== next;
    canvas.hidden = Boolean(screenPanels[next]);
    $('graphScreenTitle').textContent = next === 'equations' ? 'Y=' : next.toUpperCase();
    $('graphScreenHint').textContent = screenHints[next];
    document.querySelectorAll('[data-graph-menu]').forEach(button => {
      const selected = button.dataset.graphMenu === next;
      if (button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', String(selected));
      if (button.dataset.graphMenu === 'trace') button.setAttribute('aria-pressed', String(selected));
    });
    $('graphReadout').hidden = editTarget === 'calculate';
    $('graphFunctionStatus').textContent = editTarget === 'calculate' ? 'REAL' : 'FUNCTION';
    $('graphKeypadTarget').textContent = editTarget === 'calculate' ? 'Scientific calculation' : activeEquation ? `Editing equation ${activeEquation.id}` : 'Tap a key to add an expression';
    if (next !== 'window') activeNumberInput = null;
    renderKeyModes();
    if (next === 'window') {const b = bounds(); for (const name of ['xmin','xmax','ymin','ymax']) $(`graph${name[0].toUpperCase()}${name.slice(1)}`).value = compact(b[name]); $('graphWindowError').textContent = ''; activeNumberInput = $('graphXmin');}
    if (next === 'trace') {if (traceX === null) traceX = view.x; traceEquation = Math.min(traceEquation, Math.max(0, traceable().length - 1)); followTrace();}
    if (next === 'table') {tableRow = 0; drawTable();}
    if (next === 'zoom' || next === 'math' || next === 'mode') highlightMenu();
    if (focus) {
      if (next === 'calculate') $('expression').focus({preventScroll:true});
      else if (next === 'equations' && activeEquation) activeEquation.input.focus({preventScroll:true});
      else if (next === 'window') {$('graphXmin').focus({preventScroll:true}); $('graphXmin').setSelectionRange(0,$('graphXmin').value.length);}
      else $('graphCalculator').focus({preventScroll:true});
    }
    request();
  }
  function menuItems() {
    if (screen === 'mode') return [$('graphAngle'), $('graphParameter'), $('graphExport'), $('copyResult'), $('clearHistory')];
    return Array.from($(screenPanels[screen])?.querySelectorAll('[data-menu-item]') || []);
  }
  function highlightMenu() {
    menuItems().forEach((item, i) => {item.classList.toggle('is-selected', i === menuIndex); item.setAttribute('aria-current', String(i === menuIndex)); if (i === menuIndex) item.scrollIntoView?.({block:'nearest',inline:'nearest'});});
  }
  function highlightTable() {
    $('graphTable').querySelectorAll?.('tbody tr').forEach((row,i) => row.classList.toggle('is-selected', i === tableRow));
  }
  function followTrace() {
    const curves = traceable(); if (!curves.length) return;
    traceEquation = (traceEquation + curves.length) % curves.length;
    const value = core.safe(fn(curves[traceEquation]), traceX), b = bounds();
    if (traceX < b.xmin || traceX > b.xmax) view.x = traceX;
    if (Number.isFinite(value) && (value < b.ymin || value > b.ymax)) view.y = Math.max(-1e10,Math.min(1e10,value));
    $('traceInput').value = compact(traceX); request(); save();
  }
  document.addEventListener('gregle-calc-release-second',() => setSecond(false));
  function navigate(direction) {
    const recall = second && direction === 'enter' && screen === 'calculate' && !activeNumberInput && !scientific.hasError();
    setSecond(false);
    if (recall) {scientific.recallEntry(); return;}
    const vertical = direction === 'up' || direction === 'down', delta = direction === 'up' || direction === 'left' ? -1 : 1;
    if (activeNumberInput?.id === 'traceInput') {
      if (direction === 'enter') $('traceForm').requestSubmit();
      else {const field = activeNumberInput, pos = Math.max(0,Math.min(field.value.length,field.selectionStart + delta)); field.setSelectionRange(pos,pos); field.focus({preventScroll:true});}
    }
    else if (screen === 'calculate') {scientific.navigate(direction);}
    else if (screen === 'equations') {
      if (direction === 'enter') {openScreen('graph'); return;}
      if (!equations.length) {add(); return;}
      const index = Math.max(0,equations.indexOf(activeEquation));
      if (vertical) {
        const equation = equations[(index + delta + equations.length) % equations.length]; activateEquation(equation); equation.input.focus({preventScroll:true}); equation.row.scrollIntoView?.({block:'nearest'});
      } else {
        const input = activeEquation.input, position = Math.max(0,Math.min(input.value.length,input.selectionStart + delta)); input.setSelectionRange(position,position); input.focus({preventScroll:true});
      }
    } else if (screen === 'window') {
      if (direction === 'enter') {$('graphWindowForm').requestSubmit(); return;}
      const fields = ['graphXmin','graphXmax','graphYmin','graphYmax'].map($), index = Math.max(0,fields.indexOf(activeNumberInput));
      if (vertical) {const field = fields[(index + delta + 4) % 4]; activeNumberInput = field; field.focus({preventScroll:true}); field.setSelectionRange(0,field.value.length);}
      else {fields[index].value = Number(((Number(fields[index].value) || 0) + delta).toPrecision(12)); fields[index].focus({preventScroll:true});}
    } else if (screen === 'zoom' || screen === 'math' || screen === 'mode') {
      const items = menuItems(); if (!items.length) return;
      if (direction === 'enter') {
        const item = items[menuIndex];
        if (screen === 'mode' && menuIndex < 2) item.focus({preventScroll:true}); else item.click();
      } else if (screen === 'mode' && !vertical) {
        if (menuIndex === 0) {$('graphAngle').value = angle === 'rad' ? 'deg' : 'rad'; $('graphAngle').dispatchEvent(new Event('change'));}
        else if (menuIndex === 1) {$('graphParameter').value = Math.max(-10,Math.min(10,Number((parameter + delta * .1).toFixed(1)))); $('graphParameter').dispatchEvent(new Event('input'));}
      } else {menuIndex = (menuIndex + delta + items.length) % items.length; highlightMenu();}
    } else if (screen === 'table') {
      if (vertical) {tableRow = Math.max(0,Math.min(10,tableRow + delta)); highlightTable(); $('graphTable').querySelectorAll('tbody tr')[tableRow]?.scrollIntoView({block:'nearest',inline:'nearest'});}
      else if (direction === 'enter') {const b = bounds(); traceX = b.xmin + (b.xmax - b.xmin) * tableRow / 10; openScreen('trace');}
      else $('graphTableWrap').scrollBy({left:delta * 100,behavior:'smooth'});
    } else if (screen === 'trace') {
      if (direction === 'enter') {openScreen('graph'); return;}
      if (vertical) traceEquation += delta;
      else traceX = Math.max(-1e10,Math.min(1e10,(traceX ?? view.x) + delta * view.span / 100));
      followTrace(); request();
    } else {
      if (direction === 'enter') {openScreen('trace'); return;}
      if (vertical) view.y -= delta * (bounds().ymax - bounds().ymin) * .05;
      else view.x += delta * view.span * .05;
      clampView(); traceX = null; request(); save();
    }
  }
  document.querySelectorAll('[data-graph-menu]').forEach(button => button.addEventListener('click', () => {
    let next = button.dataset.graphMenu; if (second && next === 'graph') next = 'table';
    setSecond(false); openScreen(next);
  }));
  document.querySelectorAll('[data-graph-nav]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.graphNav)));
  $('graphSecond').addEventListener('click', () => setSecond(!second));
  $('graphAlpha').addEventListener('click', () => setAlpha(!alpha));
  function insertActive(value, action) {
    if (activeNumberInput) {editNumber(value,action); return;}
    if (editTarget === 'calculate') {openScreen('calculate', false); scientific.insert(value, action);}
    else editEquation(value, action);
  }
  $('graphDelete').addEventListener('click', () => insertActive('', 'backspace'));
  $('graphClear').addEventListener('click', () => {setSecond(false); if (activeNumberInput || screen === 'equations' || screen === 'calculate') insertActive('', 'clear'); else {traceX = null; openScreen(screen === 'mode' || screen === 'math' ? menuReturn : 'graph');}});
  $('graphCalculator').addEventListener('pointerdown', event => {if (event.target.closest('[data-graph-nav], #graphDelete, #graphSecond, #graphAlpha')) event.preventDefault();});
  $('graphCalculator').addEventListener('keydown', event => {
    if (event.defaultPrevented || (event.target.tagName === 'BUTTON' && event.key === 'Enter')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {event.preventDefault(); setSecond(false); openScreen('calculate'); return;}
    const direction = {ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Enter:'enter'}[event.key];
    const input = ['INPUT','SELECT'].includes(event.target.tagName);
    if (input && event.key !== 'Enter' && !(screen === 'equations' && ['ArrowUp','ArrowDown'].includes(event.key))) return;
    if (screen === 'window' && event.key === 'Enter') return;
    if (!input && (screen === 'zoom' || screen === 'math') && /^[1-6]$/.test(event.key)) {event.preventDefault(); menuIndex = Number(event.key) - 1; navigate('enter');}
    else if (direction) {event.preventDefault(); navigate(direction);}
    else if (!input && (screen === 'graph' || screen === 'trace')) {
      if (event.key === '+' || event.key === '=') {event.preventDefault(); zoom(.8);}
      else if (event.key === '-') {event.preventDefault(); zoom(1.25);}
      else if (event.key === '0' || event.key === 'Home') {event.preventDefault(); reset();}
    }
  });
  $('graphWindowForm').addEventListener('submit', event => {
    event.preventDefault();
    const [xmin,xmax,ymin,ymax] = ['graphXmin','graphXmax','graphYmin','graphYmax'].map(id => Number($(id).value));
    if (numericFields.slice(0,4).some(field => !field.value.trim()) || ![xmin,xmax,ymin,ymax].every(Number.isFinite) || Math.max(Math.abs(xmin),Math.abs(xmax),Math.abs(ymin),Math.abs(ymax)) > 1e10 || xmax - xmin < 1e-6 || ymax - ymin < 1e-6 || xmax - xmin > 1e8 || ymax - ymin > 1e8) {$('graphWindowError').textContent = 'Use increasing ranges between 0.000001 and 100000000, within ±10000000000.'; return;}
    view = {x:(xmin+xmax)/2,y:(ymin+ymax)/2,span:xmax-xmin,yspan:ymax-ymin}; traceX = null; save(); openScreen('graph');
  });
  document.querySelectorAll('[data-math-insert]').forEach(button => button.addEventListener('click', () => insertActive(button.dataset.mathInsert)));
  document.querySelectorAll('[data-graph-preset]').forEach(button => button.addEventListener('click', () => {
    const preset = button.dataset.graphPreset;
    if (preset === 'trig') view = {x:0,y:0,span:angle === 'deg' ? 720 : 4*Math.PI,yspan:4};
    if (preset === 'square') delete view.yspan;
    if (preset === 'fit') {
      const values = []; const b = bounds();
      for (const equation of traceable()) for (let i=0;i<=200;i++) {const value=core.safe(fn(equation),b.xmin+(b.xmax-b.xmin)*i/200); if (Number.isFinite(value) && Math.abs(value)<1e10) values.push(value);}
      if (!values.length) {$('graphScreenHint').textContent='No real values to fit. Try another window.'; return;}
      values.sort((a,b)=>a-b); const lo=values[0],hi=values.at(-1),span=Math.max(2,hi-lo);
      view.y=(lo+hi)/2; view.yspan=span*1.15; clampView();
    }
    traceX=null; save(); openScreen('graph');
  }));

  equations.forEach(e => makeEquation(e)); $('addEquation').disabled = equations.length >= 8;
  new ResizeObserver(request).observe(stage);
  new MutationObserver(request).observe(document.documentElement, {attributes: true, attributeFilter: ['class']});
  window.GregleCalculator = {openScreen,getScreen:() => screen};
  const requested = new URLSearchParams(window.location.search).get('mode');
  const initial = scientific.initialScreen;
  openScreen(initial && (screenPanels[initial] || ['graph','trace'].includes(initial)) ? initial : requested === 'graph' ? 'graph' : 'calculate', false);
  request();
})();
