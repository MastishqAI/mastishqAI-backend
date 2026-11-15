const router = require("express").Router();
const { UserStats, XpEvent, User } = require("../models");
const { auth, wrap } = require("../middleware");
const { awardXp } = require("../lib/xp");

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
