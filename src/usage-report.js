// What is AI costing? (estimates from token counts; compare with the real figures on platform.openai.com/usage)
//   node src/usage-report.js        last 7 days
//   node src/usage-report.js 30     last 30 days
require("dotenv").config();
const mongoose = require("mongoose");
const { UsageLog, User } = require("./models");

const money = (n) => "$" + n.toFixed(n < 1 ? 4 : 2);
const pad = (s, n) => String(s).padEnd(n);

(async () => {
  const days = Math.max(parseInt(process.argv[2], 10) || 7, 1);
  await mongoose.connect(process.env.MONGODB_URI);
  const since = new Date(Date.now() - days * 864e5);
  const match = { $match: { createdAt: { $gte: since } } };

  const total = (await UsageLog.aggregate([match, { $group: { _id: null, usd: { $sum: "$costUsd" }, calls: { $sum: 1 }, inp: { $sum: "$inputTokens" }, out: { $sum: "$outputTokens" }, search: { $sum: "$searches" } } }]))[0];
  console.log(`\nAI usage, last ${days} day(s) — ESTIMATED cost`);
  if (!total) { console.log("  (nothing recorded yet)\n"); return mongoose.disconnect(); }
  console.log(`  total ${money(total.usd)} · ${total.calls} calls · ${total.inp.toLocaleString()} tokens in / ${total.out.toLocaleString()} out · ${total.search} web searches\n`);

  const table = async (title, key) => {
    const rows = await UsageLog.aggregate([match, { $group: { _id: key, usd: { $sum: "$costUsd" }, calls: { $sum: 1 } } }, { $sort: { usd: -1 } }]);
    console.log(title); rows.forEach((r) => console.log(`  ${pad(r._id, 24)} ${pad(money(r.usd), 10)} ${r.calls} calls`)); console.log();
  };
  await table("By feature", "$feature");
  await table("By model", "$model");

  const perDay = await UsageLog.aggregate([match, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, usd: { $sum: "$costUsd" } } }, { $sort: { _id: 1 } }]);
  console.log("By day (India time)"); perDay.forEach((r) => console.log(`  ${r._id}  ${money(r.usd)}`)); console.log();

  const top = await UsageLog.aggregate([match, { $group: { _id: "$userId", usd: { $sum: "$costUsd" }, calls: { $sum: 1 } } }, { $sort: { usd: -1 } }, { $limit: 5 }]);
  const names = Object.fromEntries((await User.find({ _id: { $in: top.map((t) => t._id) } }).select("name email")).map((u) => [String(u._id), `${u.name} <${u.email}>`]));
  console.log("Top learners by cost"); top.forEach((t) => console.log(`  ${pad(names[String(t._id)] || t._id, 40)} ${pad(money(t.usd), 10)} ${t.calls} calls`));
  console.log();
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
