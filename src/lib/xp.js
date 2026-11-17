const { UserStats, XpEvent } = require("../models");

// Levels 1-10 (from the Figma "Points, levels and badges" screen): the points at which each level starts,
// and what it unlocks (shown as a label; these are not enforced anywhere).
const LEVELS = [
  { n: 1, from: 0, unlocks: "Topic quizzes" },
  { n: 2, from: 400, unlocks: "Weak-spot sets" },
  { n: 3, from: 900, unlocks: "Full mocks" },
  { n: 4, from: 1400, unlocks: "Hard PYQ sets" },
  { n: 5, from: 2000, unlocks: "Speed drills" },
  { n: 6, from: 2700, unlocks: "Mixed-subject mocks" },
  { n: 7, from: 3000, unlocks: "Speed drills" },
  { n: 8, from: 3500, unlocks: "Mixed-subject mocks" },
  { n: 9, from: 3700, unlocks: "King badge" },
  { n: 10, from: 4000, unlocks: "King badge" },
];
const STARTS = LEVELS.map((l) => l.from);

function levelInfo(points) {
  const level = Math.max(1, STARTS.filter((t) => points >= t).length);
  const start = STARTS[level - 1];
  const next = STARTS[level] ?? null;
  const pct = next ? Math.round(((points - start) / (next - start)) * 100) : 100;
  return { level, start, next, pct, toNext: next ? next - points : 0 };
}
const levelFor = (points) => levelInfo(points).level;

const today = () => new Date().toISOString().slice(0, 10);

async function awardXp(userId, type, xp, meta = {}) {
  let stats = await UserStats.findOne({ userId });
  if (!stats) stats = new UserStats({ userId });

  const t = today();
  if (stats.lastActiveDate !== t) {
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    stats.currentStreak = stats.lastActiveDate === y ? stats.currentStreak + 1 : 1;
    stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
    stats.lastActiveDate = t;
  }
  stats.totalXp += xp;
  stats.level = levelFor(stats.totalXp);
  await stats.save();
  if (xp) await XpEvent.create({ userId, type, xp, meta });
  return stats;
}

module.exports = { awardXp, levelFor, levelInfo, LEVELS };
