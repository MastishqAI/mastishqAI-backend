// AI usage: cost estimates, per-call logging and the daily limits that keep OpenAI spend under control.
const { UsageLog, AiQuota, User } = require("../models");
const { isPro } = require("./billing");

// ESTIMATED US$ per 1M tokens (input / output). These are approximations: check OpenAI's pricing page and
// override with the OPENAI_PRICES env var, e.g. {"gpt-4o-mini":[0.15,0.6]}.
const PRICES = {
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
  "text-embedding-3-small": [0.02, 0],
  ...(() => { try { return JSON.parse(process.env.OPENAI_PRICES || "{}"); } catch { return {}; } })(),
};
const SEARCH_USD = Number(process.env.OPENAI_SEARCH_USD) || 0.025;   // per web search (approx.)

function estimateCost(model, inputTokens = 0, outputTokens = 0, searches = 0) {
  const [pin, pout] = PRICES[model] || PRICES["gpt-4o-mini"];
  return (inputTokens * pin + outputTokens * pout) / 1e6 + searches * SEARCH_USD;
}

// OpenAI returns usage in two shapes (chat completions / responses API)
const tokensOf = (u = {}) => ({ input: u.prompt_tokens ?? u.input_tokens ?? 0, output: u.completion_tokens ?? u.output_tokens ?? 0 });

// fire-and-forget: logging must never slow down or break a learner's request
function record(meter, model, usage, searches = 0) {
  if (!meter?.userId) return;
  const t = tokensOf(usage);
  UsageLog.create({
    userId: meter.userId, feature: meter.feature, model,
    inputTokens: t.input, outputTokens: t.output, searches,
    costUsd: Number(estimateCost(model, t.input, t.output, searches).toFixed(6)),
  }).catch((e) => console.error("usage log failed:", e.message));
}

// ---- daily limits (per learner, per day in Indian time). Set 0 to switch a limit off. ----
const LIMITS = {
  quiz: Number(process.env.AI_LIMIT_QUIZ ?? 20),      // quizzes / diagnostics generated per day
  chat: Number(process.env.AI_LIMIT_CHAT ?? 60),      // AI tutor / Ask why / similar-question messages per day
  search: Number(process.env.AI_LIMIT_SEARCH ?? 15),  // answers that use paid web search per day
  upload: Number(process.env.AI_LIMIT_UPLOAD ?? 10),  // study files / scans read per day (each is an OpenAI read)
};
// Pro learners get a higher daily allowance (PRO_LIMIT_MULTIPLIER, default 3x)
const PRO_MULT = Number(process.env.PRO_LIMIT_MULTIPLIER) || 3;
const dayKey = (now = Date.now()) => new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);

// Take one unit. Counts first, then checks, so two requests at once can't both slip past the limit.
async function consume(user, key, now = Date.now()) {
  let limit = LIMITS[key];
  if (!limit || user?.role === "admin") return { ok: true, limit };
  const u = await User.findById(user.id).select("plan planExpiresAt").lean();
  if (isPro(u, now)) limit = limit * PRO_MULT;
  const where = { userId: user.id, day: dayKey(now) };
  const doc = await AiQuota.findOneAndUpdate(where, { $inc: { [key]: 1 } }, { upsert: true, new: true });
  if (doc[key] > limit) {
    await AiQuota.updateOne(where, { $inc: { [key]: -1 } });
    if (key === "chat") {                       // bonus chats from inviting friends
      const b = await User.findOneAndUpdate({ _id: user.id, bonusChats: { $gt: 0 } }, { $inc: { bonusChats: -1 } });
      if (b) return { ok: true, limit, used: limit, bonus: true };
    }
    return { ok: false, limit, used: limit };
  }
  return { ok: true, limit, used: doc[key] };
}
// give a unit back (for example when generation failed and the learner got nothing)
const refund = (user, key) => (LIMITS[key] && user?.role !== "admin" ? AiQuota.updateOne({ userId: user.id, day: dayKey() }, { $inc: { [key]: -1 } }).catch(() => {}) : Promise.resolve());

const WHAT = { quiz: ["AI quiz", "AI quizzes"], chat: ["AI message", "AI messages"], search: ["answer with web sources", "answers with web sources"], upload: ["file or scan", "files and scans"] };
const limitMessage = (key, limit) => `You've used today's limit of ${limit} ${WHAT[key][limit === 1 ? 0 : 1]}. It resets at midnight (India time).`;

// What the learner has used today against their limits (the "Usage" box in Ask AI)
async function snapshot(user) {
  const u = await User.findById(user.id).select("plan planExpiresAt bonusChats role").lean();
  const pro = isPro(u);
  const mult = pro ? PRO_MULT : 1;
  const doc = (await AiQuota.findOne({ userId: user.id, day: dayKey() }).lean()) || {};
  const row = (k) => ({ used: Math.min(doc[k] || 0, LIMITS[k] * mult), limit: LIMITS[k] ? LIMITS[k] * mult : null });
  return { pro, quiz: row("quiz"), chat: row("chat"), upload: row("upload"), bonusChats: u?.bonusChats || 0, unlimited: u?.role === "admin" };
}

module.exports = { snapshot, PRICES, LIMITS, PRO_MULT, estimateCost, tokensOf, record, dayKey, consume, refund, limitMessage };
