// Pure helpers for AI-written multiple-choice questions (no network): structure checks, shuffling, de-duplication.
// Modelled on the old SmartLearn rules (4 options, exactly one correct, explanation required, no duplicates).

const KEYS = ["option1", "option2", "option3", "option4"];
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// Options like "All of the above" / "Both A and B" depend on their position, so such questions must NOT be shuffled.
const POSITIONAL = /\b(all|none|both|neither)\b.*\b(above|these|options?)\b|\b(a|b|c|d)\s*(and|&|,)\s*(a|b|c|d)\b|\bonly\s+(a|b|c|d)\b/i;
const hasPositionalOption = (options) => options.some((o) => POSITIONAL.test(String(o)));

// structured-output item {text, options:{option1..4}, correctOptionKey, explanation, subtopic}  ->  internal shape
function fromStructured(raw, fallbackTopic = "") {
  if (!raw || typeof raw !== "object") return null;
  const opts = raw.options && !Array.isArray(raw.options) ? KEYS.map((k) => raw.options[k]) : Array.isArray(raw.options) ? raw.options : [];
  const correctIndex = KEYS.indexOf(raw.correctOptionKey);
  return {
    text: String(raw.text ?? "").trim(),
    options: opts.map((o) => String(o ?? "").trim()),
    correctIndex: correctIndex >= 0 ? correctIndex : Number.isInteger(raw.correctIndex) ? raw.correctIndex : -1,
    explanation: String(raw.explanation ?? "").trim(),
    calc: String(raw.calc ?? "").trim(),
    subtopic: String(raw.subtopic || fallbackTopic || "").trim(),
  };
}

// returns "" when valid, otherwise the reason it is not
function problemWith(q) {
  if (!q) return "empty";
  if (q.text.length < 8) return "question text too short";
  if (!Array.isArray(q.options) || q.options.length !== 4) return "needs exactly 4 options";
  if (q.options.some((o) => !o)) return "empty option";
  if (new Set(q.options.map(norm)).size !== 4) return "duplicate options";
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) return "no valid correct option";
  if (!q.explanation) return "missing explanation";
  return "";
}

// Fisher–Yates. The correct answer follows its text to the new position.
function shuffleOptions(q, rng = Math.random) {
  if (hasPositionalOption(q.options)) return { ...q };
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), correctIndex: order.indexOf(q.correctIndex) };
}

// drop questions already seen (case/space-insensitive); mutates `seen`
function dedupe(list, seen = new Set()) {
  return list.filter((q) => { const k = norm(q.text); if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { KEYS, norm, fromStructured, problemWith, shuffleOptions, dedupe, hasPositionalOption };
