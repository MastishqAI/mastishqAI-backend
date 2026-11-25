const router = require("express").Router();
const { User, UserStats, StageAttempt, XpEvent, Mistake } = require("../models");
const { dayKey } = require("../lib/usage");
const { weekBars } = require("../lib/progress");
const { auth, wrap } = require("../middleware");
const { levelInfo } = require("../lib/xp");

router.use(auth);

const LEVEL_NAMES = ["", "Beginner", "Learner", "Achiever", "Scholar", "Specialist", "Master", "Champion", "Legend", "Elite", "King"];

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
    level: info.level, levelName: LEVEL_NAMES[info.level] || "King",
    nextLevel, pct: info.pct, toNext: info.toNext, levelStart: info.start, levelNext: info.next,
    streak: stats.currentStreak,
    badges: stats.badges,
    badgeNext: stats.badges.includes("Rookie") ? null : "Rookie",
    diagnosticDone: !!stats.diagnosticDone,
    clearedEasy: !!clearedEasy,
    streak3: stats.currentStreak >= 3,
  });
}));

// Everything the new Today screen needs: where to resume, mistakes waiting, this week's streak dots, syllabus strength
const STAGE_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard", diagnostic: "Diagnostic" };
router.get("/today", wrap(async (req, res) => {
  const uid = req.user.id;
  const [resume, mistakesOpen, events, graded] = await Promise.all([
    StageAttempt.findOne({ userId: uid, status: "in_progress" }).sort("-updatedAt").select("topic stage questions.selectedIndex").lean(),
    Mistake.countDocuments({ userId: uid, status: { $ne: "fixed" } }),
    XpEvent.find({ userId: uid, createdAt: { $gte: new Date(Date.now() - 9 * 864e5) } }).select("createdAt xp").lean(),
    StageAttempt.find({ userId: uid, status: "submitted", stage: { $ne: "diagnostic" } }).sort("-updatedAt").limit(60).select("topic score maxScore").lean(),
  ]);
  const byDay = {};
  events.forEach((e) => { const k = dayKey(e.createdAt.getTime()); byDay[k] = (byDay[k] || 0) + 1; });
  const today = dayKey();
  const week = weekBars(today, byDay).map((d) => ({ label: d.label, done: d.xp > 0, today: d.date === today, future: d.future }));

  const topics = new Map();                       // newest first, so the first time a topic appears is its latest
  graded.forEach((a) => { const k = String(a.topic || "").trim(); if (k && a.maxScore > 0 && !topics.has(k)) topics.set(k, []); if (k && a.maxScore > 0) topics.get(k).push(a.score / a.maxScore); });
  const syllabus = [...topics.entries()].slice(0, 5).map(([topic, list]) => {
    const pct = Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 100);
    return { topic, pct, band: pct >= 75 ? "Strong" : pct >= 50 ? "Building" : "Weak" };
  });
  res.json({
    success: true,
    resume: resume && { attemptId: resume._id, topic: resume.topic, stage: resume.stage, stageLabel: STAGE_LABEL[resume.stage] || resume.stage, answered: resume.questions.filter((q) => q.selectedIndex !== null && q.selectedIndex !== undefined && q.selectedIndex !== -1).length, total: resume.questions.length },
    mistakesOpen, week, syllabus,
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
