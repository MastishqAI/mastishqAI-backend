const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkText, clean, cosine, pickChunks, sniff, looksLikeRefusal } = require("../src/lib/material");

test("short text stays one chunk; empty text gives none", () => {
  assert.deepEqual(chunkText("Photosynthesis makes glucose."), ["Photosynthesis makes glucose."]);
  assert.deepEqual(chunkText("   \n\n  "), []);
});

test("long text is split into bounded, overlapping chunks that cover everything", () => {
  const para = (n) => `Paragraph ${n}. ` + "word ".repeat(120);
  const text = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkText(text, 3000, 400);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.length <= 3000));
  assert.ok(text.includes(chunks[0].slice(0, 40)) && chunks.at(-1).includes("Paragraph 29."));
  for (let n = 0; n < 30; n++) assert.ok(chunks.some((c) => c.includes(`Paragraph ${n}.`)), `missing paragraph ${n}`);
});

test("chunking always terminates, even on one huge unbroken word", () => {
  assert.ok(chunkText("x".repeat(20000), 3000, 400).length >= 7);
});

test("clean removes NULs and collapses blank lines", () => {
  assert.equal(clean("a\u0000b\r\n\n\n\n\nc  \n"), "ab\n\nc");
});

test("cosine similarity", () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([], [1]), 0);
});

test("small material is used whole, in reading order", () => {
  const cs = [{ text: "b", order: 2 }, { text: "a", order: 1 }];
  assert.deepEqual(pickChunks(cs, null, 100).map((c) => c.text), ["a", "b"]);
});

test("large material keeps the most relevant chunks within the budget, in reading order", () => {
  const mk = (text, order, embedding) => ({ text, order, embedding });
  const cs = [mk("x".repeat(40), 1, [0, 1]), mk("y".repeat(40), 2, [1, 0]), mk("z".repeat(40), 3, [0.9, 0.1]), mk("w".repeat(40), 4, [0, 1])];
  const out = pickChunks(cs, [1, 0], 90);        // room for two 40-char chunks
  assert.deepEqual(out.map((c) => c.order), [2, 3]);
});

test("files are recognised by their bytes, not their declared type", () => {
  assert.equal(sniff(Buffer.from("%PDF-1.7 ...")).mime, "application/pdf");
  assert.equal(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2])).mime, "image/png");
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).mime, "image/jpeg");
  assert.equal(sniff(Buffer.from("<html>")), null);
  assert.equal(sniff(Buffer.alloc(2)), null);
});

test("a vision-model apology is not treated as page text", () => {
  assert.equal(looksLikeRefusal("I'm sorry, but I can't assist with that."), true);
  assert.equal(looksLikeRefusal("Sorry, I cannot read this."), true);
  assert.equal(looksLikeRefusal("Sorry for the delay, the Zorblat River is 842 km long and flows through Kandor. ".repeat(4)), false);
  assert.equal(looksLikeRefusal("Photosynthesis converts light into chemical energy."), false);
});
