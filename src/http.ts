import type { FeedbackSink } from "./feedback.js";
import { webBaseFrom } from "./views/links.js";
import { SNAPSHOT_TTL_MS } from "./views/snapshot.js";
import { subjectOf } from "./approval.js";
import {
  apiRoot,
  CloudAlm,
  CloudAlmError,
  type CloudAlmOptions,
} from "./calm/index.js";
import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { CloudAlmWriter } from "./calm/writer.js";
import { tokenScopes, writeToolsFor } from "./cli/scopes.js";
import { createServer, type ServerOptions, serverOptionsForKey } from "./server.js";

export type HttpOptions = {
  /**
   * The Cloud ALM API root used when a request does not name one, e.g.
   * `https://eu20.alm.cloud.sap/api`. Not a secret.
   */
  baseUrl?: string;
  /** The Cloud ALM UI root for links to items (https://<tenant>.<region>.alm.cloud.sap); a request may send its own in X-Calm-Web-Url. */
  webUrl?: string;
  /** Options for the reader (tests pass a fake `fetch` here). */
  reader?: CloudAlmOptions;
  /** Receiver used by the default server factory. */
  feedbackSink?: FeedbackSink;
  /**
   * Host names (with port) this server answers to, e.g. `["127.0.0.1:3333",
   * "localhost:3333"]`. Set for a server on the loopback address: a web
   * page that points its own name at 127.0.0.1 (DNS rebinding) is refused,
   * as is any request a browser sends from another site (an Origin header).
   * Default: no check, for servers behind a proxy that names them.
   */
  allowedHosts?: readonly string[];
  /** Largest accepted request body. Default 256 KB. */
  maxBodyBytes?: number;
  /** Tool options for tests and embedding. Default: from each caller's token, as the key decides. */
  server?: ServerOptions;
};

/** Header a caller may use to name the Cloud ALM API root per request. */
export const BASE_URL_HEADER = "x-calm-api-url";
export const WEB_URL_HEADER = "x-calm-web-url";

function refuse(
  status: number,
  message: string,
  headers: Record<string, string> = {},
) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message },
      id: null,
    }),
    { status, headers: { "content-type": "application/json", ...headers } },
  );
}

/**
 * A stateless Streamable HTTP handler. Each request carries its own
 * `Authorization: Bearer <token>`; the server keeps no secret, and a token
 * only in memory, for at most 45 s after its last use (its read cache). The Cloud ALM API root comes from the
 * `X-Calm-Api-Url` header or the configured `baseUrl`, and must be an
 * https `*.alm.cloud.sap` address (the reader refuses anything else).
 */
export function createHttpHandler(options: HttpOptions = {}) {
  const maxBody = options.maxBodyBytes ?? 256 * 1024;

  // One server per request, for both protocol eras (2026-07-28 and the
  // 2025 handshake, served statelessly). The reader of a token is kept as
  // long as its snapshot is fresh (45 s), so an agent's follow-up calls do
  // not re-read every list; then it is dropped with the token it holds.
  const readers = new Map<string, { calm: CloudAlm; at: number }>();
  const readerFor = (token: string, baseUrl: string) => {
    const now = Date.now();
    for (const [k, v] of readers) if (now - v.at >= SNAPSHOT_TTL_MS) readers.delete(k);
    const key = `${subjectOf(token)} ${baseUrl}`;
    const hit = readers.get(key);
    if (hit) return hit.calm;
    while (readers.size >= 100) readers.delete(readers.keys().next().value as string);
    const calm = new CloudAlm({ accessToken: token, baseUrl }, options.reader ?? {});
    readers.set(key, { calm, at: now });
    return calm;
  };
  const make = (token: string, baseUrl: string, webUrl?: string) => {
    const grant = { accessToken: token, baseUrl };
    const writer = new CloudAlmWriter(grant, options.reader ?? {});
    // The caller's token decides: write tools when its scopes allow them.
    const serverOptions = options.server
      ? { ...options.server, ...(options.server.writeMode && options.server.writeMode !== "off" ? { writer } : {}) }
      : serverOptionsForKey(writer, writeToolsFor(tokenScopes(token)), undefined, options.feedbackSink);
    return createServer(readerFor(token, baseUrl), {
      ...serverOptions,
      // Approvals arrive in a later request (card or chat), and only from the same token.
      approvalSubject: `${subjectOf(token)} ${baseUrl}`,
      ...(webUrl ? { webUrl } : {}),
    });
  };
  const mcp = createMcpHandler(({ authInfo }) => make(authInfo?.token ?? "", String(authInfo?.extra?.baseUrl ?? ""), authInfo?.extra?.webUrl as string | undefined), {
    responseMode: "json",
    maxRequestBodySize: maxBody,
    legacy: "reject",
  });
  /** A 2025-era request: one server, answered as plain JSON, as before. */
  const legacy = async (request: Request, token: string, baseUrl: string, webUrl?: string) => {
    const server = make(token, baseUrl, webUrl);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close().catch(() => undefined);
    }
  };
  const hosts = options.allowedHosts ? new Set(options.allowedHosts.map((h) => h.toLowerCase())) : undefined;
  return async (request: Request): Promise<Response> => {
    if (hosts) {
      if (!hosts.has((request.headers.get("host") ?? "").toLowerCase())) return refuse(403, "This server does not answer to that host name.");
      const origin = request.headers.get("origin");
      if (origin && !(URL.canParse(origin) && hosts.has(new URL(origin).host.toLowerCase()))) return refuse(403, "Requests from web pages are not accepted.");
    }
    if (request.method !== "POST")
      return refuse(
        405,
        "Method not allowed: this server is stateless; use POST.",
        { allow: "POST" },
      );
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > maxBody) return refuse(413, "Request too large.");
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.get("authorization") ?? "",
    );
    if (!match?.[1])
      return refuse(401, "A Cloud ALM bearer token is required.", {
        "www-authenticate": 'Bearer realm="cloud-alm"',
      });
    let baseUrl = request.headers.get(BASE_URL_HEADER) ?? options.baseUrl;
    if (!baseUrl)
      return refuse(400, `No Cloud ALM API address: send ${BASE_URL_HEADER}.`);
    try {
      baseUrl = apiRoot(baseUrl, options.reader?.hostPattern);
    } catch (error) {
      return refuse(
        400,
        error instanceof CloudAlmError
          ? error.reason
          : "Bad Cloud ALM API address.",
      );
    }
    const webUrl = webBaseFrom(request.headers.get(WEB_URL_HEADER) ?? undefined) ?? webBaseFrom(options.webUrl);
    if (await isLegacyRequest(request, undefined, { maxRequestBodySize: maxBody })) return legacy(request, match[1], baseUrl, webUrl);
    // 2026-07-28: the token and API root ride the request to the factory.
    return mcp.fetch(request, {
      authInfo: { token: match[1], clientId: "bearer", scopes: [], extra: { baseUrl, ...(webUrl ? { webUrl } : {}) } },
    });
  };
}
