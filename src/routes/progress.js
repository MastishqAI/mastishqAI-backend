const router = require("express").Router();
const { QuizAttempt, Quiz, UserStats, Topic, Subject, Notification, User } = require("../models");
const { auth, wrap } = require("../middleware");

router.use(auth);

router.get("/summary", wrap(async (req, res) => {
  const attempts = await QuizAttempt.find({ userId: req.user.id }).lean();
  const stats = await UserStats.findOne({ userId: req.user.id });
  const correct = attempts.reduce((s, a) => s + a.score, 0);
  const total = attempts.reduce((s, a) => s + a.total, 0);
  res.json({
    success: true,
    quizzesTaken: attempts.length,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    totalXp: stats?.totalXp || 0,
    level: stats?.level || 1,
    currentStreak: stats?.currentStreak || 0,
  });
}));

router.get("/analytics", wrap(async (req, res) => {
  const since = new Date(Date.now() - 13 * 864e5);
  const attempts = await QuizAttempt.find({ userId: req.user.id, createdAt: { $gte: since } }).lean();
  const byDay = {};
  for (let i = 13; i >= 0; i--) byDay[new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)] = { attempts: 0, xp: 0 };
  attempts.forEach((a) => {
    const d = a.createdAt.toISOString().slice(0, 10);
    if (byDay[d]) { byDay[d].attempts += 1; byDay[d].xp += a.xp || 0; }
  });
  res.json({ success: true, daily: Object.entries(byDay).map(([date, v]) => ({ date, ...v })) });
}));

router.get("/certificates", wrap(async (req, res) => {
  const attempts = await QuizAttempt.find({ userId: req.user.id }).lean();
  const quizzes = await Quiz.find({ _id: { $in: attempts.map((a) => a.quizId) }, topicId: { $exists: true, $ne: null } }).populate("topicId").lean();
  const user = await User.findById(req.user.id).select("name");
  const certs = quizzes
    .map((q) => {
      const best = attempts.filter((a) => String(a.quizId) === String(q._id)).reduce((m, a) => Math.max(m, a.score / a.total), 0);
      return best >= 0.8 ? { quizId: q._id, topic: q.topicId?.title, score: Math.round(best * 100), holder: user.name } : null;
    })
    .filter(Boolean);
  res.json({ success: true, certificates: certs });
}));

router.get("/dashboard", wrap(async (req, res) => {
  const [summary, subjects] = await Promise.all([
    QuizAttempt.find({ userId: req.user.id }).sort("-createdAt").limit(5).populate("quizId", "title").lean(),
    Subject.find().lean(),
  ]);
  res.json({
    success: true,
    recentAttempts: summary.map((a) => ({ id: a._id, quiz: a.quizId?.title, score: a.score, total: a.total, xp: a.xp, at: a.createdAt })),
    subjectCount: subjects.length,
  });
}));

router.get("/home", wrap(async (req, res) => {
  const user = await User.findById(req.user.id).select("name subjectIds");
  const stats = await UserStats.findOne({ userId: req.user.id });
  const unread = await Notification.countDocuments({ userId: req.user.id, read: false });
  const mine = user.subjectIds.length ? await Subject.find({ _id: { $in: user.subjectIds } }).lean() : await Subject.find().limit(4).lean();
  const nextTopics = await Topic.find({ subjectId: { $in: mine.map((s) => s._id) } }).sort("order").limit(4).lean();
  res.json({
    success: true,
    name: user.name,
    totalXp: stats?.totalXp || 0,
    level: stats?.level || 1,
    currentStreak: stats?.currentStreak || 0,
    unreadNotifications: unread,
    subjects: mine,
    nextTopics,
  });
}));

module.exports = router;
