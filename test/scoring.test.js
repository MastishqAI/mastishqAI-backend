const test = require("node:test");
const assert = require("node:assert/strict");
const { passMarkFor, computeResult, marksLostBySubtopic, STAGES } = require("../src/lib/scoring");

const qs = (flags, extra = {}) => flags.map((c, i) => ({ correct: c, selectedIndex: c === null ? -1 : i % 4, timeSec: 10, subtopic: i % 2 ? "B" : "A", ...extra }));

test("pass marks match the old SmartLearn stages (70%, rounded up)", () => {
  assert.equal(passMarkFor(10, 2), 14);   // easy   14/20
  assert.equal(passMarkFor(20, 3), 42);   // medium 42/60
  assert.equal(passMarkFor(40, 4), 112);  // hard  112/160
  assert.equal(passMarkFor(7, 2), 10);    // 70% of 14 = 9.8 -> 10 (always rounds UP)
  assert.equal(passMarkFor(1, 2), 2);
});

test("stage rules are 2 / 3 / 4 marks and unlock in order", () => {
  assert.deepEqual([STAGES.easy.pointsEach, STAGES.medium.pointsEach, STAGES.hard.pointsEach], [2, 3, 4]);
  assert.equal(STAGES.easy.next, "medium"); assert.equal(STAGES.medium.next, "hard"); assert.equal(STAGES.hard.next, null);
});

test("perfect score", () => {
  const r = computeResult({ questions: qs(Array(10).fill(true)), pointsEach: 2, passMark: 14 });
  assert.deepEqual([r.correct, r.wrong, r.score, r.maxScore, r.marksLost, r.accuracy, r.cleared, r.marksToGo], [10, 0, 20, 20, 0, 100, true, 0]);
});

test("exactly at the pass mark clears, one question short does not", () => {
  const at = computeResult({ questions: qs([...Array(7).fill(true), ...Array(3).fill(false)]), pointsEach: 2, passMark: 14 });
  assert.equal(at.score, 14); assert.equal(at.cleared, true); assert.equal(at.marksToGo, 0);
  const below = computeResult({ questions: qs([...Array(6).fill(true), ...Array(4).fill(false)]), pointsEach: 2, passMark: 14 });
  assert.equal(below.score, 12); assert.equal(below.cleared, false); assert.equal(below.marksToGo, 2); assert.equal(below.marksLost, 8);
});

test("skipped questions count as wrong and cost marks", () => {
  const r = computeResult({ questions: qs([true, true, false, null, null]), pointsEach: 3, passMark: 11 });
  assert.equal(r.correct, 2); assert.equal(r.wrong, 3); assert.equal(r.skipped, 2);
  assert.equal(r.score, 6); assert.equal(r.maxScore, 15); assert.equal(r.marksLost, 9);
  assert.equal(r.score + r.marksLost, r.maxScore);
});

test("accuracy rounds and average time is per question", () => {
  const r = computeResult({ questions: qs([true, false, false]), pointsEach: 2, passMark: 5 });
  assert.equal(r.accuracy, 33); assert.equal(r.avgTimeSec, 10); assert.equal(r.timeSec, 30);
});

test("the diagnostic always counts as completed", () => {
  const r = computeResult({ questions: qs([false, false]), pointsEach: 1, passMark: 0, isDiagnostic: true });
  assert.equal(r.cleared, true); assert.equal(r.marksToGo, 0);
});

test("no questions does not divide by zero", () => {
  const r = computeResult({ questions: [], pointsEach: 2, passMark: 0 });
  assert.deepEqual([r.accuracy, r.avgTimeSec, r.maxScore], [0, 0, 0]);
});

test("marks lost per topic always add up to total marks lost", () => {
  const questions = qs([true, false, false, true, false, null, false]);
  const r = computeResult({ questions, pointsEach: 4, passMark: 20 });
  const by = marksLostBySubtopic(questions, 4);
  assert.equal(by.reduce((s, x) => s + x.lost, 0), r.marksLost);
  assert.ok(by.every((x, i) => i === 0 || by[i - 1].lost >= x.lost), "sorted largest first");
});
