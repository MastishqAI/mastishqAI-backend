const router = require("express").Router();
const bcrypt = require("bcryptjs");
const models = require("../models");
const { User, Payment, Material, UserStats, XpEvent, StageAttempt, Practice, Mistake, Conversation, Notification, SupportTicket } = models;
const { auth, wrap } = require("../middleware");
const { cleanProfile, planInfo, newReferralCode, scrub } = require("../lib/profile");
const { sniff } = require("../lib/material");
const { LIMITS, PRO_MULT } = require("../lib/usage");
const { BONUS } = require("../lib/referral");
const { PLAN } = require("../lib/billing");
const storage = require("../lib/storage");
const { clearCookie } = require("../lib/session");

router.use(auth);

const MAX_PICTURE = 60 * 1024;

async function referralCode(user) {
  for (let i = 0; !user.referralCode && i < 5; i++) {
    try { user.referralCode = newReferralCode(); await user.save(); } catch (e) { if (e.code !== 11000) throw e; user.referralCode = undefined; }
  }
  return user.referralCode;
}

const view = async (user) => {
  const paid = await Payment.findOne({ userId: user._id, status: "paid" }).sort("-paidAt").lean();
  const plan = planInfo(user, paid?.paidAt, Date.now(), paid?.days || PLAN.days);
  const mult = plan.active ? PRO_MULT : 1;
  return {
    name: user.name, email: user.email, phone: user.phone || "", className: user.className || "", school: user.school || "",
    district: user.district || "", state: user.state || "", pincode: user.pincode || "", country: user.country || "India",
    picture: user.picture || null, signIn: user.googleId ? "google" : "email", hasPassword: !!user.passwordHash, role: user.role,
    goalName: user.goalName || "", goalText: user.goalText || "", subjects: user.subjects || [],
    plan: { ...plan, limits: { quiz: LIMITS.quiz * mult, chat: LIMITS.chat * mult } },
    invite: { code: await referralCode(user), bonusChats: user.bonusChats || 0, reward: BONUS },
  };
};

router.get("/", wrap(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: "Account not found" });
  res.json({ success: true, profile: await view(user) });
}));

router.patch("/", wrap(async (req, res) => {
  const { values, error } = cleanProfile(req.body);
  if (error) return res.status(400).json({ success: false, message: error });
  if (!Object.keys(values).length) return res.status(400).json({ success: false, message: "Nothing to update" });
  const user = await User.findByIdAndUpdate(req.user.id, { $set: values }, { new: true });
  res.json({ success: true, profile: await view(user) });
}));

// profile photo: the browser shrinks it to a small square JPEG first, so it can live on the user record
router.put("/picture", wrap(async (req, res) => {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ""));
  if (!m) return res.status(400).json({ success: false, message: "Please choose a JPG or PNG photo." });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_PICTURE) return res.status(400).json({ success: false, message: "That photo is too large. Please choose a smaller one." });
  const kind = sniff(buf);
  if (!kind || kind.mime === "application/pdf") return res.status(400).json({ success: false, message: "That doesn't look like a real photo." });
  await User.updateOne({ _id: req.user.id }, { $set: { picture: `data:${kind.mime};base64,${m[2]}` } });
  res.json({ success: true, picture: `data:${kind.mime};base64,${m[2]}` });
}));

router.delete("/picture", wrap(async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $unset: { picture: 1 } });
  res.json({ success: true });
}));

// goal + subjects from the My goals card
router.patch("/goals", wrap(async (req, res) => {
  const goals = await models.Goal.find().select("name").lean();
  const goalName = String(req.body.goalName || "").trim();
  if (!goals.some((g) => g.name === goalName)) return res.status(400).json({ success: false, message: "Please pick one of the suggested goals." });
  const subjects = [...new Set((Array.isArray(req.body.subjects) ? req.body.subjects : []).map((s) => String(s).replace(/\s+/g, " ").trim()).filter((s) => s && s.length <= 40))].slice(0, 30);
  if (!subjects.length) return res.status(400).json({ success: false, message: "Keep at least one subject." });
  const goalText = String(req.body.goalText || "").trim().slice(0, 300);
  const user = await User.findByIdAndUpdate(req.user.id, { $set: { goalName, goalText, subjects } }, { new: true });
  res.json({ success: true, profile: await view(user) });
}));

// "Download my data"
router.get("/export", wrap(async (req, res) => {
  const user = await User.findById(req.user.id);
  const uid = user._id;
  const [stats, xp, attempts, practices, mistakes, chats, notes, tickets, materials, payments] = await Promise.all([
    UserStats.findOne({ userId: uid }).lean(), XpEvent.find({ userId: uid }).lean(), StageAttempt.find({ userId: uid }).lean(),
    Practice.find({ userId: uid }).lean(), Mistake.find({ userId: uid }).lean(), Conversation.find({ userId: uid }).lean(),
    Notification.find({ userId: uid }).lean(), SupportTicket.find({ userId: uid }).select("-attachments.storedName").lean(),
    Material.find({ userId: uid }).select("name mime size pages chars createdAt").lean(),
    Payment.find({ userId: uid }).select("orderId paymentId amount currency days status paidAt createdAt").lean(),
  ]);
  const body = { exportedAt: new Date().toISOString(), account: scrub(user), stats, pointsHistory: xp, stages: attempts, practices, mistakes, aiChats: chats, notifications: notes, supportQueries: tickets, uploadedFiles: materials, payments };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="mastishq-my-data.json"`);
  res.send(JSON.stringify(body, null, 2));
}));

// "Delete account": removes the account and everything the learner created. Payment records stay because accounting rules require them.
router.delete("/", wrap(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: "Account not found" });
  if (user.role !== "student") return res.status(403).json({ success: false, message: "To close a teacher or admin account, please contact support." });
  if (String(req.body.confirm || "").trim().toUpperCase() !== "DELETE") return res.status(400).json({ success: false, message: "Type DELETE to confirm." });
  if (user.passwordHash && !(await bcrypt.compare(String(req.body.password || ""), user.passwordHash))) return res.status(400).json({ success: false, message: "Password is wrong." });

  const files = await Material.find({ userId: user._id }).lean();
  for (const f of files) await storage.del(f.storage, f.storageKey);
  const KEEP = new Set(["User", "Payment"]);
  for (const [name, M] of Object.entries(models)) {
    if (KEEP.has(name) || !M.schema) continue;
    const field = ["userId", "ownerId", "studentId"].find((f) => M.schema.path(f));
    if (field) await M.deleteMany({ [field]: user._id });
  }
  await User.updateMany({ referredBy: user._id }, { $unset: { referredBy: 1 } });
  await User.deleteOne({ _id: user._id });
  clearCookie(res);
  res.json({ success: true });
}));

module.exports = router;
