(() => {
  'use strict';
  const $ = id => document.getElementById(id), core = window.GregleGraph;
  const canvas = $('graphCanvas'), ctx = canvas.getContext('2d'), stage = $('graphStage');
  const colours = ['#9850ff', '#159a91', '#e36d37', '#3d8ee9', '#db518c', '#a29a22', '#a26643', '#708090'];
  let equations = [], angle = 'rad', parameter = 1, view = {x: 0, y: 0, span: 20}, traceX = null;
  let width = 1, height = 1, frame = 0, saveTimer, counter = 0, tableVisible = false;
  const pointers = new Map(); let gesture = null, moved = false;
  try {
    const saved = JSON.parse(localStorage.getItem('gregle-calc-graph') || 'null');
    if (saved && Array.isArray(saved.equations)) {
      equations = saved.equations.filter(e => e && typeof e.expression === 'string').slice(0, 8).map(e => ({expression: e.expression.slice(0, 300), enabled: e.enabled !== false, colour: colours.includes(e.colour) ? e.colour : colours[0]}));
      angle = saved.angle === 'deg' ? 'deg' : 'rad';
      parameter = Number.isFinite(saved.parameter) ? Math.min(10, Math.max(-10, saved.parameter)) : 1;
      if (saved.view && [saved.view.x, saved.view.y, saved.view.span].every(Number.isFinite) && saved.view.span >= .000001 && saved.view.span <= 1e8 && Math.abs(saved.view.x) <= 1e10 && Math.abs(saved.view.y) <= 1e10) view = saved.view;
    }
  } catch (_) {}
  if (!equations.length) equations = [{expression: 'sin(x)', enabled: true, colour: colours[0]}, {expression: 'x^2 / 4 - 2', enabled: true, colour: colours[1]}];
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {localStorage.setItem('gregle-calc-graph', JSON.stringify({equations: equations.map(({expression, enabled, colour}) => ({expression, enabled, colour})), angle, parameter, view}));} catch (_) {}
    }, 180);
  }
  function bounds() {
    const yspan = view.span * height / width;
    return {xmin: view.x - view.span / 2, xmax: view.x + view.span / 2, ymin: view.y - yspan / 2, ymax: view.y + yspan / 2, width, height};
  }
  const px = x => (x - view.x) * width / view.span + width / 2;
  const py = y => height / 2 - (y - view.y) * width / view.span;
  const world = (x, y) => ({x: view.x + (x - width / 2) * view.span / width, y: view.y - (y - height / 2) * view.span / width});
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
  function makeEquation(equation, focus = false) {
    const id = ++counter, row = document.createElement('div'); row.className = 'graph-equation'; row.style.setProperty('--curve', equation.colour);
    const top = document.createElement('div'); top.className = 'equation-main';
    const visible = document.createElement('button'); visible.type = 'button'; visible.className = 'curve-toggle';
    visible.setAttribute('aria-label', `Show equation ${id}`); visible.setAttribute('aria-pressed', String(equation.enabled)); visible.title = 'Show or hide curve';
    const label = document.createElement('label'); label.className = 'sr-only'; label.htmlFor = `equation-${id}`; label.textContent = `Equation ${id}`;
    const input = document.createElement('input'); input.id = `equation-${id}`; input.type = 'text'; input.value = equation.expression; input.placeholder = 'y = f(x)'; input.maxLength = 300; input.autocomplete = 'off'; input.spellcheck = false; input.autocapitalize = 'off';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-equation'; remove.textContent = '×'; remove.title = 'Remove equation'; remove.setAttribute('aria-label', `Remove equation ${id}`);
    const status = document.createElement('p'); status.className = 'equation-status'; status.id = `equation-status-${id}`; status.setAttribute('aria-live', 'polite'); input.setAttribute('aria-describedby', status.id);
    top.append(visible, label, input, remove); row.append(top, status); $('equationList').append(row);
    Object.assign(equation, {row, input, status}); compile(equation);
    input.addEventListener('input', () => {equation.expression = input.value; compile(equation); request(); save();});
    input.addEventListener('keydown', event => {if (event.key === 'Enter') {event.preventDefault(); canvas.focus();}});
    visible.addEventListener('click', () => {equation.enabled = !equation.enabled; visible.setAttribute('aria-pressed', String(equation.enabled)); request(); save();});
    remove.addEventListener('click', () => {
      const position = equations.indexOf(equation); equations.splice(position, 1); row.remove(); $('addEquation').disabled = false;
      (equations[Math.min(position, equations.length - 1)]?.input || $('addEquation')).focus(); request(); save();
    });
    if (focus) input.focus();
  }
  function add(expression = '') {
    if (equations.length >= 8) return;
    const colour = colours.find(c => !equations.some(e => e.colour === c)) || colours[equations.length % colours.length];
    const equation = {expression, enabled: true, colour}; equations.push(equation); makeEquation(equation, true);
    $('addEquation').disabled = equations.length >= 8; request(); save();
  }
  function request() { if (!frame) frame = requestAnimationFrame(draw); }
  function drawGrid(b) {
    const dark = document.documentElement.classList.contains('dark-mode');
    ctx.fillStyle = dark ? '#242424' : '#ffffff'; ctx.fillRect(0, 0, width, height);
    const step = core.tickStep(view.span, width), minor = step / 5;
    function grid(spacing, colour) {
      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = 1;
      for (let x = Math.ceil(b.xmin / spacing) * spacing, n = 0; x <= b.xmax && n < 400; x += spacing, n++) {const p = Math.round(px(x)) + .5; ctx.moveTo(p, 0); ctx.lineTo(p, height);}
      for (let y = Math.ceil(b.ymin / spacing) * spacing, n = 0; y <= b.ymax && n < 400; y += spacing, n++) {const p = Math.round(py(y)) + .5; ctx.moveTo(0, p); ctx.lineTo(width, p);}
      ctx.stroke();
    }
    grid(minor, dark ? '#2c2c2c' : '#f3f2f6'); grid(step, dark ? '#3b3b3b' : '#e6e3eb');
    ctx.beginPath(); ctx.strokeStyle = dark ? '#8b8493' : '#8d8797'; ctx.lineWidth = 1.25;
    ctx.moveTo(px(0), 0); ctx.lineTo(px(0), height); ctx.moveTo(0, py(0)); ctx.lineTo(width, py(0)); ctx.stroke();
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = dark ? '#b5adbe' : '#746c7e';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const labelY = Math.max(5, Math.min(height - 19, py(0) + 6));
    for (let x = Math.ceil(b.xmin / step) * step, n = 0; x <= b.xmax && n < 80; x += step, n++) if (Math.abs(x / step) > .001) ctx.fillText(compact(x), Math.max(20, Math.min(width - 20, px(x))), labelY);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const labelX = Math.max(6, Math.min(width - 45, px(0) + 8));
    for (let y = Math.ceil(b.ymin / step) * step, n = 0; y <= b.ymax && n < 80; y += step, n++) if (Math.abs(y / step) > .001) ctx.fillText(compact(y), labelX, Math.max(10, Math.min(height - 10, py(y))));
    ctx.fillText('0', Math.max(5, Math.min(width - 15, px(0) + 7)), Math.max(12, Math.min(height - 12, py(0) + 13)));
    ctx.fillStyle = dark ? '#d8d1e0' : '#655a73'; ctx.font = 'italic 12px system-ui';
    ctx.fillText('x', width - 15, Math.max(13, Math.min(height - 14, py(0) - 12))); ctx.fillText('y', Math.max(10, Math.min(width - 15, px(0) - 17)), 13);
  }
  function updateTrace() {
    $('traceValues').replaceChildren();
    if (traceX === null) { $('traceX').textContent = 'Tap the graph to inspect a point'; return; }
    $('traceX').textContent = `x = ${compact(traceX)}`;
    for (const e of equations.filter(e => e.enabled && e.compiled)) {
      const y = core.safe(fn(e), traceX), chip = document.createElement('span'); chip.style.setProperty('--curve', e.colour); chip.className = 'trace-chip';
      chip.textContent = `y = ${Number.isFinite(y) ? compact(y) : 'undefined'}`; chip.title = e.expression; $('traceValues').append(chip);
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
      for (const e of equations.filter(e => e.enabled && e.compiled)) {
        const y = core.safe(fn(e), traceX);
        if (Number.isFinite(y) && y >= b.ymin && y <= b.ymax) {ctx.beginPath(); ctx.arc(px(traceX), py(y), 4.5, 0, 2 * Math.PI); ctx.fillStyle = e.colour; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = document.documentElement.classList.contains('dark-mode') ? '#242424' : '#fff'; ctx.stroke();}
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
  }
  function clampView() {view.span = Math.max(1e-6, Math.min(1e8, view.span)); view.x = Math.max(-1e10, Math.min(1e10, view.x)); view.y = Math.max(-1e10, Math.min(1e10, view.y));}
  function zoom(factor, x = width / 2, y = height / 2) {
    const before = world(x, y); view.span *= factor; clampView(); const after = world(x, y);
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
    view.span = gesture.distance > 0 && distance > 0 ? gesture.view.span * gesture.distance / distance : gesture.view.span; clampView();
    view.x = gesture.anchor.x - (center.x - width / 2) * view.span / width; view.y = gesture.anchor.y + (center.y - height / 2) * view.span / width;
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
  canvas.addEventListener('keydown', event => {
    const amount = view.span * (event.shiftKey ? .2 : .05);
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); if (event.key === 'ArrowLeft') view.x -= amount; if (event.key === 'ArrowRight') view.x += amount;
      if (event.key === 'ArrowUp') view.y += amount; if (event.key === 'ArrowDown') view.y -= amount;
      clampView(); request(); save();
    } else if (event.key === '+' || event.key === '=') {event.preventDefault(); zoom(.8);}
    else if (event.key === '-') {event.preventDefault(); zoom(1.25);}
    else if (event.key === '0' || event.key === 'Home') {event.preventDefault(); reset();}
  });
  $('addEquation').addEventListener('click', () => add());
  document.querySelectorAll('[data-graph-example]').forEach(button => button.addEventListener('click', () => add(button.dataset.graphExample)));
  $('graphZoomIn').addEventListener('click', () => zoom(.8)); $('graphZoomOut').addEventListener('click', () => zoom(1.25)); $('graphReset').addEventListener('click', reset);
  $('graphAngle').value = angle; $('graphAngle').addEventListener('change', event => {angle = event.target.value; request(); save();});
  $('graphParameter').value = parameter; $('parameterValue').textContent = compact(parameter);
  $('graphParameter').addEventListener('input', event => {parameter = Number(event.target.value); $('parameterValue').textContent = compact(parameter); request(); save();});
  $('traceForm').addEventListener('submit', event => {
    event.preventDefault(); const x = Number($('traceInput').value);
    if (!Number.isFinite(x) || Math.abs(x) > 1e10) return;
    traceX = x; const b = bounds(); if (x < b.xmin || x > b.xmax) view.x = x; request(); save();
  });
  $('tableToggle').addEventListener('click', () => {tableVisible = !tableVisible; $('graphTableWrap').hidden = !tableVisible; $('tableToggle').setAttribute('aria-expanded', String(tableVisible)); request();});
  $('graphExport').addEventListener('click', () => {
    draw(); canvas.toBlob(blob => {if (!blob) return; const link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = 'gregle-graph.png'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);});
  });
  document.querySelectorAll('[data-calc-mode]').forEach(button => button.addEventListener('click', () => {
    const graph = button.dataset.calcMode === 'graph'; $('graphPanel').hidden = !graph; $('arithmeticPanel').hidden = graph;
    document.querySelectorAll('[data-calc-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    $('calcPage').classList.toggle('graphing-active', graph); $('calcHelp').hidden = graph;
    if (graph) request();
  }));
  equations.forEach(e => makeEquation(e)); $('addEquation').disabled = equations.length >= 8;
  new ResizeObserver(request).observe(stage);
  new MutationObserver(request).observe(document.documentElement, {attributes: true, attributeFilter: ['class']});
  request();
})();
