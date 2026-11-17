// "My personal bests": records worked out from a learner's own finished stages (pure, no database).
const { dayKey } = require("./usage");

const pct = (a) => (a.maxScore > 0 ? (a.score / a.maxScore) * 100 : 0);
const when = (a) => new Date(a.updatedAt || a.createdAt).getTime();
const dateText = (a) => new Date(when(a) + 5.5 * 3600e3).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const stageName = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const best = (list, better) => list.reduce((m, a) => (!m || better(a, m) ? a : m), null);

// attempts: submitted, non-diagnostic stages { stage, subject, topic, score, maxScore, timeSec, questionCount, updatedAt }
function personalBests(attempts, stats = {}) {
  const top = best(attempts.filter((a) => a.maxScore > 0), (a, m) => pct(a) > pct(m) || (pct(a) === pct(m) && a.maxScore > m.maxScore));
  const acc = best(attempts.filter((a) => a.maxScore > 0 && (a.questionCount || 0) >= 5), (a, m) => pct(a) > pct(m) || (pct(a) === pct(m) && when(a) > when(m)));
  const fast = best(attempts.filter((a) => a.maxScore > 0 && a.score === a.maxScore && a.timeSec > 0), (a, m) => a.timeSec < m.timeSec);
  return {
    bestScore: top && { score: top.score, max: top.maxScore, topic: top.topic, stage: stageName(top.stage), date: dateText(top) },
    accuracy: acc && { pct: Math.round(pct(acc)), subject: acc.subject || acc.topic, stage: stageName(acc.stage), date: dateText(acc) },
    fastest: fast && { timeSec: fast.timeSec, subject: fast.subject || fast.topic, stage: stageName(fast.stage), score: fast.score, max: fast.maxScore },
    streak: { best: Math.max(stats.longestStreak || 0, stats.currentStreak || 0), current: stats.currentStreak || 0 },
  };
}

// Topics practised in `monthKey` (YYYY-MM, India time): this month's best vs the best earlier result at the SAME stage.
function recordsByTopic(attempts, monthKey, limit = 6) {
  const monthOf = (a) => dayKey(when(a)).slice(0, 7);
  const groups = new Map();
  for (const a of attempts) {
    const k = String(a.topic || "").trim().toLowerCase();
    if (!k || !(a.maxScore > 0)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const rows = [];
  for (const list of groups.values()) {
    const now = list.filter((a) => monthOf(a) === monthKey);
    if (!now.length) continue;
    const b = best(now, (a, m) => pct(a) > pct(m) || (pct(a) === pct(m) && a.maxScore > m.maxScore));
    const prior = best(list.filter((a) => a.stage === b.stage && monthOf(a) < monthKey), (a, m) => a.score > m.score);
    rows.push({
      topic: b.topic, score: b.score, max: b.maxScore,
      was: prior ? { score: prior.score, max: prior.maxScore } : null,
      diff: prior ? b.score - prior.score : null,
      last: Math.max(...now.map(when)),
    });
  }
  return rows.sort((x, y) => y.last - x.last).slice(0, limit).map(({ last, ...r }) => r);
}

const shortName = (name = "") => { const p = name.trim().split(/\s+/).filter(Boolean); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0] || "Learner"; };

// Two learners above the current one, and the one below (4 rows), shifted at the top and bottom of the board.
function neighbours(rows, meIdx, size = 4) {
  if (meIdx < 0) return [];
  let start = Math.max(0, meIdx - 2);
  const end = Math.min(rows.length, start + size);
  start = Math.max(0, end - size);
  return rows.slice(start, end);
}

module.exports = { personalBests, recordsByTopic, shortName, neighbours };
