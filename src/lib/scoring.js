// Scoring in one pure place (same rules as the old SmartLearn: 2/3/4 marks per question, 70% to pass).
const PASS_PERCENT = 70;

const STAGES = {
  easy: { questions: 10, pointsEach: 2, next: "medium", label: "Easy" },
  medium: { questions: 20, pointsEach: 3, next: "hard", label: "Medium" },
  hard: { questions: 40, pointsEach: 4, next: null, label: "Hard" },
  diagnostic: { questions: 20, pointsEach: 1, next: null, label: "Diagnostic" },
};

// pass mark follows the REAL number of questions, rounded up (e.g. 10 x 2 = 20 marks -> 14)
const passMarkFor = (questionCount, pointsEach) => Math.ceil((questionCount * pointsEach * PASS_PERCENT) / 100);

// questions: [{ correct: true|false|null, selectedIndex, timeSec, subtopic }]  (null/-1 = not answered)
function computeResult({ questions, pointsEach, passMark, isDiagnostic = false }) {
  const total = questions.length;
  const correct = questions.filter((q) => q.correct === true).length;
  const skipped = questions.filter((q) => q.selectedIndex === null || q.selectedIndex === undefined || q.selectedIndex === -1).length;
  const wrong = total - correct;                       // skipped questions count as wrong
  const maxScore = total * pointsEach;
  const score = correct * pointsEach;
  const timeSec = questions.reduce((s, q) => s + (q.timeSec || 0), 0);
  return {
    total, correct, wrong, skipped, score, maxScore,
    marksLost: maxScore - score,
    cleared: isDiagnostic ? true : score >= passMark,
    marksToGo: isDiagnostic ? 0 : Math.max(0, passMark - score),
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    avgTimeSec: total ? Math.round(timeSec / total) : 0,
    timeSec,
  };
}

// marks lost per sub-topic; always sums to (maxScore - score)
function marksLostBySubtopic(questions, pointsEach, fallbackTopic = "") {
  const by = {};
  questions.filter((q) => q.correct !== true).forEach((q) => { const k = q.subtopic || fallbackTopic; by[k] = (by[k] || 0) + pointsEach; });
  return Object.entries(by).map(([topic, lost]) => ({ topic, lost })).sort((a, b) => b.lost - a.lost);
}

module.exports = { PASS_PERCENT, STAGES, passMarkFor, computeResult, marksLostBySubtopic };
