(function (root) {
  'use strict';
  const calculator = typeof module !== 'undefined' && module.exports ? require('./calc-core.js') : root.GregleCalc;
  function compile(expression) {
    const source = String(expression).trim().replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
    if (!source) throw Error('Enter a function of x.');
    const fn = calculator.compile(source, {variables: ['x', 'a'], relativePercent: false});
    return (x, {angle = 'rad', a = 1} = {}) => fn({x, a, angle});
  }
  const safe = (fn, x) => { try {const y = fn(x); return Number.isFinite(y) ? y : NaN;} catch (_) {return NaN;} };
  function tickStep(span, pixels) {
    const target = span / Math.max(2, pixels / 80), power = 10 ** Math.floor(Math.log10(target));
    const ratio = target / power;
    return (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
  }
  function paths(fn, {xmin, xmax, ymin, ymax, width = 800, height = 500}) {
    const result = []; let current = [], remaining = 32;
    const yscale = height / (ymax - ymin), steps = Math.max(80, Math.min(1800, Math.ceil(width)));
    const breakPath = () => {if (current.length > 1) result.push(current); current = [];};
    const push = (x, y) => {
      if (!Number.isFinite(y) || y < ymin - 3 * (ymax - ymin) || y > ymax + 3 * (ymax - ymin)) {breakPath(); return;}
      if (!current.length || current[current.length - 1][0] !== x) current.push([x, y]);
    };
    function segment(ax, ay, bx, by, depth) {
      if (--remaining < 0) {breakPath(); return;}
      const mx = (ax + bx) / 2, my = safe(fn, mx);
      const valid = Number.isFinite(ay) && Number.isFinite(by) && Number.isFinite(my);
      const error = valid ? Math.abs(my - (ay + by) / 2) * yscale : Infinity;
      const jump = valid ? Math.abs(by - ay) * yscale : Infinity;
      const offscreen = valid && ((ay > ymax && my > ymax && by > ymax) || (ay < ymin && my < ymin && by < ymin));
      if (offscreen) {breakPath(); return;}
      if ((!valid || error > 1 || jump > height * .6) && depth < 8) {
        // Skip intervals outside a function's real domain without excessive recursion.
        if (!Number.isFinite(ay) && !Number.isFinite(by) && !Number.isFinite(my)) {breakPath(); return;}
        segment(ax, ay, mx, my, depth + 1); segment(mx, my, bx, by, depth + 1); return;
      }
      if (!valid || (error > 4 && jump > height * .6)) {breakPath(); return;}
      // Discontinuous step functions must not acquire artificial connecting lines.
      if (depth === 8 && jump > 3 && error > 1) {breakPath(); return;}
      push(ax, ay); push(bx, by);
    }
    let ax = xmin, ay = safe(fn, ax);
    for (let i = 1; i <= steps; i++) {
      const bx = xmin + (xmax - xmin) * i / steps, by = safe(fn, bx);
      remaining = 32; segment(ax, ay, bx, by, 0); ax = bx; ay = by;
    }
    breakPath(); return result;
  }
  const api = {compile, safe, tickStep, paths};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GregleGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
