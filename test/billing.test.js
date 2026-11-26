const test = require("node:test");
const assert = require("node:assert/strict");
const { isPro, extendExpiry, verifyCheckout, verifyWebhook, hmac, PLAN } = require("../src/lib/billing");

const NOW = Date.parse("2026-11-16T00:00:00Z");

test("Pro is active only before the expiry date", () => {
  assert.equal(isPro({ plan: "pro", planExpiresAt: new Date(NOW + 1000) }, NOW), true);
  assert.equal(isPro({ plan: "pro", planExpiresAt: new Date(NOW - 1000) }, NOW), false);
  assert.equal(isPro({ plan: "free", planExpiresAt: new Date(NOW + 1000) }, NOW), false);
  assert.equal(isPro({ plan: "pro" }, NOW), false);
  assert.equal(isPro(null, NOW), false);
});

test("paying again adds time to what is left; an expired plan starts from now", () => {
  const left = new Date(NOW + 10 * 86400e3);
  assert.equal(extendExpiry(left, 30, NOW).getTime(), NOW + 40 * 86400e3);
  assert.equal(extendExpiry(new Date(NOW - 5 * 86400e3), 30, NOW).getTime(), NOW + 30 * 86400e3);
  assert.equal(extendExpiry(undefined, 30, NOW).getTime(), NOW + 30 * 86400e3);
});

test("checkout signature: valid passes; tampered, wrong secret or missing fails", () => {
  const sig = hmac("s3cret", "order_1|pay_1");
  assert.equal(verifyCheckout("s3cret", "order_1", "pay_1", sig), true);
  assert.equal(verifyCheckout("s3cret", "order_1", "pay_2", sig), false);
  assert.equal(verifyCheckout("other", "order_1", "pay_1", sig), false);
  assert.equal(verifyCheckout("s3cret", "order_1", "pay_1", undefined), false);
  assert.equal(verifyCheckout("", "order_1", "pay_1", sig), false);
});

test("webhook signature is checked over the raw body", () => {
  const body = Buffer.from('{"event":"payment.captured"}');
  const sig = hmac("whsec", body);
  assert.equal(verifyWebhook("whsec", body, sig), true);
  assert.equal(verifyWebhook("whsec", Buffer.from('{"event":"x"}'), sig), false);
  assert.equal(verifyWebhook("", body, sig), false);
});

test("default price is Rs 499 for 30 days (Rs 999 list price)", () => {
  assert.equal(PLAN.amountPaise, 49900);
  assert.equal(PLAN.listPricePaise, 99900);
  assert.equal(PLAN.days, 30);
});
