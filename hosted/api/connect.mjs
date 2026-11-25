import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createHttpHandler } from "cloud-alm-mcp-server";
import { digest, open } from "../lib/crypto.mjs";
import { createFeedbackIntake } from "../lib/feedback.mjs";
import { createLimiter, limited, json, senderOf } from "../lib/http.mjs";
import { metadata, oauth, platform } from "../lib/oauth.mjs";

const RECEIVER = "https://docs.didro.ai/cloud-alm/feedback";
/** Passes a report from the hosted feedback tool to Didro's receiver; used when the deployment stores no reports itself. */
async function forwardReport(fields, serverVersion) {
  const reportId = randomUUID();
  const response = await fetch(RECEIVER, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DIDRO_HOSTED_FEEDBACK_TOKEN}` },
    body: JSON.stringify({ ...fields, serverVersion, reportId }),
  });
  if (!response.ok) throw new Error("Feedback could not be delivered");
  return reportId;
}
const TOOL = /^calm_[a-z_]{1,50}$/;
const publicMethods = new Set([
  "initialize",
  "ping",
  "notifications/initialized",
  "tools/list",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "prompts/list",
]);
const schemes = [{ type: "oauth2", scopes: ["calm.read"] }];

/**
 * The connector: discovery documents at the root of `origin`, everything else
 * under `base` (empty when the connector has an origin to itself).
 *
 * `reports.save(report)` stores a report in this deployment; without it,
 * reports go to Didro's receiver with DIDRO_HOSTED_FEEDBACK_TOKEN, and with
 * neither there is no feedback tool and no inbox.
 * `record(event)` receives usage counts: { kind, tool?, outcome?, app? } and
 * nothing about the tenant, the sender or the content. It may not throw into
 * a request, and a request does not wait for it.
 */
export function createGateway({ origin, base = "", sql, exchange, reader, record, reports }) {
  const token = process.env.DIDRO_HOSTED_FEEDBACK_TOKEN;
  const note = record
    ? (event) => {
        try {
          Promise.resolve(record(event)).catch(() => {});
        } catch {}
      }
    : undefined;
  const sink = reports?.save
    ? async (fields, serverVersion) => {
        const reportId = randomUUID();
        await reports.save({ ...fields, serverVersion, reportId });
        return reportId;
      }
    : token
      ? forwardReport
      : undefined;
  const server = {
    writeMode: "off",
    contentPresentation: "explicit",
    ...(sink ? { feedbackSink: sink } : {}),
  };
  const discovery = createHttpHandler({
    server,
    reader: {
      fetch: async () => {
        throw new Error("Discovery has no tenant");
      },
    },
  });
  const feedback = createFeedbackIntake({ token, save: reports?.save, note });
  const live = createHttpHandler({ server, reader });
  // Registering, submitting a key and exchanging a code: a person does each a few times, not hundreds.
  const signIn = createLimiter({ max: 30, windowMs: 600_000 });
  const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${base}/mcp", scope="calm.read"`;
  // The MCP handler serves /mcp, whatever this connector's own path is.
  const inner = new URL("/mcp", origin).href;
  async function mcp(req) {
    if (req.method === "GET" && !req.headers.has("authorization"))
      return json({ error: "unauthorized" }, 401, {
        "WWW-Authenticate": challenge,
      });
    if (req.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { allow: "POST", "WWW-Authenticate": challenge },
      });
    const body = await limited(req, 262144);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const auth = req.headers.get("authorization");
    let grant, app;
    if (auth) {
      const token = /^Bearer ([\w-]{43})$/i.exec(auth)?.[1];
      const [row] = token
        ? await sql`SELECT id,encrypted_grant,redirect_uri FROM connections WHERE access_hash=${digest(token)} AND expires_at>now()`
        : [];
      if (!row) {
        note?.({ kind: "invalid_token" });
        return json({ error: "invalid_token" }, 401, {
          "WWW-Authenticate": challenge,
        });
      }
      grant = open("grant/" + row.id, row.encrypted_grant);
      app = platform(row.redirect_uri);
    }
    if (!grant && !publicMethods.has(msg?.method)) {
      if (msg?.method === "tools/call")
        return json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "Connect your SAP Cloud ALM tenant to continue.",
              },
            ],
            _meta: { "mcp/www_authenticate": [challenge] },
          },
        });
      return json({ error: "unauthorized" }, 401, {
        "WWW-Authenticate": challenge,
      });
    }
    const headers = new Headers(req.headers);
    headers.delete("cookie");
    headers.delete("x-calm-web-url");
    headers.set(
      "authorization",
      "Bearer " + (grant?.accessToken ?? "metadata-only"),
    );
    headers.set(
      "x-calm-api-url",
      grant?.baseUrl ?? "https://discovery.alm.cloud.sap/api",
    );
    if (grant) headers.set("x-calm-web-url", grant.webUrl);
    const res = await (grant ? live : discovery)(
      new Request(inner, { method: "POST", headers, body }),
    );
    if (grant && note && msg?.method === "tools/call") {
      const name = msg.params?.name;
      const tool = typeof name === "string" && TOOL.test(name) ? name : "other";
      const failed = res.headers.get("content-type")?.includes("application/json")
        ? res.clone().json().then((data) => Boolean(data?.error || data?.result?.isError), () => !res.ok)
        : Promise.resolve(!res.ok);
      failed.then((bad) => note({ kind: "tool_call", tool, outcome: bad ? "error" : "ok", app }));
    }
    if (
      msg.method === "tools/list" &&
      res.ok &&
      res.headers.get("content-type")?.includes("application/json")
    ) {
      const data = await res.json();
      for (const tool of data.result?.tools ?? []) {
        tool.securitySchemes = schemes;
        tool._meta = { ...tool._meta, securitySchemes: schemes };
      }
      return json(data, res.status);
    }
    return res;
  }
  return async (req) => {
    let area = "other";
    try {
      const url = new URL(req.url);
      const doc = metadata(origin, url.pathname, base);
      if (doc && req.method === "GET") return json(doc);
      if (base && !url.pathname.startsWith(base + "/")) return json({ error: "not_found" }, 404);
      const path = url.pathname.slice(base.length);
      if (path === "/mcp") {
        area = "mcp";
        return await mcp(req);
      }
      if (path === "/feedback") {
        area = "feedback";
        return await feedback(req);
      }
      if (path.startsWith("/oauth/")) {
        area = "oauth";
        if (req.method === "POST" && !signIn(senderOf(req))) {
          note?.({ kind: "rate_limited", outcome: "sign_in" });
          return json({ error: "slow_down" }, 429, { "retry-after": "600" });
        }
        return await oauth(req, url, path, { origin, base, sql, exchange, note });
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      if (err instanceof Response) return err;
      note?.({ kind: "server_error", outcome: area });
      return json({ error: "server_error" }, 500);
    }
  };
}
let gateway;
export default {
  fetch(request) {
    gateway ??= createGateway({
      origin: process.env.CONNECT_ORIGIN,
      base: process.env.CONNECT_BASE ?? "",
      sql: neon(process.env.DATABASE_URL),
    });
    return gateway(request);
  },
};
