// Reads real activity, works out which badges are met, and remembers the date each was first earned.
const { StageAttempt, UserStats } = require("../models");
const { levelInfo } = require("./xp");
const { BADGES, badgeProgress } = require("./progress");

async function facts(userId, stats) {
  const done = await StageAttempt.find({ userId, status: "submitted", stage: { $ne: "diagnostic" } }).select("stage topic cleared score maxScore").lean();
  const cleared = done.filter((a) => a.cleared);
  const hard = done.filter((a) => a.stage === "hard" && a.maxScore > 0).map((a) => (a.score / a.maxScore) * 100);
  return {
    clearedStages: cleared.length,
    bestHardPct: hard.length ? Math.max(...hard) : 0,
    topicsCleared: new Set(cleared.map((a) => String(a.topic || "").trim().toLowerCase()).filter(Boolean)).size,
    longestStreak: Math.max(stats?.longestStreak || 0, stats?.currentStreak || 0),
    level: levelInfo(stats?.totalXp || 0).level,
  };
}

// Returns the progress for all six badges, with `earnedAt` for those earned. Newly met badges are saved. `newly` lists their names.
async function syncBadges(userId) {
  const stats = (await UserStats.findOne({ userId })) || new UserStats({ userId });
  // a badge already on the learner's record stays earned even if the live numbers later dip
  const list = badgeProgress(await facts(userId, stats)).map((b) => (stats.badges.includes(b.name) ? { ...b, met: true, pct: 100 } : b));
  const dates = { ...(stats.badgeDates || {}) };
  const newly = [];
  for (const b of list) {
    if (b.met && !stats.badges.includes(b.name)) { stats.badges.push(b.name); dates[b.name] = new Date().toISOString(); newly.push(b.name); }
    else if (b.met && !dates[b.name]) dates[b.name] = stats.updatedAt ? new Date(stats.updatedAt).toISOString() : new Date().toISOString();   // earned before dates were tracked
  }
  if (newly.length || JSON.stringify(dates) !== JSON.stringify(stats.badgeDates || {})) {
    stats.badgeDates = dates; stats.markModified("badgeDates");
    if (!stats.isNew || stats.totalXp) await stats.save();
  }
  return { badges: list.map((b) => ({ ...b, earnedAt: b.met ? dates[b.name] : null })), newly };
}

module.exports = { syncBadges, BADGES };
