// Pure helpers for learner-uploaded study material (no database, no network): cleaning, chunking, ranking, file sniffing.
const MAX_CHARS = 150000;        // text kept per file
const CHUNK = 3000;              // ~750 tokens
const OVERLAP = 400;

const clean = (t = "") => String(t).replace(/\u0000/g, "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);

// Split on paragraph / sentence boundaries where possible, with a little overlap so an idea cut in half still appears whole in one chunk.
function chunkText(text, size = CHUNK, overlap = OVERLAP) {
  const t = clean(text);
  const out = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + size, t.length);
    if (end < t.length) {
      const cut = Math.max(t.lastIndexOf("\n\n", end), t.lastIndexOf(". ", end), t.lastIndexOf("\n", end));
      if (cut > i + size * 0.5) end = cut + 1;
    }
    const piece = t.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a?.length || 0, b?.length || 0);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// chunks: [{ text, embedding, order }]. Returns the best-matching chunks that fit the character budget, back in reading order.
function pickChunks(chunks, queryVec, maxChars) {
  const total = chunks.reduce((s, c) => s + c.text.length, 0);
  if (total <= maxChars) return chunks.slice().sort((x, y) => x.order - y.order);
  const ranked = chunks.map((c) => ({ c, score: cosine(queryVec, c.embedding) })).sort((x, y) => y.score - x.score);
  const chosen = [];
  let used = 0;
  for (const { c } of ranked) {
    if (used + c.text.length > maxChars) continue;
    chosen.push(c); used += c.text.length;
  }
  return chosen.sort((x, y) => x.order - y.order);
}

// Declared MIME types can be faked, so identify the file from its first bytes.
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf.slice(0, 4).toString() === "%PDF") return { mime: "application/pdf", ext: ".pdf" };
  if (buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return { mime: "image/png", ext: ".png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  return null;
}

// When the vision model can't read a page it replies with an apology instead of text; never store that as study material.
const looksLikeRefusal = (t = "") => t.trim().length < 160 && /^(i'?m sorry|sorry|i (can'?t|cannot|am unable|'m unable)|unable to)/i.test(t.trim());

module.exports = { looksLikeRefusal, MAX_CHARS, CHUNK, OVERLAP, clean, chunkText, cosine, pickChunks, sniff };
