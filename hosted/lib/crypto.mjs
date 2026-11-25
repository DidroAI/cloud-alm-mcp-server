import {
  hkdfSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export const nonce = () => randomBytes(32).toString("base64url");
export const digest = (value) =>
  createHash("sha256").update(value).digest("base64url");
export const equal = (a, b) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
function key() {
  if (!/^[0-9a-f]{64}$/.test(process.env.CONNECT_KEY ?? ""))
    throw new Error("Invalid encryption configuration");
  return Buffer.from(process.env.CONNECT_KEY, "hex");
}
// One key per use, derived from the configured one: client ids, sign-in flows, stored grants and client secrets never share a key.
const derived = new Map();
function keyFor(use) {
  const root = key();
  const name = root.toString("hex") + "/" + use;
  if (!derived.has(name)) derived.set(name, Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), "cloud-alm-connect/" + use, 32)));
  return derived.get(name);
}
const useOf = (purpose) => purpose.split("/")[0];
export const clientSecret = (id) =>
  createHmac("sha256", keyFor("client-secret"))
    .update("client-secret/" + id)
    .digest("base64url");
export function seal(purpose, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(useOf(purpose)), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function open(purpose, text) {
  const bytes = Buffer.from(text, "base64url");
  // 12 bytes of nonce, a whole 16-byte tag, and at least one byte of data.
  if (bytes.length < 29) throw new Error("Not a sealed value");
  const cipher = createDecipheriv("aes-256-gcm", keyFor(useOf(purpose)), bytes.subarray(0, 12), { authTagLength: 16 });
  cipher.setAAD(Buffer.from(purpose));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString(),
  );
}
