const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanProfile, planInfo, newReferralCode, scrub } = require("../src/lib/profile");

test("profile fields are checked and tidied", () => {
  const r = cleanProfile({ name: "  Akash   Kumar Srivastava ", phone: "+91 9876543210", pincode: "226016", school: "  Fatima School " });
  assert.equal(r.values.name, "Akash Kumar Srivastava");
  assert.equal(r.values.firstName, "Akash"); assert.equal(r.values.lastName, "Kumar Srivastava");
  assert.equal(r.values.phone, "+91 9876543210"); assert.equal(r.values.school, "Fatima School");
});

test("bad values are refused with a plain message", () => {
  assert.match(cleanProfile({ pincode: "12345" }).error, /6 digits/);
  assert.match(cleanProfile({ phone: "abc" }).error, /mobile/i);
  assert.ok(cleanProfile({ phone: "+91 98765432" }).error);      // 8 digits
  assert.ok(cleanProfile({ phone: "+91 98765432101" }).error);   // 11 digits
  assert.ok(cleanProfile({ phone: "9876543210" }).error);        // no country code
  assert.match(cleanProfile({ name: "A" }).error, /Name/);
  assert.ok(cleanProfile({ school: "x".repeat(121) }).error);
});

test("a field can be cleared, and unknown fields are ignored", () => {
  assert.deepEqual(cleanProfile({ phone: "", pincode: "" }).values, { phone: "", pincode: "" });
  assert.deepEqual(cleanProfile({ role: "admin", passwordHash: "x", plan: "pro", state: "X", district: "Y", country: "Z" }).values, {});
});

test("plan summary: active with % left, or not active", () => {
  const NOW = Date.parse("2026-11-16T00:00:00Z");
  const p = planInfo({ plan: "pro", planExpiresAt: new Date(NOW + 15 * 864e5) }, new Date(NOW - 15 * 864e5), NOW);
  assert.equal(p.active, true); assert.equal(p.pctLeft, 50);
  assert.equal(planInfo({ plan: "pro", planExpiresAt: new Date(NOW - 1) }, null, NOW).active, false);
  assert.equal(planInfo({ plan: "free" }, null, NOW).active, false);
  assert.equal(planInfo(null, null, NOW).active, false);
});

test("invite codes are 8 readable characters and differ each time", () => {
  const a = newReferralCode(), b = newReferralCode();
  assert.match(a, /^[A-HJ-NP-Z2-9]{8}$/); assert.notEqual(a, b);
});

test("the data download never contains secrets", () => {
  const o = scrub({ toObject: () => ({ name: "A", passwordHash: "h", resetToken: "t", resetTokenExpires: 1, __v: 0, email: "a@b.c" }) });
  assert.deepEqual(o, { name: "A", email: "a@b.c" });
});

const { lookupPincode } = require("../src/lib/pincode");
test("pincode lookup returns city, state and country, or a plain error", async () => {
  const ok = async () => ({ ok: true, json: async () => [{ Status: "Success", PostOffice: [{ District: "Ghaziabad", State: "Uttar Pradesh", Country: "India" }] }] });
  assert.deepEqual((await lookupPincode("201001", ok)).place, { district: "Ghaziabad", state: "Uttar Pradesh", country: "India" });
  const none = async () => ({ ok: true, json: async () => [{ Status: "Error", PostOffice: null }] });
  assert.match((await lookupPincode("000000", none)).error, /couldn't find/i);
  const down = async () => { throw new Error("offline"); };
  assert.match((await lookupPincode("201001", down)).error, /try again/i);
  assert.match((await lookupPincode("12", ok)).error, /6 digits/);
});
