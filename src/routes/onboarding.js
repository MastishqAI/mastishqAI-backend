const router = require("express").Router();
const { User, Goal } = require("../models");
const { auth, wrap } = require("../middleware");

const SUBJECTS = [
  "Mathematics", "Physics", "Chemistry", "Biology", "English", "Hindi",
  "History", "Geography", "Political Science", "Economics", "Accountancy",
  "Computer Science", "Business Studies", "Environmental Science", "Sanskrit",
  "Psychology", "Sociology", "Physical Education", "Art & Design", "Music",
  "Statistics", "Legal Studies", "Entrepreneurship", "Information Practices",
];

router.use(auth);

router.get("/goals", wrap(async (_req, res) => {
  res.json({ success: true, goals: await Goal.find().sort("order") });
}));

router.get("/subjects", wrap(async (_req, res) => res.json({ success: true, subjects: SUBJECTS })));

// Step 2 — academic details
router.post("/academic", wrap(async (req, res) => {
  const { school, className, district, state, pincode } = req.body;
  await User.findByIdAndUpdate(req.user.id, { school, className, district, state, pincode });
  res.json({ success: true });
}));

// Step 3 — goals
router.post("/goals", wrap(async (req, res) => {
  const { goalName, goalText, dailyGoal } = req.body;
  await User.findByIdAndUpdate(req.user.id, {
    goalName, goalText, dailyGoal: Math.min(Math.max(parseInt(dailyGoal, 10) || 10, 1), 200),
  });
  res.json({ success: true });
}));

// Step 4 — subjects, finishes onboarding
router.post("/subjects", wrap(async (req, res) => {
  const subjects = (Array.isArray(req.body.subjects) ? req.body.subjects : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
  if (!subjects.length) return res.status(400).json({ success: false, message: "Pick at least one subject" });
  await User.findByIdAndUpdate(req.user.id, { subjects, onboarded: true });
  res.json({ success: true });
}));

module.exports = router;
