const router = require("express").Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { User, RefreshToken } = require("../models");
const { COOKIE, hash, issueRefresh, clearCookie, revokeFamily, revokeAllFor } = require("../lib/session");
const { sign, auth, wrap } = require("../middleware");
const { isPro } = require("../lib/billing");

const publicUser = (u) => ({
  id: u._id, name: u.name, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role,
  onboarded: u.onboarded, goalName: u.goalName, phone: u.phone,
  plan: isPro(u) ? "pro" : "free", planExpiresAt: isPro(u) ? u.planExpiresAt : null,
});

// public config the login page needs (the Google client ID is not a secret)
router.get("/config", (_req, res) => res.json({ success: true, googleClientId: (process.env.GOOGLE_CLIENT_ID || "").replace(/^"|"$/g, "") || null }));

// Google sign-in: the browser sends the signed ID token ("credential"); we verify it with Google's keys
router.post("/google", wrap(async (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").replace(/^"|"$/g, "");
  if (!clientId) return res.status(503).json({ success: false, message: "Google sign-in isn't configured on the server." });
  let p;
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: String(req.body.credential || ""), audience: clientId });
    p = ticket.getPayload();
  } catch {
    return res.status(401).json({ success: false, message: "Google sign-in failed. Please try again." });
  }
  if (!p?.email || !p.email_verified) return res.status(401).json({ success: false, message: "Your Google email isn't verified." });

  let user = await User.findOne({ email: p.email.toLowerCase() });
  if (!user) {
    user = await User.create({
      name: p.name || p.email.split("@")[0], firstName: p.given_name, lastName: p.family_name,
      email: p.email, googleId: p.sub, picture: p.picture, role: "student",
    });
  } else if (!user.googleId) {
    user.googleId = p.sub; user.picture = user.picture || p.picture; await user.save();
  } else if (user.googleId !== p.sub) {
    return res.status(401).json({ success: false, message: "This email is linked to a different Google account." });
  }
  await issueRefresh(req, res, user);
  res.json({ success: true, token: sign(user), user: publicUser(user), isNew: !user.onboarded });
}));

router.post("/register", wrap(async (req, res) => {
  const { firstName, lastName, email, password, phone } = req.body;   // role is never taken from the request
  const name = (req.body.name || `${firstName || ""} ${lastName || ""}`).trim();
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ success: false, message: "Name, email and a 6+ character password are required" });
  if (await User.findOne({ email: email.toLowerCase() }))
    return res.status(409).json({ success: false, message: "Email already registered" });
  const user = await User.create({
    name, firstName, lastName, email, phone,
    passwordHash: await bcrypt.hash(password, 12),
    role: "student",                                        // teachers/admins are promoted by the site owner (see src/set-role.js)
    onboarded: false,
  });
  await issueRefresh(req, res, user);
  res.status(201).json({ success: true, token: sign(user), user: publicUser(user) });
}));

router.post("/login", wrap(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || "").toLowerCase() });
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash || "")))
    return res.status(401).json({ success: false, message: "Invalid email or password" });
  await issueRefresh(req, res, user);
  res.json({ success: true, token: sign(user), user: publicUser(user) });
}));

// Exchange the httpOnly refresh cookie for a new access token (and rotate the cookie).
// Always answers 200 so a logged-out browser doesn't log red errors: check `authenticated`.
router.post("/refresh", wrap(async (req, res) => {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return res.json({ success: true, authenticated: false });
  const row = await RefreshToken.findOne({ tokenHash: hash(raw) });
  if (!row || row.expiresAt < new Date()) { clearCookie(res); return res.json({ success: true, authenticated: false }); }
  if (row.revokedAt) {
    // A rotated token shows up again. A few seconds is a benign race (two tabs / double request);
    // later than that it looks like theft, so the whole session family is revoked.
    if (!(row.replacedBy && Date.now() - row.revokedAt.getTime() < 10000)) await revokeFamily(row.family);
    clearCookie(res);
    return res.json({ success: true, authenticated: false });
  }
  const user = await User.findById(row.userId);
  if (!user) { clearCookie(res); return res.json({ success: true, authenticated: false }); }
  const next = await issueRefresh(req, res, user, row.family);
  row.revokedAt = new Date();
  row.replacedBy = next.hash;
  await row.save();
  res.json({ success: true, authenticated: true, token: sign(user), user: publicUser(user) });
}));

router.post("/logout", wrap(async (req, res) => {
  const raw = req.cookies?.[COOKIE];
  if (raw) {
    const row = await RefreshToken.findOne({ tokenHash: hash(raw) });
    if (row) await revokeFamily(row.family);
  }
  clearCookie(res);
  res.json({ success: true });
}));

router.get("/me", auth, wrap(async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ success: true, user: user ? publicUser(user) : null });
}));

router.post("/change-password", auth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id);
  if (!(await bcrypt.compare(currentPassword || "", user.passwordHash)))
    return res.status(400).json({ success: false, message: "Current password is wrong" });
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ success: false, message: "New password must be 6+ characters" });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  await revokeAllFor(user._id);
  await issueRefresh(req, res, user);
  res.json({ success: true, message: "Password changed", token: sign(user) });
}));

// Forgot password sends a reset LINK. No email provider is wired up yet, so outside
// production the link is returned in the response for testing (plug SES/Nodemailer in where marked).
router.post("/forgot-password", wrap(async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || "").toLowerCase() });
  const out = { success: true, message: "If that email exists, a reset link was sent" };
  if (user) {
    const token = crypto.randomBytes(24).toString("hex");
    user.resetToken = crypto.createHash("sha256").update(token).digest("hex");
    user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    const link = `${process.env.CLIENT_URL?.split(",")[0] || "http://localhost:5173"}/reset-password?token=${token}`;
    // TODO: email `link` to the user here.
    if (process.env.NODE_ENV !== "production") out.devResetLink = link;
  }
  res.json(out);
}));

router.post("/reset-password", wrap(async (req, res) => {
  const { token, newPassword } = req.body;
  const hash = crypto.createHash("sha256").update(String(token || "")).digest("hex");
  const user = await User.findOne({ resetToken: hash, resetTokenExpires: { $gt: new Date() } });
  if (!user) return res.status(400).json({ success: false, message: "This reset link is invalid or has expired" });
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ success: false, message: "Password must be 6+ characters" });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.resetToken = undefined;
  user.resetTokenExpires = undefined;
  await user.save();
  await revokeAllFor(user._id);
  res.json({ success: true, message: "Password reset" });
}));

module.exports = router;
