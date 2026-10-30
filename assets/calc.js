(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const input = $('expression'), output = $('result'), message = $('calcMessage');
  const {evaluate, format} = window.GregleCalc;
  let ans = 0, completed = false, history = [], angle = 'deg';
  const popout = new URLSearchParams(window.location.search).get('popout') === '1';
  if (popout) {
    $('popoutCalculator').hidden = true;
    try {
      const state = JSON.parse(sessionStorage.getItem('gregle-calc-popout') || 'null');
      sessionStorage.removeItem('gregle-calc-popout');
      if (state && typeof state.expression === 'string' && state.expression.length <= 300) {
        input.value = state.expression;
        ans = Number.isFinite(state.ans) ? state.ans : 0;
        angle = state.angle === 'rad' ? 'rad' : 'deg';
        completed = state.completed === true;
      }
    } catch (_) {}
    $('angleToggle').textContent = angle.toUpperCase();
    $('angleToggle').setAttribute('aria-label', `Angle unit: ${angle === 'deg' ? 'degrees' : 'radians'}. Change to ${angle === 'deg' ? 'radians' : 'degrees'}.`);
  }
  try {
    const saved = JSON.parse(localStorage.getItem('gregle-calc-history') || '[]');
    if (Array.isArray(saved)) history = saved.filter(x => x && typeof x.expression === 'string' && x.expression.length <= 300 && Number.isFinite(x.value)).slice(0, 50);
  } catch (_) {}
  const options = () => ({angle, ans});
  function update() {
    input.removeAttribute('aria-invalid');
    message.textContent = '';
    try {
      output.textContent = format(evaluate(input.value, options()));
      output.dataset.valid = 'true';
    } catch (_) {
      output.textContent = '…';
      output.dataset.valid = 'false';
    }
  }
  function save() { try { localStorage.setItem('gregle-calc-history', JSON.stringify(history)); } catch (_) {} }
  function renderHistory() {
    const list = $('historyList');
    list.replaceChildren();
    $('historyEmpty').hidden = history.length > 0;
    $('clearHistory').disabled = history.length === 0;
    for (const item of history) {
      const li = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      const expression = document.createElement('span'), result = document.createElement('strong');
      expression.textContent = item.expression + (item.angle ? ` · ${item.angle.toUpperCase()}` : '');
      result.textContent = '= ' + format(item.value);
      button.append(expression, result);
      button.title = 'Use this result';
      button.addEventListener('click', () => {
        const value = format(item.value);
        if (!input.value || completed) input.value = value;
        else input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end');
        completed = false;
        update(); input.focus();
      });
      li.append(button); list.append(li);
    }
  }
  function insert(value) {
    if (completed && !/^[+×÷*/^%!)−-]/.test(value)) input.value = '';
    if (completed) input.setSelectionRange(input.value.length, input.value.length);
    completed = false;
    input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end');
    update(); input.focus();
  }
  function clear() { input.value = ''; completed = false; update(); input.focus(); }
  function calculate() {
    if (!input.value.trim()) return;
    try {
      const value = evaluate(input.value, options());
      history.unshift({expression: input.value.trim(), value, angle: /sin|cos|tan/.test(input.value) ? angle : undefined});
      history = history.slice(0, 50); save(); renderHistory();
      ans = value;
      input.value = format(value);
      completed = true;
      output.textContent = format(value); output.dataset.valid = 'true';
      input.removeAttribute('aria-invalid');
      message.textContent = 'Calculated. Result saved to history.';
      input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    } catch (error) {
      message.textContent = error.message;
      input.setAttribute('aria-invalid', 'true');
      output.textContent = '—'; output.dataset.valid = 'false';
    }
  }
  $('calculatorForm').addEventListener('submit', event => {event.preventDefault(); calculate();});
  input.addEventListener('input', () => {completed = false; update();});
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault(); clear();}
    else if (event.key === '=') {event.preventDefault(); calculate();}
    else if (completed && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
      if (/^[0-9.a-zπ(√]$/i.test(event.key)) input.value = '';
      completed = false;
    }
  });
  document.querySelectorAll('[data-insert]').forEach(button => button.addEventListener('click', () => insert(button.dataset.insert)));
  $('clear').addEventListener('click', clear);
  $('backspace').addEventListener('click', () => {
    const start = input.selectionStart, end = input.selectionEnd;
    input.setRangeText('', start === end ? Math.max(0, start - 1) : start, end, 'end');
    completed = false; update(); input.focus();
  });
  $('negate').addEventListener('click', () => {
    const value = input.value.trim();
    input.value = value ? `-(${value})` : '-';
    completed = false; update(); input.focus();
  });
  $('scientificToggle').addEventListener('click', () => {
    const open = $('scientificKeys').hidden;
    $('scientificKeys').hidden = !open;
    $('angleControl').hidden = !open;
    $('scientificToggle').setAttribute('aria-expanded', String(open));
    $('scientificToggle').setAttribute('aria-pressed', String(open));
  });
  $('angleToggle').addEventListener('click', () => {
    angle = angle === 'deg' ? 'rad' : 'deg';
    $('angleToggle').textContent = angle.toUpperCase();
    $('angleToggle').setAttribute('aria-label', `Angle unit: ${angle === 'deg' ? 'degrees' : 'radians'}. Change to ${angle === 'deg' ? 'radians' : 'degrees'}.`);
    update();
  });
  $('copyResult').addEventListener('click', async () => {
    if (output.dataset.valid !== 'true') {message.textContent = 'Finish a valid calculation before copying.'; return;}
    try {await navigator.clipboard.writeText(output.textContent); message.textContent = 'Result copied.';}
    catch (_) {message.textContent = 'Select the result to copy it.'; const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(output); selection.removeAllRanges(); selection.addRange(range);}
  });
  $('clearHistory').addEventListener('click', () => {history = []; save(); renderHistory();});
  $('popoutCalculator').addEventListener('click', () => {
    document.dispatchEvent(new Event('gregle-calc-save-graph'));
    const graph = !$('graphPanel').hidden;
    const url = new URL(window.location.href);
    url.searchParams.set('popout', '1');
    url.searchParams.set('mode', graph ? 'graph' : 'standard');
    const width = Math.min(graph ? 1120 : 560, Math.max(320, screen.availWidth - 40));
    const height = Math.min(860, Math.max(480, screen.availHeight - 60));
    const left = Math.round((screen.availLeft || 0) + (screen.availWidth - width) / 2);
    const top = Math.round((screen.availTop || 0) + (screen.availHeight - height) / 2);
    const state = JSON.stringify({expression: input.value, ans, angle, completed});
    const popup = window.open(url.href, '_blank', `popup=yes,toolbar=no,menubar=no,location=no,status=no,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    if (!popup) {
      $('popoutStatus').textContent = 'The new window was blocked. Allow pop-ups for this site and try again.';
      return;
    }
    $('popoutStatus').textContent = '';
    try {
      popup.sessionStorage.setItem('gregle-calc-popout', state);
      popup.opener = null;
      popup.focus();
    } catch (_) {}
  });
  document.addEventListener('keydown', event => {
    if (document.getElementById('arithmeticPanel')?.hidden) return;
    if (event.target === input || event.ctrlKey || event.metaKey || event.altKey || $('gregleAppMenu')?.open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (/^[0-9.+*/^()%!−×÷-]$/.test(event.key)) {event.preventDefault(); insert(event.key);}
    else if (event.key === 'Enter' && event.target === document.body) {event.preventDefault(); calculate();}
    else if (event.key === 'Escape') clear();
    else if (event.key === 'Backspace') {$('backspace').click(); event.preventDefault();}
  });
  renderHistory(); update();
})();
