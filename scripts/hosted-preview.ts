import { createHttpHandler, BASE_URL_HEADER, WEB_URL_HEADER } from "../src/http.js";
import { BASE_URL, TENANT } from "../test/tenant.js";

/** The preview's entire SAP transport. Only fixture paths have a response. */
const fixtureFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if ((init?.method ?? "GET") !== "GET")
    return new Response(null, { status: 405 });
  const path = url.pathname.slice("/api/".length);
  if (!url.href.startsWith(BASE_URL + "/") || !Object.hasOwn(TENANT, path))
    return Response.json({ message: "No example for this API path" }, { status: 404 });
  return Response.json(TENANT[path]);
}) as typeof fetch;

export function createHostedPreview() {
  const mcp = createHttpHandler({
    baseUrl: BASE_URL,
    reader: { fetch: fixtureFetch },
    server: { writeMode: "off", contentPresentation: "explicit" },
  });
  return async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health")
      return Response.json({ status: "ok", data: "synthetic" });
    if (path !== "/mcp") return new Response(null, { status: 404 });
    // Use the existing HTTP transports. Their internal bearer addresses only
    // the fixture reader. Ignore all caller credentials and tenant overrides.
    const headers = new Headers(request.headers);
    headers.delete(BASE_URL_HEADER);
    headers.delete(WEB_URL_HEADER);
    headers.delete("cookie");
    headers.set("authorization", "Bearer synthetic-preview");
    return mcp(new Request(request, { headers }));
  };
}

if (import.meta.main) {
  const hostname = process.env.PREVIEW_HOST ?? "127.0.0.1";
  const port = Number(process.env.PREVIEW_PORT ?? "3334");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PREVIEW_PORT must be an integer from 1 to 65535.");
  const server = Bun.serve({
    hostname, port,
    maxRequestBodySize: 256 * 1024,
    fetch: createHostedPreview(),
  });
  console.info(`Synthetic, read-only Cloud ALM preview: ${new URL("mcp", server.url)}`);
}
