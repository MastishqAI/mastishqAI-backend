const { UserStats, XpEvent } = require("../models");

// points needed to *reach* levels 1..8 (Level 0 = below the first threshold)
const THRESHOLDS = [100, 300, 800, 1500, 2200, 2700, 3300, 4000];

function levelInfo(points) {
  const level = THRESHOLDS.filter((t) => points >= t).length;
  const start = level === 0 ? 0 : THRESHOLDS[level - 1];
  const next = THRESHOLDS[level] ?? null;
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

module.exports = { awardXp, levelFor, levelInfo, THRESHOLDS };
