(function (root) {
  'use strict';
  const functions = new Set(['sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'abs']);
  function evaluate(expression, {angle = 'deg', ans = 0} = {}) {
    const text = String(expression).replace(/×/g, '*').replace(/[÷]/g, '/').replace(/[−–]/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt');
    if (!text.trim()) return 0;
    if (text.length > 300) throw Error('Keep calculations under 300 characters.');
    const tokens = [];
    let offset = 0;
    while (offset < text.length) {
      if (/\s/.test(text[offset])) { offset++; continue; }
      const rest = text.slice(offset);
      const number = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      const name = rest.match(/^[a-zA-Z]+/);
      const token = number ? number[0] : name ? name[0].toLowerCase() : text[offset];
      if (!number && !name && !'+-*/^()%!'.includes(token)) throw Error('Use numbers and calculator symbols only.');
      tokens.push({type: number ? 'number' : name ? 'name' : token, value: token});
      offset += (number || name) ? (number || name)[0].length : 1;
    }
    let index = 0, depth = 0;
    const peek = () => tokens[index]?.type;
    const take = type => peek() === type ? (index++, true) : false;
    const node = (value, percent = false) => ({value, percent});
    function finite(value) {
      if (!Number.isFinite(value)) throw Error('This calculation has no finite real result.');
      return value;
    }
    function sum() {
      let left = product();
      while (peek() === '+' || peek() === '-') {
        const op = tokens[index++].type, right = product();
        const amount = right.percent ? left.value * right.value : right.value;
        left = node(finite(op === '+' ? left.value + amount : left.value - amount));
      }
      return left;
    }
    function product() {
      let left = unary();
      while (peek() === '*' || peek() === '/' || ['number', 'name', '('].includes(peek())) {
        const op = peek() === '*' || peek() === '/' ? tokens[index++].type : '*';
        const right = unary();
        if (op === '/' && right.value === 0) throw Error('Cannot divide by zero.');
        left = node(finite(op === '*' ? left.value * right.value : left.value / right.value));
      }
      return left;
    }
    function unary() {
      if (++depth > 50) throw Error('This calculation is too deeply nested.');
      let value;
      if (take('+')) value = unary();
      else if (take('-')) { const right = unary(); value = node(-right.value, right.percent); }
      else value = power();
      depth--;
      return value;
    }
    function power() {
      let left = postfix();
      if (take('^')) left = node(finite(Math.pow(left.value, unary().value)));
      return left;
    }
    function postfix() {
      let value = primary();
      while (peek() === '%' || peek() === '!') {
        if (take('%')) value = node(value.value / 100, true);
        else {
          index++;
          if (!Number.isInteger(value.value) || value.value < 0 || value.value > 170) throw Error('Factorial needs a whole number from 0 to 170.');
          let result = 1;
          for (let n = 2; n <= value.value; n++) result *= n;
          value = node(finite(result));
        }
      }
      return value;
    }
    function primary() {
      const token = tokens[index++];
      if (!token) throw Error('Finish the calculation first.');
      if (token.type === 'number') return node(finite(Number(token.value)));
      if (token.type === '(') {
        const value = sum();
        if (!take(')')) throw Error('Add a closing bracket.');
        return value;
      }
      if (token.type === 'name') {
        if (token.value === 'pi') return node(Math.PI);
        if (token.value === 'e') return node(Math.E);
        if (token.value === 'ans') return node(finite(ans));
        if (!functions.has(token.value)) throw Error('Unknown function. Try sin, cos, tan, sqrt, ln or log.');
        if (!take('(')) throw Error('Put the function’s value in brackets.');
        const x = sum().value;
        if (!take(')')) throw Error('Add a closing bracket.');
        const radians = angle === 'deg' ? x * Math.PI / 180 : x;
        const inverse = angle === 'deg' ? 180 / Math.PI : 1;
        if (token.value === 'tan' && Math.abs(Math.cos(radians)) < 1e-14) throw Error('Tangent is undefined at this angle.');
        const results = {
          sqrt: () => Math.sqrt(x), sin: () => Math.sin(radians), cos: () => Math.cos(radians), tan: () => Math.tan(radians),
          asin: () => Math.asin(x) * inverse, acos: () => Math.acos(x) * inverse, atan: () => Math.atan(x) * inverse,
          ln: () => Math.log(x), log: () => Math.log10(x), abs: () => Math.abs(x),
        };
        return node(finite(results[token.value]()));
      }
      throw Error('Check the numbers and symbols in your calculation.');
    }
    const result = sum().value;
    if (index !== tokens.length) throw Error('Check the brackets in your calculation.');
    return finite(result);
  }
  const format = value => Object.is(value, -0) || value === 0 ? '0' : Number(value.toPrecision(14)).toString();
  const api = {evaluate, format};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GregleCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
