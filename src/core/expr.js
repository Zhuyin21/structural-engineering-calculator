// A small, safe math-expression compiler for load formulas such as
//   -5*sin(pi*x/L)     or     2*(1 - (x/L)^2)
// It never calls eval. compile() returns a function of the variables.

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs,
  min: Math.min, max: Math.max, pow: Math.pow,
  step: (v) => (v >= 0 ? 1 : 0),        // Heaviside step, handy for partial loads
};
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|[-+*/^(),]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`Unexpected character "${src.slice(pos).trim()[0]}"`);
    if (m[1] !== undefined) out.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] });
    else out.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
    pos = re.lastIndex;
  }
  return out;
}

/**
 * Compile an expression. `variables` lists the names it may use (for example
 * ['x', 'L']). Returns f(values) where values is an object with those names.
 */
export function compile(src, variables = ['x', 'L']) {
  if (typeof src !== 'string' || !src.trim()) throw new Error('The formula is empty');
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const startsPrimary = () => toks[i] && (toks[i].t === 'num' || toks[i].t === 'id' || isOp('('));

  function expr() {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[i++].v, right = term(), l = left;
      left = op === '+' ? (v) => l(v) + right(v) : (v) => l(v) - right(v);
    }
    return left;
  }
  function term() {
    let left = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = toks[i++].v, right = unary(), l = left;
        left = op === '*' ? (v) => l(v) * right(v) : (v) => l(v) / right(v);
      } else if (startsPrimary()) {            // implicit product: 2x, 3(x+1)
        const right = unary(), l = left;
        left = (v) => l(v) * right(v);
      } else return left;
    }
  }
  function unary() {
    if (isOp('-')) { i++; const a = unary(); return (v) => -a(v); }
    if (isOp('+')) { i++; return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp('^')) { i++; const ex = unary(); return (v) => Math.pow(base(v), ex(v)); }
    return base;
  }
  function primary() {
    const tk = peek();
    if (!tk) throw new Error('The formula ends too early');
    if (tk.t === 'num') { i++; return () => tk.v; }
    if (tk.t === 'id') {
      i++;
      const name = tk.v;
      if (Object.hasOwn(FUNCS, name) && isOp('(')) {
        i++;
        const args = [];
        if (!isOp(')')) { args.push(expr()); while (isOp(',')) { i++; args.push(expr()); } }
        if (!isOp(')')) throw new Error(`Missing ")" after ${name}(`);
        i++;
        const fn = FUNCS[name];
        return (v) => fn(...args.map((a) => a(v)));
      }
      if (variables.includes(name)) return (v) => v[name];
      if (Object.hasOwn(CONSTS, name.toLowerCase())) { const c = CONSTS[name.toLowerCase()]; return () => c; }
      if (name === 'log') throw new Error('Use ln(x) or log10(x) instead of log(x)');
      if (Object.hasOwn(FUNCS, name)) throw new Error(`${name} needs brackets, for example ${name}(x)`);
      throw new Error(`Unknown name "${name}". Use ${variables.join(', ')}, pi, and functions like sin()`);
    }
    if (isOp('(')) {
      i++;
      const inner = expr();
      if (!isOp(')')) throw new Error('Missing ")"');
      i++;
      return inner;
    }
    throw new Error(`Unexpected "${tk.v}"`);
  }

  const f = expr();
  if (i < toks.length) throw new Error(`Unexpected "${toks[i].v}"`);
  return f;
}

export const FORMULA_HELP =
  'Use x (position) and L (beam length). Operators + - * / ^. ' +
  'Functions: sin cos tan exp ln log10 sqrt abs min max step. Constant: pi.';
