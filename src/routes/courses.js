const router = require("express").Router();
const { Subject, Topic, Quiz, QuizAttempt } = require("../models");
const { auth, requireRole, wrap } = require("../middleware");
const { awardXp } = require("../lib/xp");
const { Notification } = require("../models");

router.use(auth);

// hide answers until the student has answered
const safeQuiz = (q) => ({
  id: q._id, title: q.title, topic: q.topic, difficulty: q.difficulty, source: q.source, topicId: q.topicId,
  questions: q.questions.map((x) => ({ id: x._id, text: x.text, options: x.options })),
});

router.get("/subjects", wrap(async (_req, res) => {
  const subjects = await Subject.find().sort("name").lean();
  const counts = await Topic.aggregate([{ $group: { _id: "$subjectId", n: { $sum: 1 } } }]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json({ success: true, subjects: subjects.map((s) => ({ ...s, topicCount: map[String(s._id)] || 0 })) });
}));

router.get("/subjects/:subjectId/topics", wrap(async (req, res) => {
  const topics = await Topic.find({ subjectId: req.params.subjectId }).sort("order").lean();
  const done = await QuizAttempt.find({ userId: req.user.id }).select("quizId score total").lean();
  const quizzes = await Quiz.find({ topicId: { $in: topics.map((t) => t._id) } }).select("_id topicId").lean();
  const quizByTopic = Object.fromEntries(quizzes.map((q) => [String(q.topicId), String(q._id)]));
  res.json({
    success: true,
    topics: topics.map((t) => {
      const qid = quizByTopic[String(t._id)];
      const best = done.filter((d) => String(d.quizId) === qid).reduce((m, d) => Math.max(m, Math.round((d.score / d.total) * 100)), 0);
      return { ...t, quizId: qid || null, bestScore: best, completed: best >= 70 };
    }),
  });
}));

router.get("/topics/:topicId", wrap(async (req, res) => {
  const topic = await Topic.findById(req.params.topicId);
  if (!topic) return res.status(404).json({ success: false, message: "Topic not found" });
  const quiz = await Quiz.findOne({ topicId: topic._id }).select("_id");
  res.json({ success: true, topic, quizId: quiz?._id || null });
}));

router.get("/quizzes/:quizId", wrap(async (req, res) => {
  const quiz = await Quiz.findById(req.params.quizId);
  if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
  res.json({ success: true, quiz: safeQuiz(quiz) });
}));

// check a single answer (instant feedback)
router.post("/quizzes/:quizId/check-answer", wrap(async (req, res) => {
  const quiz = await Quiz.findById(req.params.quizId);
  const q = quiz?.questions.id(req.body.questionId);
  if (!q) return res.status(404).json({ success: false, message: "Question not found" });
  res.json({ success: true, correct: q.correctIndex === req.body.selectedIndex, correctIndex: q.correctIndex, explanation: q.explanation });
}));

router.post("/quizzes/:quizId/submit", wrap(async (req, res) => {
  const quiz = await Quiz.findById(req.params.quizId);
  if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
  const given = Array.isArray(req.body.answers) ? req.body.answers : [];
  const graded = quiz.questions.map((q) => {
    const a = given.find((x) => String(x.questionId) === String(q._id));
    return {
      questionId: q._id,
      selectedIndex: a ? a.selectedIndex : -1,
      correct: a ? a.selectedIndex === q.correctIndex : false,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    };
  });
  const score = graded.filter((g) => g.correct).length;
  const total = quiz.questions.length;
  const xp = score * 10 + (total && score === total ? 20 : 0);
  const attempt = await QuizAttempt.create({
    userId: req.user.id, quizId: quiz._id, answers: graded, score, total, xp,
  });
  const stats = await awardXp(req.user.id, "quiz_complete", xp, { quizId: quiz._id, score, total });
  if (total && score / total >= 0.7)
    await Notification.create({ userId: req.user.id, type: "achievement", title: "Quiz passed!", body: `You scored ${score}/${total} on "${quiz.title}" and earned ${xp} XP.` });
  res.json({ success: true, attemptId: attempt._id, score, total, xp, totalXp: stats.totalXp, level: stats.level, results: graded });
}));

// ---- admin / teacher content management ----
const staff = requireRole("teacher", "admin");

router.post("/admin/subject", staff, wrap(async (req, res) => {
  res.status(201).json({ success: true, subject: await Subject.create(req.body) });
}));
router.post("/admin/topic", staff, wrap(async (req, res) => {
  res.status(201).json({ success: true, topic: await Topic.create(req.body) });
}));
router.post("/admin/quiz", staff, wrap(async (req, res) => {
  res.status(201).json({ success: true, quiz: await Quiz.create({ ...req.body, source: "manual" }) });
}));

module.exports = router;
