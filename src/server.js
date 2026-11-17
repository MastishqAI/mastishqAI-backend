require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const { errorHandler } = require("./middleware");

const isProd = process.env.NODE_ENV === "production";

// In production refuse to start with a missing or weak configuration (better a loud failure than an insecure server)
if (isProd) {
  const problems = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /dev-secret|change-me|secret$/i.test(process.env.JWT_SECRET)) problems.push("JWT_SECRET must be a random string of at least 32 characters");
  if (!process.env.MONGODB_URI || /localhost|127\.0\.0\.1/.test(process.env.MONGODB_URI)) problems.push("MONGODB_URI must point at your production database (not localhost)");
  if (!process.env.CLIENT_URL || !/^https:\/\//.test(process.env.CLIENT_URL.split(",")[0])) problems.push("CLIENT_URL must be your https website address, e.g. https://app.mastishq.ai");
  if (problems.length) { console.error("Refusing to start in production:\n - " + problems.join("\n - ")); process.exit(1); }
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_URL || "http://localhost:5173,http://localhost:5174").split(","), credentials: true }));
app.use(cookieParser());
// Razorpay webhooks are signed over the raw body, so this route must be mounted before express.json()
app.use("/api/payments/webhook", express.raw({ type: "*/*", limit: "256kb" }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(isProd ? "combined" : "dev"));

app.get("/", (_req, res) => res.send("SmartLearn API running"));
app.get("/health", (_req, res) =>
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? "connected" : "down" })
);

// brute-force protection on the credential endpoints
const limiter = (max) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many attempts, please try again in a few minutes." } });
app.use("/api/auth/login", limiter(30));
app.use("/api/auth/register", limiter(20));
app.use("/api/auth/forgot-password", limiter(10));
app.use("/api/auth/reset-password", limiter(10));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/onboarding", require("./routes/onboarding"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/xp", require("./routes/xp"));
app.use("/api/progress", require("./routes/progress"));
app.use("/api/ai", require("./routes/ai"));
app.use("/api/rooms", require("./routes/rooms"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/homework", require("./routes/homework"));
app.use("/api/practice", require("./routes/practice"));
app.use("/api/mistakes", require("./routes/mistakes"));
app.use("/api/home", require("./routes/home"));
app.use("/api/leaderboard", require("./routes/leaderboard"));
app.use("/api/support", require("./routes/support"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/materials", require("./routes/materials"));
app.use("/api/profile", require("./routes/profile"));

app.use((_req, res) => res.status(404).json({ success: false, message: "Route not found" }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected");
    const server = app.listen(PORT, () => console.log(`API listening on port ${PORT} (${isProd ? "production" : "development"})`));
    // finish in-flight requests, then exit (systemd sends SIGTERM on restart/stop)
    const stop = () => server.close(() => mongoose.connection.close(false).finally(() => process.exit(0)));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
