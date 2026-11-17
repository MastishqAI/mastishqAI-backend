const router = require("express").Router();
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const { Material, Chunk } = require("../models");
const { auth, wrap } = require("../middleware");
const { consume, refund, limitMessage } = require("../lib/usage");
const { chunkText, clean, sniff, looksLikeRefusal } = require("../lib/material");
const { transcribeImage, transcribePdf, aiEnabled } = require("../lib/ai");
const storage = require("../lib/storage");

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 40;
const MAX_FILES_PER_USER = 30;    // kept files per learner; delete one to add another

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_BYTES } });

// Text from the file. PDFs with a text layer are read directly (free); scans and photos go to the vision model.
async function readFile(buf, kind, filename, meter) {
  if (kind.mime === "application/pdf") {
    let text = "", pages = 0;
    try {
      const pdf = require("pdf-parse/lib/pdf-parse.js");
      const r = await pdf(buf, { max: MAX_PDF_PAGES });
      text = clean(r.text); pages = r.numpages || 0;
    } catch (e) { console.warn("pdf text layer unreadable, falling back to vision:", e.message); }
    if (text.length < Math.max(80, (pages || 1) * 60)) {                 // looks scanned
      if (pages > MAX_PDF_PAGES) { const e = new Error(`That PDF has ${pages} pages. Please upload up to ${MAX_PDF_PAGES} pages at a time.`); e.status = 400; throw e; }
      text = clean(await transcribePdf(buf, filename, meter));
    }
    return { text, pages: Math.min(pages || 1, MAX_PDF_PAGES) };
  }
  const text = clean(await transcribeImage(`data:${kind.mime};base64,${buf.toString("base64")}`, meter));
  return { text, pages: 1 };
}

router.use(auth);

const view = (m) => ({ id: m._id, name: m.name, mime: m.mime, size: m.size, pages: m.pages, chars: m.chars, createdAt: m.createdAt });

router.get("/", wrap(async (req, res) => {
  const list = await Material.find({ userId: req.user.id }).sort("-createdAt").limit(MAX_FILES_PER_USER).lean();
  res.json({ success: true, materials: list.map(view) });
}));

router.post("/", (req, res, next) => upload.single("file")(req, res, (err) => {
  if (!err) return next();
  res.status(400).json({ success: false, message: err.code === "LIMIT_FILE_SIZE" ? "That file is over 8 MB. Please use a smaller file or fewer pages." : "Couldn't read that upload." });
}), wrap(async (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ success: false, message: "Reading files isn't available right now." });
  const f = req.file;
  if (!f) return res.status(400).json({ success: false, message: "Choose a PDF, JPG or PNG file." });
  const kind = sniff(f.buffer);
  if (!kind) return res.status(400).json({ success: false, message: "Only real PDF, JPG and PNG files can be used." });
  if (await Material.countDocuments({ userId: req.user.id }) >= MAX_FILES_PER_USER) return res.status(400).json({ success: false, message: `You can keep up to ${MAX_FILES_PER_USER} files. Delete one to add another.` });

  const u = await consume(req.user, "upload");
  if (!u.ok) return res.status(429).json({ success: false, limitReached: "upload", message: limitMessage("upload", u.limit) });

  const name = (path.basename(String(f.originalname || "scan")).replace(/[^\w .()-]/g, "").slice(0, 80) || "scan") ;
  let read;
  try { read = await readFile(f.buffer, kind, name, { userId: req.user.id, feature: "upload" }); }
  catch (e) { await refund(req.user, "upload"); console.error("material read failed:", e.message); return res.status(e.status || 502).json({ success: false, message: e.status ? e.message : "We couldn't read that file just now. Please try again." }); }

  const pieces = chunkText(read.text);
  if (read.text.length < 40 || !pieces.length || looksLikeRefusal(read.text)) { await refund(req.user, "upload"); return res.status(422).json({ success: false, message: "We couldn't find readable text in that file. Try a clearer photo or a PDF with selectable text." }); }

  const id = crypto.randomBytes(8).toString("hex");
  const saved = await storage.put(`materials/${req.user.id}/${id}${kind.ext}`, f.buffer, kind.mime);
  const m = await Material.create({ userId: req.user.id, name, mime: kind.mime, size: f.size, storage: saved.storage, storageKey: saved.key, pages: read.pages, chars: read.text.length });
  await Chunk.insertMany(pieces.map((text, order) => ({ materialId: m._id, userId: req.user.id, order, text })));
  res.status(201).json({ success: true, material: view(m) });
}));

router.delete("/:id", wrap(async (req, res) => {
  const m = await Material.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!m) return res.status(404).json({ success: false, message: "File not found" });
  await Chunk.deleteMany({ materialId: m._id });
  await storage.del(m.storage, m.storageKey);
  res.json({ success: true });
}));

module.exports = router;
