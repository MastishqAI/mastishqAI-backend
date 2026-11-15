const router = require("express").Router();
const crypto = require("crypto");
const { Practice, StageAttempt, Mistake, UserStats, User, Notification, Feedback } = require("../models");
const { auth, wrap } = require("../middleware");
const { generateQuestions, explainSteps, askAboutQuestion } = require("../lib/ai");
const { awardXp } = require("../lib/xp");
const { consume, refund, limitMessage } = require("../lib/usage");

// 429 helper: take one unit of today's limit or answer the request with a friendly message
async function takeUnit(req, res, key) {
  const u = await consume(req.user, key);
  if (!u.ok) { res.status(429).json({ success: false, limitReached: key, message: limitMessage(key, u.limit) }); return false; }
  return true;
}

router.use(auth);

// questions / points each / pass mark (marks)
const { STAGES: RULES, passMarkFor, computeResult, marksLostBySubtopic } = require("../lib/scoring");
// local shape used below: q = questions, pts = marks per question
const STAGES = Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, { q: v.questions, pts: v.pointsEach, next: v.next, label: v.label }]));

const mkKey = (text) => crypto.createHash("md5").update(text.trim().toLowerCase()).digest("hex");

const practiceView = (p) => ({
  id: p._id, type: p.type, topic: p.topic, description: p.description, subject: p.subject,
  secondsPerQuestion: p.secondsPerQuestion, stages: p.stages, createdAt: p.createdAt,
});

function attemptView(a, { reveal = false } = {}) {
  const cfg = STAGES[a.stage];
  const answered = a.questions.filter((q) => q.selectedIndex !== null && q.selectedIndex !== undefined);
  return {
    id: a._id, practiceId: a.practiceId, topic: a.topic, subject: a.subject, stage: a.stage, stageLabel: cfg.label,
    attemptNo: a.attemptNo, status: a.status,
    pointsEach: a.pointsEach, passMark: a.passMark, maxScore: a.questions.length * a.pointsEach,
    secondsPerQuestion: a.secondsPerQuestion,
    pointsEarned: a.questions.filter((q) => q.correct).length * a.pointsEach,
    answeredCount: answered.length,
    questions: a.questions.map((q, i) => ({
      id: q._id, index: i, text: q.text, options: q.options,
      answered: q.selectedIndex !== null && q.selectedIndex !== undefined,
      selectedIndex: q.selectedIndex, correct: q.correct, tags: q.tags,
      ...(reveal || (q.selectedIndex !== null && q.selectedIndex !== undefined) ? { correctIndex: q.correctIndex } : {}),
      ...(reveal ? { explanation: q.explanation, subtopic: q.subtopic, timeSec: q.timeSec } : {}),
    })),
  };
}

// ---- create a topic practice (3 stages) ----
router.post("/", wrap(async (req, res) => {
  const topic = (req.body.topic || "").trim();
  if (!topic) return res.status(400).json({ success: false, message: "Topic name is required" });
  const p = await Practice.create({
    userId: req.user.id, topic, description: (req.body.description || "").trim(),
    secondsPerQuestion: Math.min(Math.max(parseInt(req.body.secondsPerQuestion, 10) || 60, 20), 180),
  });
  res.status(201).json({ success: true, practice: practiceView(p) });
}));

router.get("/", wrap(async (req, res) => {
  const list = await Practice.find({ userId: req.user.id, type: "practice" }).sort("-updatedAt").limit(20);
  res.json({ success: true, practices: list.map(practiceView) });
}));

// topic suggestions from the learner's weak spots
router.get("/recommendations", wrap(async (req, res) => {
  const rows = await Mistake.aggregate([
    { $match: { userId: new (require("mongoose").Types.ObjectId)(req.user.id), status: { $ne: "fixed" } } },
    { $group: { _id: "$topic", n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 3 },
  ]);
  res.json({ success: true, topics: rows.map((r) => r._id).filter(Boolean) });
}));

router.get("/:id", wrap(async (req, res) => {
  const p = await Practice.findOne({ _id: req.params.id, userId: req.user.id });
  if (!p) return res.status(404).json({ success: false, message: "Practice not found" });
  res.json({ success: true, practice: practiceView(p) });
}));

// ---- start (or resume) a stage ----
router.post("/:id/stages/:stage/start", wrap(async (req, res) => {
  const cfg = STAGES[req.params.stage];
  const p = await Practice.findOne({ _id: req.params.id, userId: req.user.id });
  if (!cfg || !p) return res.status(404).json({ success: false, message: "Practice or stage not found" });
  const st = p.stages[req.params.stage];
  if (!st || st.status === "locked") return res.status(403).json({ success: false, message: "Clear the previous stage to unlock this one" });

  const resume = await StageAttempt.findOne({ practiceId: p._id, stage: req.params.stage, status: "in_progress" });
  if (resume) return res.json({ success: true, attempt: attemptView(resume) });

  if (!(await takeUnit(req, res, "quiz"))) return;
  const user = await User.findById(req.user.id).select("goalName");
  const prior = await StageAttempt.find({ practiceId: p._id }).select("questions.text").limit(5).lean();
  const avoid = prior.flatMap((a) => a.questions.map((q) => q.text));
  const gen = await generateQuestions({
    topic: p.topic, description: p.description, difficulty: req.params.stage,
    count: cfg.q, exam: user?.goalName || "", avoid, meter: { userId: req.user.id, feature: "quiz" },
  });
  if (!gen.questions.length) await refund(req.user, "quiz");
  if (!gen.questions.length) return res.status(502).json({ success: false, message: "We couldn't generate a reliable quiz just now. Please try again in a moment." });
  if (!p.subject) { p.subject = gen.subject; }
  const attempt = await StageAttempt.create({
    userId: req.user.id, practiceId: p._id, stage: req.params.stage, attemptNo: st.attempts + 1,
    topic: p.topic, subject: p.subject, pointsEach: cfg.pts, passMark: passMarkFor(gen.questions.length, cfg.pts),
    secondsPerQuestion: p.secondsPerQuestion,
    questions: gen.questions.map((q) => ({ ...q, source: "AI generated" })),
  });
  await p.save();
  res.status(201).json({ success: true, attempt: attemptView(attempt), aiGenerated: gen.ai });
}));

router.get("/attempts/:attemptId", wrap(async (req, res) => {
  const a = await StageAttempt.findOne({ _id: req.params.attemptId, userId: req.user.id });
  if (!a) return res.status(404).json({ success: false, message: "Attempt not found" });
  res.json({ success: true, attempt: attemptView(a, { reveal: a.status === "submitted" }) });
}));

// ---- submit one answer ----
router.post("/attempts/:attemptId/answer", wrap(async (req, res) => {
  const a = await StageAttempt.findOne({ _id: req.params.attemptId, userId: req.user.id });
  if (!a) return res.status(404).json({ success: false, message: "Attempt not found" });
  if (a.status !== "in_progress") return res.status(409).json({ success: false, message: "This attempt is already finished" });
  const q = a.questions.id(req.body.questionId);
  if (!q) return res.status(404).json({ success: false, message: "Question not found" });
  if (q.selectedIndex !== null && q.selectedIndex !== undefined) return res.status(409).json({ success: false, message: "Already answered" });
  const idx = parseInt(req.body.selectedIndex, 10);
  if (!(idx >= 0 && idx < q.options.length)) return res.status(400).json({ success: false, message: "Invalid option" });
  q.selectedIndex = idx;
  q.correct = idx === q.correctIndex;
  q.timeSec = Math.min(Math.max(parseInt(req.body.timeSec, 10) || 0, 0), 600);
  await a.save();
  res.json({ success: true, correct: q.correct, correctIndex: q.correctIndex, pointsEarned: a.questions.filter((x) => x.correct).length * a.pointsEach });
}));

// ---- finish: grade, award points, unlock next stage, fill the Mistake Bank ----
router.post("/attempts/:attemptId/finish", wrap(async (req, res) => {
  const a = await StageAttempt.findOne({ _id: req.params.attemptId, userId: req.user.id });
  if (!a) return res.status(404).json({ success: false, message: "Attempt not found" });
  const p = await Practice.findById(a.practiceId);
  const cfg = STAGES[a.stage];

  if (a.status === "in_progress") {
    a.questions.forEach((q) => { if (q.selectedIndex === null || q.selectedIndex === undefined) { q.selectedIndex = -1; q.correct = false; } });
    const res0 = computeResult({ questions: a.questions, pointsEach: a.pointsEach, passMark: a.passMark, isDiagnostic: a.stage === "diagnostic" });
    const correct = res0.correct;
    a.score = res0.score;
    a.maxScore = res0.maxScore;
    a.cleared = res0.cleared;
    a.timeSec = res0.timeSec;
    a.status = "submitted";

    // points + badge
    let stats = await UserStats.findOne({ userId: req.user.id });
    const hadBadge = stats?.badges?.includes("Rookie");
    let earned = a.stage === "diagnostic" ? 50 : a.score;
    if (a.cleared && a.stage === "easy" && !hadBadge) { a.badge = "Rookie"; earned += 20; }
    if (a.stage === "diagnostic" && !stats?.diagnosticDone) earned = 50;
    a.earned = earned;
    stats = await awardXp(req.user.id, a.stage === "diagnostic" ? "diagnostic" : "practice", earned, { attemptId: a._id });
    if (a.badge) stats.badges.push(a.badge);
    if (a.stage === "diagnostic") stats.diagnosticDone = true;
    stats.answered += a.questions.length;
    stats.correct += correct;
    stats.accuracy = Math.round((stats.correct / Math.max(stats.answered, 1)) * 100);
    stats.attemptCount += 1;
    stats.avgMinutes = Math.round(((stats.avgMinutes * (stats.attemptCount - 1)) + a.timeSec / 60) / stats.attemptCount);
    await stats.save();

    // stage bookkeeping
    if (p && p.stages[a.stage]) {
      const st = p.stages[a.stage];
      st.attempts = a.attemptNo;
      st.best = Math.max(st.best || 0, a.score);
      if (a.cleared) {
        st.status = "cleared";
        if (cfg.next && p.stages[cfg.next].status === "locked") p.stages[cfg.next].status = "open";
      }
      p.markModified("stages");
      await p.save();
    }

    // mistake bank
    for (const q of a.questions.filter((x) => !x.correct)) {
      await Mistake.findOneAndUpdate(
        { userId: req.user.id, key: mkKey(q.text) },
        {
          $setOnInsert: { text: q.text, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation, subject: a.subject || "General", topic: q.subtopic || a.topic, status: "open", fixCorrect: 0 },
          $set: { lastAt: new Date() }, $inc: { tries: 1 },
        },
        { upsert: true }
      );
    }
    if (a.cleared && a.stage !== "diagnostic")
      await Notification.create({ userId: req.user.id, type: "achievement", title: `${cfg.label} stage cleared`, body: `You cleared ${cfg.label} on "${a.topic}" and earned ${earned} pts.` });
    await a.save();
  }

  // ---- result summary ----
  const wrong = a.questions.filter((q) => !q.correct);
  const now = computeResult({ questions: a.questions, pointsEach: a.pointsEach, passMark: a.passMark, isDiagnostic: a.stage === "diagnostic" });
  const marksLost = marksLostBySubtopic(a.questions, a.pointsEach, a.topic);
  const typeCount = {};
  wrong.forEach((q) => (q.tags || []).forEach((t) => { typeCount[t] = (typeCount[t] || 0) + 1; }));
  const mistakeTypes = Object.entries(typeCount).map(([type, count]) => ({ type, count })).sort((x, y) => y.count - x.count);

  const prev = await StageAttempt.findOne({ practiceId: a.practiceId, stage: a.stage, status: "submitted", attemptNo: { $lt: a.attemptNo } }).sort("-attemptNo");
  const prevStats = prev && computeResult({ questions: prev.questions, pointsEach: prev.pointsEach, passMark: prev.passMark });
  res.json({
    success: true,
    result: {
      attemptId: a._id, practiceId: a.practiceId, topic: a.topic, stage: a.stage, stageLabel: cfg.label, attemptNo: a.attemptNo,
      score: a.score, maxScore: a.maxScore, passMark: a.passMark, cleared: a.cleared,
      marksToGo: now.marksToGo, marksLostTotal: now.marksLost, marksLost, mistakeTypes,
      mistakes: wrong.length, nextStage: cfg.next, nextStageLabel: cfg.next ? STAGES[cfg.next].label : null,
      earned: a.earned, badge: a.badge,
      stages: p?.stages,
      compare: prev ? {
        score: [prev.score, a.score], accuracy: [prevStats.accuracy, now.accuracy], avgTime: [prevStats.avgTimeSec, now.avgTimeSec],
      } : null,
    },
  });
}));

router.get("/attempts/:attemptId/review", wrap(async (req, res) => {
  const a = await StageAttempt.findOne({ _id: req.params.attemptId, userId: req.user.id });
  if (!a) return res.status(404).json({ success: false, message: "Attempt not found" });
  if (a.status !== "submitted") return res.status(409).json({ success: false, message: "Finish the attempt to review it" });

  // peer stats: how everyone answered the same question
  const texts = a.questions.map((q) => q.text);
  const peers = await StageAttempt.aggregate([
    { $match: { status: "submitted" } }, { $unwind: "$questions" },
    { $match: { "questions.text": { $in: texts } } },
    { $group: { _id: { t: "$questions.text", i: "$questions.selectedIndex" }, n: { $sum: 1 } } },
  ]);
  const peerStats = {};
  peers.forEach((r) => { (peerStats[r._id.t] ||= {})[r._id.i] = r.n; });

  const view = attemptView(a, { reveal: true });
  view.questions = view.questions.map((q, i) => {
    const counts = peerStats[a.questions[i].text] || {};
    const total = Object.entries(counts).filter(([k]) => k !== "-1").reduce((s, [, n]) => s + n, 0);
    return {
      ...q,
      source: a.questions[i].source,
      peers: total >= 5 ? q.options.map((_, k) => Math.round(((counts[k] || 0) / total) * 100)) : null,
    };
  });
  res.json({ success: true, attempt: view });
}));

// tag why a question was missed (feeds the Mistake Bank)
router.post("/attempts/:attemptId/questions/:qid/tag", wrap(async (req, res) => {
  const a = await StageAttempt.findOne({ _id: req.params.attemptId, userId: req.user.id });
  const q = a?.questions.id(req.params.qid);
  if (!q) return res.status(404).json({ success: false, message: "Question not found" });
  const allowed = ["Concept", "Calculation", "Misread", "Guess", "Time"];
  q.tags = (req.body.tags || []).filter((t) => allowed.includes(t));
  await a.save();
  await Mistake.updateOne({ userId: req.user.id, key: mkKey(q.text) }, { tags: q.tags });
  res.json({ success: true, tags: q.tags });
}));

// ---- in-question help (the "Ask why" side panel) ----
async function loadQuestion(req) {
  const a = await StageAttempt.findOne({ _id: req.params.attemptId, userId: req.user.id });
  const q = a?.questions.id(req.params.qid);
  return { a, q };
}

// step-by-step solution, cached per question: ?mode=short|detailed
router.get("/attempts/:attemptId/questions/:qid/steps", wrap(async (req, res) => {
  const { a, q } = await loadQuestion(req);
  if (!q) return res.status(404).json({ success: false, message: "Question not found" });
  if (a.status !== "submitted") return res.status(409).json({ success: false, message: "Finish the attempt first" });
  const mode = req.query.mode === "short" ? "short" : "detailed";
  q.steps = q.steps || {};
  if (!q.steps[mode]) {
    q.steps[mode] = await explainSteps({ question: q.text, options: q.options, correctIndex: q.correctIndex, userIndex: q.selectedIndex, detailed: mode === "detailed", meter: { userId: req.user.id, feature: "steps" } });
    q.markModified("steps");
    await a.save();
  }
  res.json({ success: true, mode, steps: q.steps[mode] });
}));

// chat about this one question
router.post("/attempts/:attemptId/questions/:qid/ask", wrap(async (req, res) => {
  const { a, q } = await loadQuestion(req);
  if (!q) return res.status(404).json({ success: false, message: "Question not found" });
  const message = String(req.body.message || "").trim().slice(0, 1000);
  if (!message) return res.status(400).json({ success: false, message: "message is required" });
  if (!(await takeUnit(req, res, "chat"))) return;
  // web sources cost real money, so they are opt-in and have their own (smaller) daily limit
  let webSearch = req.body.sources === true;
  let sourcesLimited = false;
  if (webSearch) { const u = await consume(req.user, "search"); if (!u.ok) { webSearch = false; sourcesLimited = true; } }
  const topic = q.subtopic || a.topic;
  const pastMistakes = await Mistake.countDocuments({ userId: req.user.id, topic });
  const { reply, sources } = await askAboutQuestion({
    ctx: { question: q.text, options: q.options, correct: q.options[q.correctIndex], yours: q.selectedIndex >= 0 ? q.options[q.selectedIndex] : "", topic, pastMistakes, explanation: q.explanation },
    history: Array.isArray(req.body.history) ? req.body.history : [], message,
    webSearch, meter: { userId: req.user.id, feature: "ask_why" },
  });
  await awardXp(req.user.id, "ai_doubt", 0);
  res.json({ success: true, reply, pastMistakes, topic, sources, webSearch, ...(sourcesLimited && { sourcesLimited: "You've used today's web-source answers, so this reply has no sources. They reset at midnight (India time)." }) });
}));

// thumbs up/down on an AI answer, or a report on an answer / the question itself
router.post("/attempts/:attemptId/questions/:qid/feedback", wrap(async (req, res) => {
  const { a, q } = await loadQuestion(req);
  if (!q) return res.status(404).json({ success: false, message: "Question not found" });
  const kind = ["helpful", "not_helpful", "report_answer", "report_question"].includes(req.body.kind) ? req.body.kind : null;
  if (!kind) return res.status(400).json({ success: false, message: "Invalid feedback type" });
  const answer = String(req.body.answer || "").slice(0, 4000);
  const doc = { userId: req.user.id, attemptId: a._id, questionId: q._id, kind, question: q.text, answer, answerKey: answer ? mkKey(answer) : "", note: String(req.body.note || "").slice(0, 500) };
  if (kind === "helpful" || kind === "not_helpful") {
    // one rating per learner per answer: rating again replaces the old one
    await Feedback.findOneAndUpdate({ userId: req.user.id, questionId: q._id, answerKey: doc.answerKey, kind: { $in: ["helpful", "not_helpful"] } }, doc, { upsert: true });
  } else {
    await Feedback.findOneAndUpdate({ userId: req.user.id, questionId: q._id, answerKey: doc.answerKey, kind }, doc, { upsert: true });
  }
  res.json({ success: true });
}));

// ---- 10-minute diagnostic ----
router.post("/diagnostic/start", wrap(async (req, res) => {
  const user = await User.findById(req.user.id).select("goalName subjects");
  let p = await Practice.findOne({ userId: req.user.id, type: "diagnostic" });
  if (!p) p = await Practice.create({
    userId: req.user.id, type: "diagnostic", topic: `${user?.goalName || "Exam"} diagnostic`,
    description: (user?.subjects || []).join(", "), secondsPerQuestion: 30,
    stages: { easy: { status: "locked" }, medium: { status: "locked" }, hard: { status: "locked" }, diagnostic: { status: "open" } },
  });
  const resume = await StageAttempt.findOne({ practiceId: p._id, status: "in_progress" });
  if (resume) return res.json({ success: true, attempt: attemptView(resume) });
  if (!(await takeUnit(req, res, "quiz"))) return;
  const gen = await generateQuestions({ topic: p.topic, description: p.description, difficulty: "diagnostic", count: STAGES.diagnostic.q, exam: user?.goalName || "", meter: { userId: req.user.id, feature: "quiz" } });
  if (!gen.questions.length) await refund(req.user, "quiz");
  if (!gen.questions.length) return res.status(502).json({ success: false, message: "We couldn't generate the diagnostic just now. Please try again in a moment." });
  p.subject = gen.subject; await p.save();
  const attempt = await StageAttempt.create({
    userId: req.user.id, practiceId: p._id, stage: "diagnostic", attemptNo: (p.stages.diagnostic.attempts || 0) + 1,
    topic: p.topic, subject: gen.subject, pointsEach: 1, passMark: 0, secondsPerQuestion: 30,
    questions: gen.questions.map((q) => ({ ...q, source: "AI generated" })),
  });
  res.status(201).json({ success: true, attempt: attemptView(attempt), aiGenerated: gen.ai });
}));

module.exports = router;
