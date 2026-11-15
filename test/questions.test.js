const test = require("node:test");
const assert = require("node:assert/strict");
const { fromStructured, problemWith, shuffleOptions, dedupe, hasPositionalOption } = require("../src/lib/questions");

const raw = (over = {}) => ({
  text: "What is 12 divided by 4?",
  options: { option1: "3", option2: "4", option3: "6", option4: "8" },
  correctOptionKey: "option1", explanation: "12 / 4 = 3.", subtopic: "Division", ...over,
});

test("the answer key (option1..4) becomes the right index", () => {
  assert.equal(fromStructured(raw()).correctIndex, 0);
  assert.equal(fromStructured(raw({ correctOptionKey: "option4" })).correctIndex, 3);
  assert.equal(fromStructured(raw({ correctOptionKey: "nope" })).correctIndex, -1);
});

test("valid questions pass, broken ones are rejected with a reason", () => {
  assert.equal(problemWith(fromStructured(raw())), "");
  assert.match(problemWith(fromStructured(raw({ text: "Hi?" }))), /too short/);
  assert.match(problemWith(fromStructured(raw({ options: { option1: "3", option2: "3", option3: "6", option4: "8" } }))), /duplicate/);
  assert.match(problemWith(fromStructured(raw({ options: { option1: "3", option2: " ", option3: "6", option4: "8" } }))), /empty option/);
  assert.match(problemWith(fromStructured(raw({ correctOptionKey: "x" }))), /correct option/);
  assert.match(problemWith(fromStructured(raw({ explanation: "" }))), /explanation/);
  assert.match(problemWith({ text: "A long enough question?", options: ["a", "b", "c"], correctIndex: 0, explanation: "x" }), /4 options/);
});

test("duplicate options are caught even with different case or spacing", () => {
  assert.match(problemWith(fromStructured(raw({ options: { option1: "Delhi", option2: "delhi ", option3: "Mumbai", option4: "Pune" } }))), /duplicate/);
});

test("shuffling keeps the correct answer attached to its text (500 random runs)", () => {
  const q = fromStructured(raw({ correctOptionKey: "option3" }));      // correct answer = "6"
  const positions = new Set();
  for (let i = 0; i < 500; i++) {
    const s = shuffleOptions(q);
    assert.equal(s.options[s.correctIndex], "6");
    assert.deepEqual([...s.options].sort(), ["3", "4", "6", "8"]);
    positions.add(s.correctIndex);
  }
  assert.equal(positions.size, 4, "the correct answer lands in every position over many shuffles");
});

test("shuffling does not mutate the original question", () => {
  const q = fromStructured(raw());
  const before = JSON.stringify(q);
  shuffleOptions(q, () => 0.1);
  assert.equal(JSON.stringify(q), before);
});

test("options that depend on position are never shuffled", () => {
  for (const odd of ["All of the above", "None of these", "Both A and B", "A and C", "Only B"]) {
    const q = fromStructured(raw({ options: { option1: "x1", option2: "x2", option3: "x3", option4: odd }, correctOptionKey: "option4" }));
    assert.ok(hasPositionalOption(q.options), odd);
    assert.deepEqual(shuffleOptions(q).options, q.options);
  }
  assert.equal(hasPositionalOption(["Article 14", "Article 15", "Article 17", "Article 19"]), false);
});

test("duplicate questions are removed across batches", () => {
  const seen = new Set();
  const a = dedupe([fromStructured(raw()), fromStructured(raw({ text: "  what is 12 DIVIDED by 4?  " }))], seen);
  assert.equal(a.length, 1);
  assert.equal(dedupe([fromStructured(raw())], seen).length, 0);
});
