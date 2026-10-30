(function (root) {
  'use strict';
  const functions = new Set(['sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'abs', 'exp', 'floor', 'ceil', 'round', 'sign']);
  function compile(expression, {variables = [], relativePercent = true} = {}) {
    const text = String(expression).replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt');
    if (!text.trim()) return () => 0;
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
    const node = (run, percent = false) => ({run, percent});
    function finite(value) {
      if (!Number.isFinite(value)) throw Error('This calculation has no finite real result.');
      return value;
    }
    function sum() {
      let left = product();
      while (peek() === '+' || peek() === '-') {
        const op = tokens[index++].type, right = product(), previous = left;
        left = node(c => {
          const value = previous.run(c), amount = right.run(c) * (relativePercent && right.percent ? value : 1);
          return finite(op === '+' ? value + amount : value - amount);
        });
      }
      return left;
    }
    function product() {
      let left = unary();
      while (peek() === '*' || peek() === '/' || ['number', 'name', '('].includes(peek())) {
        const op = peek() === '*' || peek() === '/' ? tokens[index++].type : '*';
        const right = unary(), previous = left;
        left = node(c => {
          const a = previous.run(c), b = right.run(c);
          if (op === '/' && b === 0) throw Error('Cannot divide by zero.');
          return finite(op === '*' ? a * b : a / b);
        });
      }
      return left;
    }
    function unary() {
      if (++depth > 50) throw Error('This calculation is too deeply nested.');
      let value;
      if (take('+')) value = unary();
      else if (take('-')) { const right = unary(); value = node(c => -right.run(c), right.percent); }
      else value = power();
      depth--;
      return value;
    }
    function power() {
      const left = postfix();
      if (take('^')) { const right = unary(); return node(c => finite(Math.pow(left.run(c), right.run(c)))); }
      return left;
    }
    function postfix() {
      let value = primary();
      while (peek() === '%' || peek() === '!') {
        const previous = value;
        if (take('%')) value = node(c => previous.run(c) / 100, true);
        else {
          index++;
          value = node(c => {
            const x = previous.run(c);
            if (!Number.isInteger(x) || x < 0 || x > 170) throw Error('Factorial needs a whole number from 0 to 170.');
            let result = 1;
            for (let n = 2; n <= x; n++) result *= n;
            return finite(result);
          });
        }
      }
      return value;
    }
    function primary() {
      const token = tokens[index++];
      if (!token) throw Error('Finish the calculation first.');
      if (token.type === 'number') { const value = finite(Number(token.value)); return node(() => value); }
      if (token.type === '(') {
        const value = sum();
        if (!take(')')) throw Error('Add a closing bracket.');
        return value;
      }
      if (token.type === 'name') {
        if (token.value === 'pi') return node(() => Math.PI);
        if (token.value === 'e') return node(() => Math.E);
        if (token.value === 'ans') return node(c => finite(c.ans ?? 0));
        if (variables.includes(token.value)) return node(c => finite(c[token.value] ?? 0));
        if (!functions.has(token.value)) throw Error(variables.length ? 'Unknown name. Use x, a, pi or a function such as sin(x).' : 'Unknown function. Try sin, cos, tan, sqrt, ln or log.');
        if (!take('(')) throw Error('Put the function’s value in brackets.');
        const argument = sum();
        if (!take(')')) throw Error('Add a closing bracket.');
        const operations = {
          sqrt: Math.sqrt, ln: Math.log, log: Math.log10, abs: Math.abs, exp: Math.exp,
          floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
        };
        return node(c => {
          const x = argument.run(c), deg = (c.angle || 'deg') === 'deg';
          const radians = deg ? x * Math.PI / 180 : x, inverse = deg ? 180 / Math.PI : 1;
          let result;
          if (token.value === 'tan' && Math.abs(Math.cos(radians)) < 1e-14) throw Error('Tangent is undefined at this angle.');
          switch (token.value) {
            case 'sin': result = Math.sin(radians); break;
            case 'cos': result = Math.cos(radians); break;
            case 'tan': result = Math.tan(radians); break;
            case 'asin': result = Math.asin(x) * inverse; break;
            case 'acos': result = Math.acos(x) * inverse; break;
            case 'atan': result = Math.atan(x) * inverse; break;
            default: result = operations[token.value](x);
          }
          return finite(result);
        });
      }
      throw Error('Check the numbers and symbols in your calculation.');
    }
    const result = sum();
    if (index !== tokens.length) throw Error('Check the brackets in your calculation.');
    return (context = {}) => finite(result.run(context));
  }
  const evaluate = (expression, options = {}) => compile(expression)(options);
  const format = value => Object.is(value, -0) || value === 0 ? '0' : Number(value.toPrecision(14)).toString();
  const api = {evaluate, compile, format};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GregleCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
