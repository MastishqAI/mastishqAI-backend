const crypto = require("crypto");
const { RefreshToken } = require("../models");

const COOKIE = "rt";
const REFRESH_DAYS = parseInt(process.env.REFRESH_TOKEN_DAYS, 10) || 30;
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");

const cookieOpts = () => ({
  httpOnly: true,                                   // JavaScript can never read it
  secure: process.env.NODE_ENV === "production",    // HTTPS only in production
  sameSite: "lax",                                  // not sent on cross-site POSTs (CSRF)
  path: "/api/auth",                                // only sent to the auth endpoints
  maxAge: REFRESH_DAYS * 864e5,
});

// create a refresh token (new login = new family; rotation keeps the family) and set the cookie
async function issueRefresh(req, res, user, family = crypto.randomUUID()) {
  const raw = crypto.randomBytes(48).toString("base64url");
  await RefreshToken.create({
    userId: user._id, tokenHash: hash(raw), family,
    expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5),
    userAgent: (req.headers["user-agent"] || "").slice(0, 200), ip: req.ip,
  });
  res.cookie(COOKIE, raw, cookieOpts());
  return { raw, family, hash: hash(raw) };
}

const clearCookie = (res) => res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
const revokeFamily = (family) => RefreshToken.updateMany({ family, revokedAt: null }, { revokedAt: new Date() });
const revokeAllFor = (userId) => RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });

module.exports = { COOKIE, hash, issueRefresh, clearCookie, revokeFamily, revokeAllFor };
