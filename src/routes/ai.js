const router = require("express").Router();
const { Conversation, Quiz, Material } = require("../models");
const { buildContext } = require("../lib/rag");
const { auth, wrap } = require("../middleware");
const { generateQuiz, tutorReply, aiEnabled } = require("../lib/ai");
const { awardXp } = require("../lib/xp");
const { consume, refund, limitMessage, snapshot } = require("../lib/usage");

async function takeUnit(req, res, key) {
  const u = await consume(req.user, key);
  if (!u.ok) { res.status(429).json({ success: false, limitReached: key, message: limitMessage(key, u.limit) }); return false; }
  return true;
}

router.use(auth);

router.get("/usage", wrap(async (req, res) => res.json({ success: true, usage: await snapshot(req.user) })));

router.get("/status", (_req, res) => res.json({ success: true, aiEnabled: aiEnabled() }));

// one-shot question
router.post("/ask", wrap(async (req, res) => {
  const question = (req.body.question || "").trim();
  if (!question) return res.status(400).json({ success: false, message: "question is required" });
  if (!(await takeUnit(req, res, "chat"))) return;
  const answer = await tutorReply([{ role: "user", content: question }], { userId: req.user.id, feature: "tutor" });
  await awardXp(req.user.id, "ai_ask", 2);
  res.json({ success: true, answer });
}));

// ---- AI tutor conversations ----
router.get("/conversations", wrap(async (req, res) => {
  const list = await Conversation.find({ userId: req.user.id }).sort("-updatedAt").select("title updatedAt").limit(50);
  res.json({ success: true, conversations: list });
}));

router.get("/conversations/:id", wrap(async (req, res) => {
  const c = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
  if (!c) return res.status(404).json({ success: false, message: "Conversation not found" });
  const files = c.materialIds?.length ? await Material.find({ _id: { $in: c.materialIds }, userId: req.user.id }).select("name").lean() : [];
  res.json({ success: true, conversation: c, files: files.map((f) => ({ id: f._id, name: f.name })) });
}));

// stop using an attached file in this chat (the file itself stays in the learner's files)
router.delete("/conversations/:id/materials/:mid", wrap(async (req, res) => {
  await Conversation.updateOne({ _id: req.params.id, userId: req.user.id }, { $pull: { materialIds: req.params.mid } });
  res.json({ success: true });
}));

// send a message; creates the conversation if no id is given
router.post("/chat", wrap(async (req, res) => {
  const { conversationId } = req.body;
  const message = (req.body.message || "").trim();
  if (!message) return res.status(400).json({ success: false, message: "message is required" });

  let convo = conversationId
    ? await Conversation.findOne({ _id: conversationId, userId: req.user.id })
    : null;
  if (conversationId && !convo) return res.status(404).json({ success: false, message: "Conversation not found" });
  if (!convo) convo = new Conversation({ userId: req.user.id, title: message.slice(0, 60), messages: [] });

  // files attached in the chat: only the learner's own, at most 5 per chat
  const asked = (Array.isArray(req.body.materialIds) ? req.body.materialIds : []).map(String).slice(0, 5);
  if (asked.length) {
    const own = await Material.find({ _id: { $in: asked }, userId: req.user.id }).select("_id").lean();
    const ids = new Set([...(convo.materialIds || []).map(String), ...own.map((m) => String(m._id))]);
    if (ids.size > 5) return res.status(400).json({ success: false, message: "You can attach up to 5 files to one chat." });
    convo.materialIds = [...ids];
  }
  if (!(await takeUnit(req, res, "chat"))) return;
  let material = "";
  if (convo.materialIds?.length) {
    try { material = (await buildContext({ userId: req.user.id, materialIds: convo.materialIds, query: message, meter: { userId: req.user.id, feature: "tutor" }, maxChars: 12000 }))?.text || ""; }
    catch (e) { console.warn("chat: material lookup failed:", e.message); }
  }
  convo.messages.push({ role: "user", content: message });
  const reply = await tutorReply(convo.messages.slice(-20), { userId: req.user.id, feature: "tutor" }, material);
  convo.messages.push({ role: "assistant", content: reply });
  await convo.save();
  await awardXp(req.user.id, "ai_chat", 2);
  res.json({ success: true, conversationId: convo._id, reply });
}));

// ---- AI quiz generation ----
router.post("/quizzes", wrap(async (req, res) => {
  const topic = (req.body.topic || "").trim();
  if (!topic) return res.status(400).json({ success: false, message: "topic is required" });
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 5, 1), 15);
  const difficulty = ["easy", "medium", "hard"].includes(req.body.difficulty) ? req.body.difficulty : "medium";

  if (!(await takeUnit(req, res, "quiz"))) return;
  const { questions, ai, error } = await generateQuiz({ topic, count, difficulty, context: req.body.context, meter: { userId: req.user.id, feature: "quiz" } });
  if (!questions.length) { await refund(req.user, "quiz"); return res.status(502).json({ success: false, message: "We couldn't generate a reliable quiz just now. Please try again." }); }
  const quiz = await Quiz.create({
    ownerId: req.user.id, title: `${topic} (${difficulty})`, topic, difficulty, source: "ai", questions,
  });
  res.status(201).json({ success: true, quizId: quiz._id, questionCount: questions.length, aiGenerated: ai, ...(error && { warning: error }) });
}));

router.get("/quizzes", wrap(async (req, res) => {
  const list = await Quiz.find({ ownerId: req.user.id, source: "ai" }).sort("-createdAt").select("title topic difficulty createdAt questions").lean();
  res.json({ success: true, quizzes: list.map((q) => ({ id: q._id, title: q.title, topic: q.topic, difficulty: q.difficulty, createdAt: q.createdAt, questionCount: q.questions.length })) });
}));

module.exports = router;
