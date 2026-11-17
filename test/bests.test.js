const test = require("node:test");
const assert = require("node:assert/strict");
const { personalBests, recordsByTopic, shortName, neighbours } = require("../src/lib/bests");

const at = (iso) => new Date(iso);
const A = (o) => ({ stage: "easy", subject: "Polity", topic: "Indian Polity", score: 10, maxScore: 20, timeSec: 600, questionCount: 10, updatedAt: at("2026-10-12T10:00:00Z"), ...o });

test("bests come from the learner's own stages", () => {
  const b = personalBests([
    A({ score: 18, maxScore: 20, timeSec: 500 }),
    A({ stage: "medium", subject: "Physics", topic: "Motion", score: 60, maxScore: 60, timeSec: 400, updatedAt: at("2026-10-14T10:00:00Z") }),
    A({ score: 12, maxScore: 20, timeSec: 100 }),
  ], { longestStreak: 11, currentStreak: 4 });
  assert.deepEqual([b.bestScore.score, b.bestScore.max, b.bestScore.stage], [60, 60, "Medium"]);
  assert.equal(b.accuracy.pct, 100);
  assert.deepEqual([b.fastest.timeSec, b.fastest.subject], [400, "Physics"]);     // the 100s attempt was not a clean (all-correct) stage
  assert.deepEqual(b.streak, { best: 11, current: 4 });
  assert.equal(b.bestScore.date, "14 Oct");
});

test("no attempts gives empty bests, not zeros", () => {
  const b = personalBests([], {});
  assert.equal(b.bestScore, null); assert.equal(b.accuracy, null); assert.equal(b.fastest, null);
});

test("accuracy ignores tiny stages", () => {
  assert.equal(personalBests([A({ score: 4, maxScore: 4, questionCount: 2 })]).accuracy, null);
});

test("records by topic compare this month with the best earlier result at the same stage", () => {
  const rows = recordsByTopic([
    A({ topic: "Indian Polity", score: 18, maxScore: 25, updatedAt: at("2026-09-20T10:00:00Z") }),
    A({ topic: "Indian Polity", score: 23, maxScore: 25, updatedAt: at("2026-10-12T10:00:00Z") }),
    A({ topic: "Percentages", score: 21, maxScore: 25, updatedAt: at("2026-09-02T10:00:00Z") }),
    A({ topic: "Percentages", score: 21, maxScore: 25, updatedAt: at("2026-10-13T10:00:00Z") }),
    A({ topic: "Cell Biology", score: 9, maxScore: 25, updatedAt: at("2026-10-14T10:00:00Z") }),
    A({ topic: "Old topic", score: 20, maxScore: 25, updatedAt: at("2026-08-14T10:00:00Z") }),
  ], "2026-10");
  const by = Object.fromEntries(rows.map((r) => [r.topic, r]));
  assert.equal(by["Indian Polity"].diff, 5); assert.deepEqual(by["Indian Polity"].was, { score: 18, max: 25 });
  assert.equal(by["Percentages"].diff, 0);
  assert.equal(by["Cell Biology"].was, null); assert.equal(by["Cell Biology"].diff, null);
  assert.equal(by["Old topic"], undefined);
  assert.equal(rows[0].topic, "Cell Biology");                       // most recent first
});

test("other learners are shown as first name and last initial", () => {
  assert.equal(shortName("Sneha Prakash Rao"), "Sneha R."); assert.equal(shortName("Rahul"), "Rahul"); assert.equal(shortName(""), "Learner");
});

test("the leaderboard window is two above, you, one below, and stays full at the edges", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1 }));
  assert.deepEqual(neighbours(rows, 4).map((r) => r.rank), [3, 4, 5, 6]);
  assert.deepEqual(neighbours(rows, 0).map((r) => r.rank), [1, 2, 3, 4]);
  assert.deepEqual(neighbours(rows, 9).map((r) => r.rank), [7, 8, 9, 10]);
  assert.deepEqual(neighbours(rows.slice(0, 2), 1).map((r) => r.rank), [1, 2]);
  assert.deepEqual(neighbours(rows, -1), []);
});
