// AI usage: cost estimates, per-call logging and the daily limits that keep OpenAI spend under control.
const { UsageLog, AiQuota } = require("../models");

// ESTIMATED US$ per 1M tokens (input / output). These are approximations: check OpenAI's pricing page and
// override with the OPENAI_PRICES env var, e.g. {"gpt-4o-mini":[0.15,0.6]}.
const PRICES = {
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
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
};
const dayKey = (now = Date.now()) => new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);

// Take one unit. Counts first, then checks, so two requests at once can't both slip past the limit.
async function consume(user, key, now = Date.now()) {
  const limit = LIMITS[key];
  if (!limit || user?.role === "admin") return { ok: true, limit };
  const where = { userId: user.id, day: dayKey(now) };
  const doc = await AiQuota.findOneAndUpdate(where, { $inc: { [key]: 1 } }, { upsert: true, new: true });
  if (doc[key] > limit) {
    await AiQuota.updateOne(where, { $inc: { [key]: -1 } });
    return { ok: false, limit, used: limit };
  }
  return { ok: true, limit, used: doc[key] };
}
// give a unit back (for example when generation failed and the learner got nothing)
const refund = (user, key) => (LIMITS[key] && user?.role !== "admin" ? AiQuota.updateOne({ userId: user.id, day: dayKey() }, { $inc: { [key]: -1 } }).catch(() => {}) : Promise.resolve());

const WHAT = { quiz: ["AI quiz", "AI quizzes"], chat: ["AI message", "AI messages"], search: ["answer with web sources", "answers with web sources"] };
const limitMessage = (key, limit) => `You've used today's limit of ${limit} ${WHAT[key][limit === 1 ? 0 : 1]}. It resets at midnight (India time).`;

module.exports = { PRICES, LIMITS, estimateCost, tokensOf, record, dayKey, consume, refund, limitMessage };
