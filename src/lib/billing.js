// Pro plan helpers: pure functions (no database, no network) so they are easy to test.
const crypto = require("crypto");

const PLAN = {
  amountPaise: Number(process.env.PRO_PRICE_PAISE) || 49900,   // Rs 499
  listPricePaise: Number(process.env.PRO_LIST_PRICE_PAISE) || 99900,   // Rs 999, shown struck out (display only)
  days: Number(process.env.PRO_DAYS) || 30,
  currency: "INR",
};

const DAY = 86400e3;
const isPro = (u, now = Date.now()) => !!u && u.plan === "pro" && !!u.planExpiresAt && new Date(u.planExpiresAt).getTime() > now;

// Paying again while Pro adds time on top of what is left instead of throwing it away.
function extendExpiry(current, days, now = Date.now()) {
  const base = current && new Date(current).getTime() > now ? new Date(current).getTime() : now;
  return new Date(base + days * DAY);
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ""), "utf8"), y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");

// Checkout returns razorpay_signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
const verifyCheckout = (secret, orderId, paymentId, signature) => !!secret && !!orderId && !!paymentId && safeEqual(hmac(secret, `${orderId}|${paymentId}`), signature);
// Webhooks: X-Razorpay-Signature = HMAC_SHA256(raw body, webhook_secret)
const verifyWebhook = (secret, rawBody, signature) => !!secret && !!rawBody && safeEqual(hmac(secret, rawBody), signature);

module.exports = { PLAN, isPro, extendExpiry, verifyCheckout, verifyWebhook, hmac };
