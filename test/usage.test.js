const test = require("node:test");
const assert = require("node:assert/strict");
const { estimateCost, tokensOf, dayKey, LIMITS } = require("../src/lib/usage");

test("cost estimate follows tokens and the model price", () => {
  // gpt-4o-mini: $0.15 in / $0.60 out per million tokens
  assert.ok(Math.abs(estimateCost("gpt-4o-mini", 1_000_000, 1_000_000) - 0.75) < 1e-9);
  // gpt-4.1: $2 / $8
  assert.ok(Math.abs(estimateCost("gpt-4.1", 10_000, 2_000) - (0.02 + 0.016)) < 1e-9);
  assert.equal(estimateCost("gpt-4o-mini", 0, 0, 0), 0);
});

test("each web search adds a fixed amount", () => {
  const base = estimateCost("gpt-4o-mini", 1000, 500);
  assert.ok(estimateCost("gpt-4o-mini", 1000, 500, 2) - base > 0.04);
});

test("an unknown model is priced like the cheap default, never as free", () => {
  assert.ok(estimateCost("some-future-model", 1_000_000, 0) > 0);
});

test("token counts are read from both OpenAI response shapes", () => {
  assert.deepEqual(tokensOf({ prompt_tokens: 12, completion_tokens: 5 }), { input: 12, output: 5 });   // chat completions
  assert.deepEqual(tokensOf({ input_tokens: 30, output_tokens: 9 }), { input: 30, output: 9 });        // responses API
  assert.deepEqual(tokensOf(undefined), { input: 0, output: 0 });
});

test("the daily limit resets at midnight India time (IST = UTC+5:30)", () => {
  assert.equal(dayKey(Date.parse("2026-11-10T18:29:00Z")), "2026-11-10");   // 23:59 IST
  assert.equal(dayKey(Date.parse("2026-11-10T18:31:00Z")), "2026-11-11");   // 00:01 IST next day
});

test("default limits are sensible and search is the tightest", () => {
  assert.ok(LIMITS.quiz > 0 && LIMITS.chat > 0 && LIMITS.search > 0);
  assert.ok(LIMITS.search <= LIMITS.chat);
});
