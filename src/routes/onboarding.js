const router = require("express").Router();
const { User, Goal } = require("../models");
const { auth, wrap } = require("../middleware");
const { lookupPincode } = require("../lib/pincode");

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

// City / state / country come from the pincode (India Post), never typed by the learner
router.get("/pincode/:pin", wrap(async (req, res) => {
  const { place, error } = await lookupPincode(String(req.params.pin || ""));
  if (error) return res.status(400).json({ success: false, message: error });
  res.json({ success: true, ...place });
}));

// Step 2 — academic details
router.post("/academic", wrap(async (req, res) => {
  const school = String(req.body.school || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const className = String(req.body.className || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const pincode = String(req.body.pincode || "").trim();
  if (!school || !className) return res.status(400).json({ success: false, message: "Please fill in your school and course." });
  const { place, error } = await lookupPincode(pincode);
  if (error) return res.status(400).json({ success: false, message: error });
  await User.findByIdAndUpdate(req.user.id, { school, className, pincode, district: place.district, state: place.state, country: place.country });
  res.json({ success: true });
}));

// Step 3 — goals
router.post("/goals", wrap(async (req, res) => {
  const { goalName, goalText, dailyGoal } = req.body;
  if (!String(goalName || "").trim() || !String(goalText || "").trim() || !(parseInt(dailyGoal, 10) >= 1))
    return res.status(400).json({ success: false, message: "Please fill in your goal, a suggestion and your daily question count." });
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
