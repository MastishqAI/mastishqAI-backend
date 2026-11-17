// Where uploaded files are kept: a private S3 bucket when S3_BUCKET is set, otherwise a local folder (development).
// On AWS, give the server an IAM role with s3:PutObject / GetObject / DeleteObject on the bucket: no access keys in code or .env.
const fs = require("fs");
const path = require("path");

const BUCKET = (process.env.S3_BUCKET || "").trim();
const LOCAL = path.join(process.env.UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads"), "materials");

let s3;
const sdk = () => {
  if (!s3) {
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
    s3 = { client: new S3Client({ region: process.env.S3_REGION || process.env.AWS_REGION || "ap-south-1" }), PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
  }
  return s3;
};
const safe = (key) => key.replace(/[^a-zA-Z0-9/_.-]/g, "_");

async function put(key, buffer, contentType) {
  key = safe(key);
  if (BUCKET) {
    const { client, PutObjectCommand } = sdk();
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType, ServerSideEncryption: "AES256" }));
    return { storage: "s3", key };
  }
  const file = path.join(LOCAL, key);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buffer);
  return { storage: "local", key };
}

async function get(storage, key) {
  if (storage === "s3") {
    const { client, GetObjectCommand } = sdk();
    const r = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return Buffer.from(await r.Body.transformToByteArray());
  }
  return fs.promises.readFile(path.join(LOCAL, key));
}

async function del(storage, key) {
  try {
    if (storage === "s3") { const { client, DeleteObjectCommand } = sdk(); await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); }
    else await fs.promises.unlink(path.join(LOCAL, key));
  } catch (e) { console.error("storage delete failed:", e.message); }
}

module.exports = { put, get, del, mode: () => (BUCKET ? "s3" : "local") };
