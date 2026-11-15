const router = require("express").Router();
const { Mistake } = require("../models");
const { auth, wrap } = require("../middleware");
const { similarQuestion } = require("../lib/ai");
const { awardXp } = require("../lib/xp");
const { consume, refund, limitMessage } = require("../lib/usage");

router.use(auth);

const view = (m) => ({
  id: m._id, text: m.text, subject: m.subject, topic: m.topic, tags: m.tags, status: m.status,
  tries: m.tries, lastAt: m.lastAt || m.updatedAt, fixCorrect: m.fixCorrect,
});

// ?subject=a,b &topic=x,y  — empty means all
router.get("/", wrap(async (req, res) => {
  const all = await Mistake.find({ userId: req.user.id }).sort("-lastAt").lean();
  const csv = (v) => (v ? String(v).split(",").filter(Boolean) : []);
  const subjects = csv(req.query.subject);
  const topics = csv(req.query.topic);
  const filtered = all.filter((m) => (!subjects.length || subjects.includes(m.subject)) && (!topics.length || topics.includes(m.topic)));
  res.json({
    success: true,
    open: all.filter((m) => m.status !== "fixed").length,
    fixed: all.filter((m) => m.status === "fixed").length,
    subjects: [...new Set(all.map((m) => m.subject).filter(Boolean))],
    topics: [...new Set(all.filter((m) => !subjects.length || subjects.includes(m.subject)).map((m) => m.topic).filter(Boolean))],
    mistakes: filtered.map(view),
  });
}));

router.get("/:id", wrap(async (req, res) => {
  const m = await Mistake.findOne({ _id: req.params.id, userId: req.user.id });
  if (!m) return res.status(404).json({ success: false, message: "Mistake not found" });
  res.json({ success: true, mistake: { ...view(m), options: m.options, correctIndex: m.correctIndex, explanation: m.explanation } });
}));

// "Practice similar": a fresh AI question on the same concept
router.post("/:id/similar", wrap(async (req, res) => {
  const m = await Mistake.findOne({ _id: req.params.id, userId: req.user.id });
  if (!m) return res.status(404).json({ success: false, message: "Mistake not found" });
  const unit = await consume(req.user, "chat");
  if (!unit.ok) return res.status(429).json({ success: false, limitReached: "chat", message: limitMessage("chat", unit.limit) });
  const q = await similarQuestion(m, { userId: req.user.id, feature: "similar" });
  if (!q) await refund(req.user, "chat");
  if (!q) return res.status(502).json({ success: false, message: "Could not generate a question, try again" });
  m.similar = q;
  if (m.status === "open") m.status = "fixing";
  await m.save();
  res.json({ success: true, question: { text: q.text, options: q.options }, fixCorrect: m.fixCorrect, needed: 2 });
}));

router.post("/:id/similar/answer", wrap(async (req, res) => {
  const m = await Mistake.findOne({ _id: req.params.id, userId: req.user.id });
  if (!m || !m.similar?.text) return res.status(404).json({ success: false, message: "Ask for a similar question first" });
  const correct = parseInt(req.body.selectedIndex, 10) === m.similar.correctIndex;
  const out = { correctIndex: m.similar.correctIndex, explanation: m.similar.explanation };
  m.similar = undefined;
  if (correct) {
    m.fixCorrect += 1;
    if (m.fixCorrect >= 2) { m.status = "fixed"; await awardXp(req.user.id, "mistake_fixed", 10, { mistakeId: m._id }); }
  } else {
    m.status = "fixing";
    m.tries += 1;
  }
  m.lastAt = new Date();
  await m.save();
  res.json({ success: true, correct, ...out, status: m.status, fixCorrect: m.fixCorrect, needed: 2 });
}));

module.exports = router;
