// Points, levels and badges screen: pure helpers (no database) plus the badge sync that reads real activity.
const { LEVELS, levelInfo } = require("./xp");

// ---- badges (the six from the design). Each is earned from real activity, never typed in by hand. ----
const BADGES = [
  { key: "rookie", name: "Rookie", desc: "Cleared your first stage", target: 1, hint: (c) => `${Math.min(c, 1)} of 1 stage` },
  { key: "skilled", name: "Skilled", desc: "Cleared 5 stages", target: 5, hint: (c) => `${Math.min(c, 5)} of 5 stages` },
  { key: "expert", name: "Expert", desc: "Scored 80% or more in a Hard stage", target: 80, hint: (c) => `Best Hard stage: ${Math.round(c)}%` },
  { key: "mastermind", name: "Mastermind", desc: "Cleared stages in 10 different topics", target: 10, hint: (c) => `${Math.min(c, 10)} of 10 topics` },
  { key: "legend", name: "Legend", desc: "Kept a 30-day practice streak", target: 30, hint: (c) => `${Math.min(c, 30)} of 30 days` },
  { key: "king", name: "King", desc: "Reached Level 10", target: 10, hint: (c) => `Level ${Math.min(c, 10)} of 10` },
];

// facts: { clearedStages, bestHardPct, topicsCleared, longestStreak, level }
function badgeProgress(facts) {
  const current = {
    rookie: facts.clearedStages, skilled: facts.clearedStages, expert: facts.bestHardPct,
    mastermind: facts.topicsCleared, legend: facts.longestStreak, king: facts.level,
  };
  return BADGES.map((b) => {
    const c = current[b.key] || 0;
    return { key: b.key, name: b.name, desc: b.desc, current: c, target: b.target, met: c >= b.target, pct: Math.min(100, Math.round((c / b.target) * 100)), hint: b.hint(c) };
  });
}

// ---- levels list for the screen ----
function levelRows(points) {
  const me = levelInfo(points);
  return LEVELS.map((l) => ({
    n: l.n, from: l.from, unlocks: l.unlocks,
    state: l.n < me.level ? "done" : l.n === me.level ? "current" : l.n === me.level + 1 ? "next" : "locked",
    ...(l.n === me.level && { pct: me.next ? Math.round((points / me.next) * 100) : 100 }),   // the design shows points / next level start (1,250 / 1,400 = 89%)
    ...(l.n === me.level + 1 && { toGo: Math.max(0, l.from - points) }),
  }));
}

// ---- activity heatmap ----
const heatLevel = (xp) => (xp <= 0 ? 0 : xp < 20 ? 1 : xp < 50 ? 2 : xp < 100 ? 3 : 4);

// A month as weeks (Sunday first). Days outside the month are null. xpByDay: { "2026-10-05": 40 }
function monthGrid(year, month, xpByDay) {          // month: 1-12
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const xp = xpByDay[date] || 0;
    cells.push({ date, xp, level: heatLevel(xp) });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Monday-first bars for the week containing `dayKey` ("YYYY-MM-DD", India date)
function weekBars(dayKey, xpByDay) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(d.getTime() + (i - mondayOffset) * 864e5).toISOString().slice(0, 10);
    out.push({ date: x, label: "MTWTFSS"[i], xp: xpByDay[x] || 0, future: x > dayKey });
  }
  return out;
}

module.exports = { BADGES, badgeProgress, levelRows, heatLevel, monthGrid, weekBars };
