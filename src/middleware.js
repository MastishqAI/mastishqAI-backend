const jwt = require("jsonwebtoken");

const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || "15m";
// short-lived access token (HS256, pinned so "alg: none" / other algorithms are rejected)
const sign = (user) =>
  jwt.sign({ id: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL, algorithm: "HS256" });

function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    req.user = { id: decoded.id, role: decoded.role };
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ success: false, message: "Forbidden" });

// wraps async handlers so thrown errors become JSON 500s instead of crashes
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorHandler(err, req, res, _next) {
  console.error(err);
  if (err.name === "CastError") return res.status(400).json({ success: false, message: "Invalid id" });
  res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
}

module.exports = { sign, auth, requireRole, wrap, errorHandler };
