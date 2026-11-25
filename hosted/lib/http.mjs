export const json = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export const fail = (error = "invalid_request", status = 400) => {
  throw json({ error }, status);
};
/** Who sent a request, as the platform reports it. */
export const senderOf = (req) =>
  req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
/**
 * At most `max` requests per sender in `windowMs`, per running instance: a
 * first line against someone using the sign-in to try keys in bulk.
 */
export function createLimiter({ max, windowMs, now = Date.now }) {
  const seen = new Map();
  return (sender) => {
    const at = now();
    const times = (seen.get(sender) ?? []).filter((t) => at - t < windowMs);
    if (times.length >= max) return false;
    times.push(at);
    seen.set(sender, times);
    if (seen.size > 5000) for (const [key, list] of seen) if (!list.some((t) => at - t < windowMs)) seen.delete(key);
    return true;
  };
}
export async function limited(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) fail();
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      fail("request_too_large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export function page(title, content, headers = {}, base = "") {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="icon" href="${base}/assets/favicon.png"><link rel="stylesheet" href="${base}/dropzone.css"><link rel="stylesheet" href="${base}/connect.css">
    <header class="masthead"><a class="brand" href="https://didro.ai" aria-label="Didro"><img src="${base}/assets/logo-didro.png" alt="Didro"></a><span>SAP Cloud ALM</span></header>
    <main class="consent"><h1>${title}</h1>${content}</main></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "same-origin",
        "content-security-policy":
          "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; form-action 'self' https://chatgpt.com https://claude.ai; frame-ancestors 'none'; base-uri 'none'",
        ...headers,
      },
    },
  );
}
