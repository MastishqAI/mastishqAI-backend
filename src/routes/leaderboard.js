const router = require("express").Router();
const { UserStats, XpEvent, User } = require("../models");
const { auth, wrap } = require("../middleware");
const { levelInfo } = require("../lib/xp");

router.use(auth);

const initials = (n = "") => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");

// short names shown in the page title
const LABELS = { "NEET Preparation": "NEET", "JEE Preparation": "JEE", "Board Exams": "Board Exams", "Civil Services (UPSC)": "UPSC", "Olympiad / Competitive": "Olympiad", "CA / Commerce": "CA / Commerce" };

// goal === null  ->  everyone ("Other Exams" learners, or learners with no goal, see all)
async function board(goal) {
  const rows = await UserStats.find().populate("userId", "name goalName state district role").lean();
  return rows
    .filter((r) => r.userId && r.userId.role === "student" && (!goal || r.userId.goalName === goal))
    .sort((a, b) => b.totalXp - a.totalXp)
    .map((r, i) => ({
      rank: i + 1, id: String(r.userId._id), name: r.userId.name, initials: initials(r.userId.name),
      goal: r.userId.goalName || "", place: r.userId.district || "",
      level: levelInfo(r.totalXp).level, points: r.totalXp, streak: r.currentStreak,
      accuracy: r.accuracy, avgMinutes: r.avgMinutes,
    }));
}

// ?q=search &limit=15 &offset=0
router.get("/", wrap(async (req, res) => {
  const mine = await User.findById(req.user.id).select("goalName");
  const goal = mine?.goalName && mine.goalName !== "Other Exams" ? mine.goalName : null;
  const all = await board(goal);
  const meIdx = all.findIndex((r) => r.id === req.user.id);
  const me = meIdx >= 0 ? all[meIdx] : null;
  const q = (req.query.q || "").toString().trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const pool = q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
  let items = pool.slice(offset, offset + limit);
  // always pin the current learner on top (like the design), without duplicating
  if (me && !q && offset === 0) items = [me, ...items.filter((r) => r.id !== me.id)];

  // weekly movement: rank now vs. rank without this week's points
  let movedUp = 0;
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const recent = await XpEvent.aggregate([{ $match: { createdAt: { $gte: weekAgo } } }, { $group: { _id: "$userId", xp: { $sum: "$xp" } } }]);
  const weekXp = Object.fromEntries(recent.map((r) => [String(r._id), r.xp]));
  if (me) {
    const beforeRank = 1 + all.filter((r) => r.id !== me.id && r.points - (weekXp[r.id] || 0) > me.points - (weekXp[me.id] || 0)).length;
    movedUp = beforeRank - me.rank;
  }
  const ahead = me && meIdx > 0 ? all[meIdx - 1] : null;
  res.json({
    success: true, scope: { all: !goal, goalName: goal, label: goal ? (LABELS[goal] || goal) : "All" }, total: all.length, hasMore: offset + limit < pool.length, items, me, movedUp,
    nextTarget: ahead ? { name: ahead.name, rank: ahead.rank, diff: ahead.points - me.points + 1 } : null,
  });
}));

module.exports = router;
