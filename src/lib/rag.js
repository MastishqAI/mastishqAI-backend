// Retrieval for learner material: turns "the files this practice uses" + a query into the text the question writer should read.
const { Material, Chunk } = require("../models");
const { embed } = require("./ai");
const { pickChunks } = require("./material");

const BUDGET = Number(process.env.RAG_CONTEXT_CHARS) || 24000;   // ~6k tokens of source per call

// Short material goes in whole (no embedding cost). Long material is embedded once, then only the parts most relevant
// to the topic / description are used.
async function buildContext({ userId, materialIds, query, meter, maxChars = BUDGET }) {
  const mats = await Material.find({ _id: { $in: materialIds }, userId }).select("name").lean();
  if (!mats.length) return null;
  const rank = new Map(mats.map((m, i) => [String(m._id), i]));
  const slim = await Chunk.find({ materialId: { $in: mats.map((m) => m._id) } }).select("-embedding").lean();
  if (!slim.length) return null;
  const total = slim.reduce((s, c) => s + c.text.length, 0);

  let chunks = slim.map((c) => ({ ...c, order: (rank.get(String(c.materialId)) ?? 0) * 1e6 + c.order }));
  let queryVec = null;
  if (total > maxChars) {
    const withVec = await Chunk.find({ materialId: { $in: mats.map((m) => m._id) } }).select("embedding").lean();
    const vecById = new Map(withVec.map((c) => [String(c._id), c.embedding]));
    const missing = chunks.filter((c) => !vecById.get(String(c._id))?.length);
    if (missing.length) {
      const vecs = await embed(missing.map((c) => c.text), meter);
      await Chunk.bulkWrite(missing.map((c, i) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { embedding: vecs[i] } } } })));
      missing.forEach((c, i) => vecById.set(String(c._id), vecs[i]));
    }
    chunks = chunks.map((c) => ({ ...c, embedding: vecById.get(String(c._id)) }));
    queryVec = (await embed([String(query || "").slice(0, 2000) || "main ideas"], meter))[0];
  }
  const picked = pickChunks(chunks, queryVec, maxChars);
  const nameOf = new Map(mats.map((m) => [String(m._id), m.name]));
  let text = "", last = null;
  for (const c of picked) {
    const id = String(c.materialId);
    if (id !== last) { text += `${text ? "\n\n" : ""}[From: ${nameOf.get(id)}]\n`; last = id; }
    text += c.text + "\n\n";
  }
  return { text: text.trim(), names: mats.map((m) => m.name), partial: total > maxChars };
}

module.exports = { buildContext };
