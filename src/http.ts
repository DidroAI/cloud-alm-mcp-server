import { subjectOf } from "./approval.js";
import {
  apiRoot,
  CloudAlm,
  CloudAlmError,
  type CloudAlmOptions,
} from "./calm/index.js";
import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { CloudAlmWriter } from "./calm/writer.js";
import { createServer, type ServerOptions, serverOptionsFromEnv } from "./server.js";

export type HttpOptions = {
  /**
   * The Cloud ALM API root used when a request does not name one, e.g.
   * `https://eu20.alm.cloud.sap/api`. Not a secret.
   */
  baseUrl?: string;
  /** Options for the reader (tests pass a fake `fetch` here). */
  reader?: CloudAlmOptions;
  /** Largest accepted request body. Default 256 KB. */
  maxBodyBytes?: number;
  /** Tool options (default project, allowed tools). Default: from the environment. */
  server?: ServerOptions;
};

/** Header a caller may use to name the Cloud ALM API root per request. */
export const BASE_URL_HEADER = "x-calm-api-url";

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
 * `Authorization: Bearer <token>`; the server keeps no secret and no token
 * beyond the request. The Cloud ALM API root comes from the
 * `X-Calm-Api-Url` header or the configured `baseUrl`, and must be an
 * https `*.alm.cloud.sap` address (the reader refuses anything else).
 */
export function createHttpHandler(options: HttpOptions = {}) {
  const maxBody = options.maxBodyBytes ?? 256 * 1024;
  const serverOptions = options.server ?? serverOptionsFromEnv();
  const writes = serverOptions.writeMode && serverOptions.writeMode !== "off";
  // One server per request, for both protocol eras (2026-07-28 and the
  // 2025 handshake, served statelessly). Nothing outlives the request.
  const make = (token: string, baseUrl: string) => {
    const grant = { accessToken: token, baseUrl };
    return createServer(new CloudAlm(grant, options.reader ?? {}), {
      ...serverOptions,
      ...(writes ? { writer: new CloudAlmWriter(grant, options.reader ?? {}) } : {}),
      // Stateless: no 2025-era dialog can be sent; approvals arrive in a
      // later request (card or chat), and only from the same token.
      approvalDialog: false,
      approvalSubject: subjectOf(token),
    });
  };
  const mcp = createMcpHandler(({ authInfo }) => make(authInfo?.token ?? "", String(authInfo?.extra?.baseUrl ?? "")), {
    responseMode: "json",
    maxRequestBodySize: maxBody,
    legacy: "reject",
  });
  /** A 2025-era request: one server, answered as plain JSON, as before. */
  const legacy = async (request: Request, token: string, baseUrl: string) => {
    const server = make(token, baseUrl);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close().catch(() => undefined);
    }
  };
  return async (request: Request): Promise<Response> => {
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
    const baseUrl = request.headers.get(BASE_URL_HEADER) ?? options.baseUrl;
    if (!baseUrl)
      return refuse(400, `No Cloud ALM API address: send ${BASE_URL_HEADER}.`);
    try {
      apiRoot(baseUrl, options.reader?.hostPattern);
    } catch (error) {
      return refuse(
        400,
        error instanceof CloudAlmError
          ? error.reason
          : "Bad Cloud ALM API address.",
      );
    }
    if (await isLegacyRequest(request, undefined, { maxRequestBodySize: maxBody })) return legacy(request, match[1], baseUrl);
    // 2026-07-28: the token and API root ride the request to the factory.
    return mcp.fetch(request, {
      authInfo: { token: match[1], clientId: "bearer", scopes: [], extra: { baseUrl } },
    });
  };
}
