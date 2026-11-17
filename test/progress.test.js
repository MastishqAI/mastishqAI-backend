const test = require("node:test");
const assert = require("node:assert/strict");
const { levelInfo, LEVELS } = require("../src/lib/xp");
const { badgeProgress, levelRows, heatLevel, monthGrid, weekBars } = require("../src/lib/progress");

test("levels follow the design: 1,250 points is Level 3, 150 points short of Level 4... of 1,400", () => {
  const i = levelInfo(1250);
  assert.equal(i.level, 3); assert.equal(i.next, 1400); assert.equal(i.toNext, 150);
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(399).level, 1); assert.equal(levelInfo(400).level, 2);
  assert.equal(levelInfo(4000).level, 10); assert.equal(levelInfo(99999).next, null);
  assert.equal(LEVELS.length, 10);
});

test("level rows mark done / current / next / locked, with the design's 89%", () => {
  const rows = levelRows(1250);
  assert.deepEqual(rows.slice(0, 5).map((r) => r.state), ["done", "done", "current", "next", "locked"]);
  assert.equal(rows[2].pct, 89);
  assert.equal(rows[3].toGo, 150);
});

test("badges are earned from activity and report progress toward the rest", () => {
  const b = badgeProgress({ clearedStages: 5, bestHardPct: 74, topicsCleared: 6, longestStreak: 11, level: 3 });
  const by = Object.fromEntries(b.map((x) => [x.key, x]));
  assert.equal(by.rookie.met, true); assert.equal(by.skilled.met, true);
  assert.equal(by.expert.met, false); assert.equal(by.expert.hint, "Best Hard stage: 74%");
  assert.equal(by.mastermind.hint, "6 of 10 topics");
  assert.equal(by.legend.hint, "11 of 30 days");
  assert.equal(by.king.hint, "Level 3 of 10");
  assert.equal(badgeProgress({ clearedStages: 0, bestHardPct: 0, topicsCleared: 0, longestStreak: 0, level: 1 }).filter((x) => x.met).length, 0);
  assert.equal(badgeProgress({ clearedStages: 99, bestHardPct: 80, topicsCleared: 10, longestStreak: 30, level: 10 }).every((x) => x.met), true);
});

test("heat levels step up with points", () => {
  assert.deepEqual([0, 5, 20, 60, 150].map(heatLevel), [0, 1, 2, 3, 4]);
});

test("a month grid starts on the right weekday and has no gaps", () => {
  const w = monthGrid(2026, 10, { "2026-10-05": 60 });         // 1 Oct 2026 is a Thursday
  assert.equal(w[0].findIndex((c) => c), 4);
  assert.equal(w.flat().filter(Boolean).length, 31);
  assert.ok(w.every((r) => r.length === 7));
  assert.equal(w.flat().find((c) => c?.date === "2026-10-05").level, 3);
});

test("the week bars run Monday to Sunday and hide the future", () => {
  const bars = weekBars("2026-10-14", { "2026-10-12": 40, "2026-10-14": 20 });   // a Wednesday
  assert.equal(bars.map((b) => b.label).join(""), "MTWTFSS");
  assert.equal(bars[0].date, "2026-10-12"); assert.equal(bars[0].xp, 40);
  assert.equal(bars[2].xp, 20); assert.equal(bars[3].future, true); assert.equal(bars[2].future, false);
});
