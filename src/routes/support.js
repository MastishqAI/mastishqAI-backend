const router = require("express").Router();
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { SupportTicket, User } = require("../models");
const { auth, wrap } = require("../middleware");

const DIR = process.env.UPLOAD_DIR ? path.join(process.env.UPLOAD_DIR, "support") : path.join(__dirname, "..", "..", "uploads", "support");
fs.mkdirSync(DIR, { recursive: true });

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" };

// files get a random name on disk (the original name is only kept as text)
const upload = multer({
  storage: multer.diskStorage({
    destination: DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + (TYPES[file.mimetype] || "")),
  }),
  limits: { files: MAX_FILES, fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => (TYPES[file.mimetype] ? cb(null, true) : cb(new Error("Only PDF, PNG and JPG files can be attached."))),
});

// the declared type can be faked, so also check the file's first bytes
function looksRight(file) {
  const fd = fs.openSync(file.path, "r");
  const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0); fs.closeSync(fd);
  if (file.mimetype === "application/pdf") return b.slice(0, 4).toString() === "%PDF";
  if (file.mimetype === "image/png") return b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (file.mimetype === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return false;
}
const discard = (files = []) => files.forEach((f) => fs.unlink(f.path, () => {}));

router.use(auth);

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user.id, message: { success: false, message: "You've sent several queries recently. Please try again later." } });

router.post("/", limiter, (req, res, next) => {
  upload.array("files", MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Each file must be 5 MB or smaller." : err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT" ? `You can attach up to ${MAX_FILES} files.` : err.message;
    res.status(400).json({ success: false, message: msg });
  });
}, wrap(async (req, res) => {
  const message = String(req.body.message || "").trim();
  if (message.length < 10) { discard(req.files); return res.status(400).json({ success: false, message: "Please describe your issue (at least 10 characters)." }); }
  if (message.length > 4000) { discard(req.files); return res.status(400).json({ success: false, message: "Please keep your message under 4000 characters." }); }
  const bad = (req.files || []).filter((f) => !looksRight(f));
  if (bad.length) { discard(req.files); return res.status(400).json({ success: false, message: "One of the files isn't a real PDF, PNG or JPG." }); }

  const user = await User.findById(req.user.id).select("name email");
  const ticket = await SupportTicket.create({
    userId: req.user.id, name: user?.name, email: user?.email, message,
    attachments: (req.files || []).map((f) => ({ originalName: path.basename(f.originalname).slice(0, 120), storedName: f.filename, mime: f.mimetype, size: f.size })),
  });
  // No mail provider is connected yet: queries are saved and logged. Hook email (SES / Nodemailer) to support@mastishq.ai here.
  console.log(`Support query ${ticket._id} from ${user?.email} (${ticket.attachments.length} file(s))`);
  res.status(201).json({ success: true, ticketId: ticket._id });
}));

// the learner's own recent queries
router.get("/mine", wrap(async (req, res) => {
  const list = await SupportTicket.find({ userId: req.user.id }).sort("-createdAt").limit(10).lean();
  res.json({ success: true, tickets: list.map((t) => ({ id: t._id, message: t.message.slice(0, 140), status: t.status, files: t.attachments.length, createdAt: t.createdAt })) });
}));

module.exports = router;
