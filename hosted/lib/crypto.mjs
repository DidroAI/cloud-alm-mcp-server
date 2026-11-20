import {
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
export const clientSecret = (id) =>
  createHmac("sha256", key())
    .update("client-secret/" + id)
    .digest("base64url");
export function seal(purpose, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function open(purpose, text) {
  const bytes = Buffer.from(text, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(purpose));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString(),
  );
}
