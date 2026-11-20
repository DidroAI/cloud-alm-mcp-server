export const json = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export const fail = (error = "invalid_request", status = 400) => {
  throw json({ error }, status);
};
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
export function page(title, content, headers = {}) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/connect.css"><main><h1>${title}</h1>${content}</main></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "same-origin",
        "content-security-policy":
          "default-src 'none'; style-src 'self'; form-action 'self' https://chatgpt.com https://claude.ai; frame-ancestors 'none'; base-uri 'none'",
        ...headers,
      },
    },
  );
}
