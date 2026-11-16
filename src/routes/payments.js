const router = require("express").Router();
const { User, Payment } = require("../models");
const { auth, wrap } = require("../middleware");
const { PLAN, isPro, extendExpiry, verifyCheckout, verifyWebhook } = require("../lib/billing");

const keyId = () => (process.env.RAZORPAY_KEY_ID || "").trim();
const keySecret = () => (process.env.RAZORPAY_KEY_SECRET || "").trim();
const configured = () => !!(keyId() && keySecret());

async function razorpay(path, body) {
  const r = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${keyId()}:${keySecret()}`).toString("base64") },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.error?.description || "Payment provider error"); e.status = 502; throw e; }
  return data;
}

// Credit a paid order exactly once (checkout verify and the webhook can both arrive).
async function creditOrder(orderId, paymentId) {
  const pay = await Payment.findOneAndUpdate(
    { orderId, status: { $ne: "paid" } },
    { $set: { status: "paid", paymentId, paidAt: new Date() } },
    { new: true },
  );
  if (!pay) return false;                       // unknown order, or already credited
  const u = await User.findById(pay.userId).select("planExpiresAt");
  await User.updateOne({ _id: pay.userId }, { $set: { plan: "pro", planExpiresAt: extendExpiry(u?.planExpiresAt, pay.days) } });
  return true;
}

// what the upgrade card needs; the key ID is public, the secret never leaves the server
router.get("/config", (_req, res) => res.json({ success: true, enabled: configured(), keyId: configured() ? keyId() : null, amount: PLAN.amountPaise / 100, currency: PLAN.currency, days: PLAN.days }));

router.get("/status", auth, wrap(async (req, res) => {
  const u = await User.findById(req.user.id).select("plan planExpiresAt").lean();
  res.json({ success: true, plan: isPro(u) ? "pro" : "free", planExpiresAt: isPro(u) ? u.planExpiresAt : null });
}));

router.post("/order", auth, wrap(async (req, res) => {
  if (!configured()) return res.status(503).json({ success: false, message: "Payments are not available yet." });
  const order = await razorpay("/orders", {
    amount: PLAN.amountPaise, currency: PLAN.currency,
    receipt: `pro_${String(req.user.id).slice(-8)}_${Date.now().toString(36)}`,
    notes: { userId: String(req.user.id), plan: "pro" },
  });
  await Payment.create({ userId: req.user.id, orderId: order.id, amount: PLAN.amountPaise, currency: PLAN.currency, days: PLAN.days });
  res.json({ success: true, orderId: order.id, amount: PLAN.amountPaise, currency: PLAN.currency, keyId: keyId() });
}));

// called by the browser after Razorpay Checkout succeeds; the signature proves Razorpay (not the user) says it was paid
router.post("/verify", auth, wrap(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body || {};
  if (!verifyCheckout(keySecret(), orderId, paymentId, sig)) return res.status(400).json({ success: false, message: "Payment could not be verified." });
  const own = await Payment.findOne({ orderId, userId: req.user.id }).lean();
  if (!own) return res.status(404).json({ success: false, message: "Order not found." });
  await creditOrder(orderId, paymentId);
  const u = await User.findById(req.user.id).select("plan planExpiresAt").lean();
  res.json({ success: true, plan: isPro(u) ? "pro" : "free", planExpiresAt: u?.planExpiresAt });
}));

// safety net if the browser closed before /verify: set the webhook URL in the Razorpay dashboard and RAZORPAY_WEBHOOK_SECRET
router.post("/webhook", wrap(async (req, res) => {
  const secret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  const raw = Buffer.isBuffer(req.body) ? req.body : null;
  if (!verifyWebhook(secret, raw, req.headers["x-razorpay-signature"])) return res.status(400).json({ success: false });
  let ev; try { ev = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ success: false }); }
  const p = ev?.payload?.payment?.entity;
  if ((ev.event === "payment.captured" || ev.event === "order.paid") && p?.order_id && p?.id) {
    const pay = await Payment.findOne({ orderId: p.order_id }).lean();
    if (pay && p.amount === pay.amount) await creditOrder(p.order_id, p.id);   // amount must match what we asked for
  }
  res.json({ success: true });
}));

module.exports = router;
