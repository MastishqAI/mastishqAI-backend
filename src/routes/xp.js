const router = require("express").Router();
const { UserStats, XpEvent, User, StageAttempt } = require("../models");
const { auth, wrap } = require("../middleware");
const { awardXp, levelInfo } = require("../lib/xp");
const { levelRows, monthGrid, weekBars } = require("../lib/progress");
const { syncBadges } = require("../lib/badges");
const { personalBests, recordsByTopic } = require("../lib/bests");
const { dayKey } = require("../lib/usage");

router.use(auth);

router.get("/stats", wrap(async (req, res) => {
  const stats = (await UserStats.findOne({ userId: req.user.id })) || { totalXp: 0, level: 1, currentStreak: 0, longestStreak: 0 };
  const nextLevelXp = stats.level * 100;
  res.json({
    success: true,
    stats: {
      totalXp: stats.totalXp, level: stats.level,
      currentStreak: stats.currentStreak, longestStreak: stats.longestStreak,
      nextLevelXp, xpToNextLevel: Math.max(0, nextLevelXp - stats.totalXp),
    },
  });
}));

// Everything the "Points, levels and badges" screen needs in one call.
router.get("/overview", wrap(async (req, res) => {
  const stats = (await UserStats.findOne({ userId: req.user.id })) || {};
  const points = stats.totalXp || 0;
  const info = levelInfo(points);
  const { badges } = await syncBadges(req.user.id);

  const today = dayKey();
  const since = new Date(Date.now() - 10 * 864e5);
  const recent = await XpEvent.find({ userId: req.user.id, createdAt: { $gte: since } }).select("createdAt xp").lean();
  const byDay = {};
  recent.forEach((e) => { const k = dayKey(e.createdAt.getTime()); byDay[k] = (byDay[k] || 0) + (e.xp || 0); });
  const week = weekBars(today, byDay);
  const earned = badges.filter((b) => b.met);
  const next = badges.find((b) => !b.met);

  res.json({
    success: true,
    level: { n: info.level, points, next: info.next, toNext: info.toNext, pct: info.next ? Math.round((points / info.next) * 100) : 100 },
    totalXp: points,
    weekXp: week.reduce((s, d) => s + d.xp, 0),
    streak: { current: stats.currentStreak || 0, best: Math.max(stats.longestStreak || 0, stats.currentStreak || 0), todayDone: (stats.lastActiveDate || "") === new Date().toISOString().slice(0, 10) },
    badgeSummary: { earned: earned.length, total: badges.length, next: next?.name || null, nextPct: next ? next.pct : 100 },
    badges,
    levels: levelRows(points),
    week,
  });
}));

// "My best": records from the learner's own finished stages
router.get("/bests", wrap(async (req, res) => {
  const stats = (await UserStats.findOne({ userId: req.user.id }).lean()) || {};
  const rows = await StageAttempt.find({ userId: req.user.id, status: "submitted", stage: { $ne: "diagnostic" } })
    .select("stage topic subject score maxScore timeSec updatedAt createdAt questions.text").lean();
  const attempts = rows.map((a) => ({ ...a, questionCount: a.questions?.length || 0 }));
  res.json({ success: true, ...personalBests(attempts, stats), topics: recordsByTopic(attempts, dayKey().slice(0, 7)), hasData: attempts.length > 0 });
}));

// ?month=YYYY-MM (India time), defaults to this month
router.get("/heatmap", wrap(async (req, res) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month || ""));
  const today = dayKey();
  const year = m ? Number(m[1]) : Number(today.slice(0, 4));
  const month = m ? Number(m[2]) : Number(today.slice(5, 7));
  if (month < 1 || month > 12) return res.status(400).json({ success: false, message: "Invalid month" });
  // fetch a day either side so India-time days at the month edges are complete
  const from = new Date(Date.UTC(year, month - 1, 1) - 36 * 3600e3);
  const to = new Date(Date.UTC(year, month, 1) + 36 * 3600e3);
  const events = await XpEvent.find({ userId: req.user.id, createdAt: { $gte: from, $lt: to } }).select("createdAt xp").lean();
  const byDay = {};
  events.forEach((e) => { const k = dayKey(e.createdAt.getTime()); byDay[k] = (byDay[k] || 0) + (e.xp || 0); });
  res.json({ success: true, month: `${year}-${String(month).padStart(2, "0")}`, label: new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" }), weeks: monthGrid(year, month, byDay), today });
}));

router.get("/history", wrap(async (req, res) => {
  res.json({ success: true, history: await XpEvent.find({ userId: req.user.id }).sort("-createdAt").limit(50) });
}));

router.post("/activity", wrap(async (req, res) => {
  const xp = Math.min(Math.max(parseInt(req.body.xp, 10) || 5, 1), 25);
  const stats = await awardXp(req.user.id, req.body.type || "activity", xp);
  res.json({ success: true, totalXp: stats.totalXp, level: stats.level });
}));

router.get("/streaks", wrap(async (req, res) => {
  const s = await UserStats.findOne({ userId: req.user.id });
  const since = new Date(Date.now() - 30 * 864e5);
  const events = await XpEvent.find({ userId: req.user.id, createdAt: { $gte: since } }).select("createdAt").lean();
  const days = [...new Set(events.map((e) => e.createdAt.toISOString().slice(0, 10)))].sort();
  res.json({ success: true, currentStreak: s?.currentStreak || 0, longestStreak: s?.longestStreak || 0, activeDays: days });
}));

async function ranked(limit) {
  const rows = await UserStats.find().sort("-totalXp").limit(limit).populate("userId", "name").lean();
  return rows.map((r, i) => ({
    id: r.userId?._id, name: r.userId?.name || "Unknown",
    xp: r.totalXp, level: r.level, rank: i + 1,
  }));
}

router.get("/leaderboard", wrap(async (req, res) => {
  const data = (await ranked(10)).map((r) => ({ ...r, is_current_user: String(r.id) === req.user.id }));
  const all = await UserStats.find().sort("-totalXp").select("userId totalXp").lean();
  const idx = all.findIndex((s) => String(s.userId) === req.user.id);
  let rival = null;
  if (idx > 0) {
    const ahead = await User.findById(all[idx - 1].userId).select("name");
    rival = { name: ahead?.name, rank: idx, xp_ahead: all[idx - 1].totalXp - all[idx].totalXp };
  }
  res.json({ success: true, data, myRank: idx >= 0 ? idx + 1 : null, weekly_rival: rival });
}));

router.get("/global", wrap(async (_req, res) => {
  res.json({ success: true, data: await ranked(50) });
}));

module.exports = router;
