const router = require("express").Router();
const { User, UserStats, StageAttempt, XpEvent } = require("../models");
const { auth, wrap } = require("../middleware");
const { levelInfo } = require("../lib/xp");

router.use(auth);

const LEVEL_NAMES = ["New here", "Rookie", "Learner", "Achiever", "Scholar", "Expert", "Master", "Champion", "Legend"];

router.get("/", wrap(async (req, res) => {
  const user = await User.findById(req.user.id);
  const stats = (await UserStats.findOne({ userId: req.user.id })) || { totalXp: 0, currentStreak: 0, badges: [], diagnosticDone: false };
  const info = levelInfo(stats.totalXp);
  const clearedEasy = await StageAttempt.exists({ userId: req.user.id, stage: "easy", cleared: true });
  const nextLevel = Math.min(info.level + 1, LEVEL_NAMES.length - 1);
  res.json({
    success: true,
    firstName: user.firstName || user.name.split(" ")[0],
    goalName: user.goalName || "",
    exam: (user.goalName || "").split(" ")[0] || "",
    dailyGoal: user.dailyGoal,
    points: stats.totalXp,
    level: info.level, levelName: LEVEL_NAMES[info.level] || "Legend",
    nextLevel, pct: info.pct, toNext: info.toNext, levelStart: info.start, levelNext: info.next,
    streak: stats.currentStreak,
    badges: stats.badges,
    badgeNext: stats.badges.includes("Rookie") ? null : "Rookie",
    diagnosticDone: !!stats.diagnosticDone,
    clearedEasy: !!clearedEasy,
    streak3: stats.currentStreak >= 3,
  });
}));

// today's progress against the daily question goal
router.get("/daily", wrap(async (req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const attempts = await StageAttempt.find({ userId: req.user.id, status: "submitted", updatedAt: { $gte: start } }).select("questions.selectedIndex").lean();
  const done = attempts.reduce((s, a) => s + a.questions.filter((q) => q.selectedIndex !== -1).length, 0);
  const user = await User.findById(req.user.id).select("dailyGoal");
  res.json({ success: true, done, goal: user.dailyGoal });
}));

router.patch("/daily-goal", wrap(async (req, res) => {
  const goal = Math.min(Math.max(parseInt(req.body.dailyGoal, 10) || 0, 1), 500);
  await User.findByIdAndUpdate(req.user.id, { dailyGoal: goal });
  res.json({ success: true, dailyGoal: goal });
}));

module.exports = router;
