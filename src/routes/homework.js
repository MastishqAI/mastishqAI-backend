const router = require("express").Router();
const { Homework, Submission, User, Notification } = require("../models");
const { auth, requireRole, wrap } = require("../middleware");

router.use(auth);
const teacher = requireRole("teacher", "admin");

// ---------- teacher ----------
router.post("/teacher", teacher, wrap(async (req, res) => {
  const { title, description, dueDate, questions } = req.body;
  if (!title) return res.status(400).json({ success: false, message: "title is required" });
  const hw = await Homework.create({
    teacherId: req.user.id, title, description, dueDate,
    questions: (questions || []).map((t) => ({ text: typeof t === "string" ? t : t.text })),
  });
  res.status(201).json({ success: true, homework: hw });
}));

router.get("/teacher", teacher, wrap(async (req, res) => {
  res.json({ success: true, homework: await Homework.find({ teacherId: req.user.id }).sort("-createdAt") });
}));

router.post("/teacher/:id/question", teacher, wrap(async (req, res) => {
  const hw = await Homework.findOne({ _id: req.params.id, teacherId: req.user.id });
  if (!hw) return res.status(404).json({ success: false, message: "Homework not found" });
  hw.questions.push({ text: req.body.text });
  await hw.save();
  res.json({ success: true, homework: hw });
}));

router.post("/teacher/:id/publish", teacher, wrap(async (req, res) => {
  const hw = await Homework.findOne({ _id: req.params.id, teacherId: req.user.id });
  if (!hw) return res.status(404).json({ success: false, message: "Homework not found" });
  if (!hw.questions.length) return res.status(400).json({ success: false, message: "Add at least one question first" });
  hw.published = true;
  await hw.save();
  const students = await User.find({ role: "student" }).select("_id");
  await Notification.insertMany(students.map((s) => ({
    userId: s._id, type: "homework", title: "New homework", body: hw.title, data: { homeworkId: hw._id },
  })));
  res.json({ success: true, notified: students.length });
}));

router.get("/teacher/:id/submissions", teacher, wrap(async (req, res) => {
  const subs = await Submission.find({ homeworkId: req.params.id, submitted: true }).populate("studentId", "name email");
  res.json({ success: true, submissions: subs });
}));

router.post("/teacher/submissions/:id/grade", teacher, wrap(async (req, res) => {
  const sub = await Submission.findByIdAndUpdate(req.params.id, { grade: req.body.grade, feedback: req.body.feedback }, { new: true });
  if (!sub) return res.status(404).json({ success: false, message: "Submission not found" });
  await Notification.create({ userId: sub.studentId, type: "grade", title: "Homework graded", body: `You scored ${sub.grade}.` });
  res.json({ success: true, submission: sub });
}));

// ---------- student ----------
router.get("/", wrap(async (req, res) => {
  const list = await Homework.find({ published: true }).sort("-createdAt").lean();
  const subs = await Submission.find({ studentId: req.user.id }).lean();
  res.json({
    success: true,
    homework: list.map((h) => {
      const s = subs.find((x) => String(x.homeworkId) === String(h._id));
      return { ...h, status: s?.submitted ? (s.grade != null ? "graded" : "submitted") : "pending", grade: s?.grade };
    }),
  });
}));

router.get("/:id", wrap(async (req, res) => {
  const hw = await Homework.findOne({ _id: req.params.id, published: true });
  if (!hw) return res.status(404).json({ success: false, message: "Homework not found" });
  const sub = await Submission.findOne({ homeworkId: hw._id, studentId: req.user.id });
  res.json({ success: true, homework: hw, submission: sub });
}));

router.post("/:id/answer", wrap(async (req, res) => {
  const sub = (await Submission.findOne({ homeworkId: req.params.id, studentId: req.user.id }))
    || new Submission({ homeworkId: req.params.id, studentId: req.user.id, answers: [] });
  if (sub.submitted) return res.status(409).json({ success: false, message: "Already submitted" });
  const i = sub.answers.findIndex((a) => String(a.questionId) === req.body.questionId);
  if (i >= 0) sub.answers[i].answer = req.body.answer;
  else sub.answers.push({ questionId: req.body.questionId, answer: req.body.answer });
  await sub.save();
  res.json({ success: true });
}));

router.post("/:id/submit", wrap(async (req, res) => {
  const sub = await Submission.findOne({ homeworkId: req.params.id, studentId: req.user.id });
  if (!sub || !sub.answers.length) return res.status(400).json({ success: false, message: "Answer at least one question first" });
  sub.submitted = true;
  await sub.save();
  res.json({ success: true });
}));

module.exports = router;
