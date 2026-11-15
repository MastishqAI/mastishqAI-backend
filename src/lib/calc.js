// Deterministic arithmetic cross-check for numeric questions — no AI involved.
// The question writer supplies `calc` (e.g. "2/3*30/12"); we evaluate it ourselves and compare with the options.

// recursive-descent evaluator: numbers, + - * / and parentheses only (never uses eval)
function safeEval(expr) {
  const s = String(expr ?? "").replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (!s || /[^0-9.+\-*/()]/.test(s)) return NaN;
  let i = 0;
  const peek = () => s[i];
  function number() {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (!m) throw new Error("number expected");
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function factor() {
    if (peek() === "-") { i++; return -factor(); }
    if (peek() === "+") { i++; return factor(); }
    if (peek() === "(") { i++; const v = expression(); if (peek() !== ")") throw new Error("missing )"); i++; return v; }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = s[i++]; const r = factor(); v = op === "*" ? v * r : v / r; }
    return v;
  }
  function expression() {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[i++]; const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  try {
    const v = expression();
    return i === s.length && Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
}

// "$1,150" -> 1150 · "1.5 cups" -> 1.5 · "3/8 cup" -> 0.375 · "1 1/2" -> 1.5 · "25%" -> 25 · "mph" -> NaN
function numberFromOption(text) {
  const t = String(text ?? "").replace(/[−–]/g, "-");
  let m = t.match(/(-?\d+)\s+(\d+)\/(\d+)/);
  if (m) { const w = parseInt(m[1], 10); const f = parseInt(m[2], 10) / parseInt(m[3], 10); return w < 0 || t.trim().startsWith("-") ? w - f : w + f; }
  m = t.match(/(-?\d+)\/(\d+)/);
  if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
  m = t.match(/-?\d[\d,]*(?:\.\d+)?|-?\.\d+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : NaN;
}

const close = (a, b) => Math.abs(a - b) <= 0.005 * Math.max(1, Math.abs(a), Math.abs(b));

// Returns the question (key repaired if the formula points at a different option) or null if the keyed answer cannot be right.
// Questions without a usable formula are passed through unchanged (they still face the AI solver check).
function checkArithmetic(q) {
  if (!q.calc) return q;
  const value = safeEval(q.calc);
  if (Number.isNaN(value)) return q;                                    // unusable formula: don't judge
  const nums = q.options.map(numberFromOption);
  if (nums.every(Number.isNaN)) return q;                               // not a numeric question
  const hits = nums.map((n, i) => (close(n, value) ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 1) return hits[0] === q.correctIndex ? q : { ...q, correctIndex: hits[0], repaired: true };
  return null;                                                          // formula matches no option, or several
}

module.exports = { safeEval, numberFromOption, checkArithmetic };
