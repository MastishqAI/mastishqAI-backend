const test = require("node:test");
const assert = require("node:assert/strict");
const { safeEval, numberFromOption, checkArithmetic } = require("../src/lib/calc");

test("safeEval does arithmetic with the right precedence", () => {
  assert.equal(safeEval("2+3*4"), 14);
  assert.equal(safeEval("(2+3)*4"), 20);
  assert.equal(safeEval("40*(1-0.25)"), 30);
  assert.equal(safeEval("-3+5"), 2);
  assert.equal(safeEval("1000*5/100*3"), 150);
  assert.ok(Math.abs(safeEval("2/3*30/12") - 5 / 3) < 1e-12);
  assert.equal(safeEval("12 ÷ 4"), 3);
  assert.equal(safeEval("6 × 7"), 42);
});

test("safeEval refuses anything that is not plain arithmetic", () => {
  for (const bad of ["", "2+", "(1+2", "1/0", "alert(1)", "process.exit()", "2**3", "1;2", "a+1", "1+2)"]) assert.ok(Number.isNaN(safeEval(bad)), bad);
});

test("numbers are read from option text", () => {
  assert.equal(numberFromOption("$1,150"), 1150);
  assert.equal(numberFromOption("1.5 cups"), 1.5);
  assert.equal(numberFromOption("3/8 cup"), 0.375);
  assert.equal(numberFromOption("1 1/2 cups"), 1.5);
  assert.equal(numberFromOption("25%"), 25);
  assert.equal(numberFromOption("-4"), -4);
  assert.ok(Number.isNaN(numberFromOption("Delhi")));
});

const q = (over) => ({ text: "x", options: ["1.5 cups", "1 cup", "2 cups", "2.5 cups"], correctIndex: 0, explanation: "e", ...over });

test("the cookie question (2/3 cup per 12 cookies, 30 cookies) is rejected: 5/3 is not in the options", () => {
  assert.equal(checkArithmetic(q({ calc: "2/3*30/12" })), null);
});

test("a correct key passes", () => {
  const ok = q({ options: ["$28", "$25", "$35", "$30"], correctIndex: 3, calc: "40*(1-0.25)" });
  assert.equal(checkArithmetic(ok), ok);
});

test("a wrong key is repaired when the formula matches exactly one other option", () => {
  const r = checkArithmetic(q({ options: ["1/8", "1/2", "1/4", "3/8"], correctIndex: 1, calc: "3/4-3/4*1/2" }));
  assert.equal(r.correctIndex, 3); assert.equal(r.repaired, true);
});

test("questions without a formula, or non-numeric ones, are left to the AI check", () => {
  const plain = q({ calc: "" });
  assert.equal(checkArithmetic(plain), plain);
  const words = { ...plain, options: ["Article 14", "Article 15", "Article 17", "Article 19"], calc: "14" };
  assert.equal(checkArithmetic(words).correctIndex, 0);   // 14 matches Article 14 (option 0) which is also the key
  const text = { ...plain, options: ["Delhi", "Mumbai", "Pune", "Agra"], calc: "5+5" };
  assert.equal(checkArithmetic(text), text);
});

test("percent answers compare as plain numbers", () => {
  const r = checkArithmetic(q({ options: ["30%", "15%", "25%", "20%"], correctIndex: 3, calc: "(1200-960)/1200*100" }));
  assert.equal(r.correctIndex, 3); assert.equal(r.repaired, undefined);
});
