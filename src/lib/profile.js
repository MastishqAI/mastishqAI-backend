// Profile helpers: field checks, plan summary, referral codes. No database here, so they are easy to test.
const crypto = require("crypto");

const FIELDS = {
  name: (v) => (v.length >= 2 && v.length <= 80 ? v : null),
  phone: (v) => (v === "" || /^\+\d{1,4} \d{10}$/.test(v) ? v : null),   // country code + exactly 10 digits
  className: (v) => (v.length <= 60 ? v : null),
  school: (v) => (v.length <= 120 ? v : null),
  pincode: (v) => (v === "" || /^\d{6}$/.test(v) ? v : null),
};
const LABEL = { name: "Name", phone: "Mobile number", className: "Class", school: "School name", district: "City", state: "State", pincode: "Pincode", country: "Country" };
const HINT = { name: "Name must be 2 to 80 characters.", phone: "Enter a 10-digit mobile number with a country code, for example +91 9876543210.", pincode: "Pincode must be 6 digits.", country: "Country must be 2 to 60 characters." };

// Checks only the fields that were sent. Returns { values } or { error }.
function cleanProfile(body = {}) {
  const values = {};
  for (const [k, check] of Object.entries(FIELDS)) {
    if (body[k] === undefined) continue;
    const raw = String(body[k] ?? "").replace(/\s+/g, " ").trim();
    const ok = check(raw);
    if (ok === null) return { error: HINT[k] || `${LABEL[k]} is too long.` };
    values[k] = ok;
  }
  if (values.name) { const [first, ...rest] = values.name.split(" "); values.firstName = first; values.lastName = rest.join(" "); }
  return { values };
}

// What the Active Plan card shows. start = when the latest payment was made.
function planInfo(user, start, now = Date.now(), days = 30) {
  const exp = user?.planExpiresAt ? new Date(user.planExpiresAt).getTime() : 0;
  const active = user?.plan === "pro" && exp > now;
  if (!active) return { active: false };
  const from = start ? new Date(start).getTime() : exp - days * 864e5;
  const span = Math.max(exp - from, 1);
  return { active: true, start: new Date(from), expires: new Date(exp), days, pctLeft: Math.max(0, Math.min(100, Math.round(((exp - now) / span) * 100))) };
}

// Readable, unambiguous (no 0/O/1/I)
const newReferralCode = () => Array.from(crypto.randomBytes(8), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

// Keeps secrets out of the "Download my data" file
const SECRET = ["passwordHash", "resetToken", "resetTokenExpires", "__v"];
const scrub = (doc) => { const o = { ...(doc.toObject ? doc.toObject() : doc) }; SECRET.forEach((k) => delete o[k]); return o; };

module.exports = { cleanProfile, planInfo, newReferralCode, scrub, FIELDS };
