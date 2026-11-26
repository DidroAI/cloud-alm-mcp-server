import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createHttpHandler } from "cloud-alm-mcp-server";
import { digest, open } from "../lib/crypto.mjs";
import { createFeedbackIntake } from "../lib/feedback.mjs";
import { createLimiter, limited, json, noStore, senderOf } from "../lib/http.mjs";
import { metadata, oauth, platform } from "../lib/oauth.mjs";

const TOOL = /^calm_[a-z_]{1,50}$/;
const REPORT_TOOL = "calm_report_feedback";
const schemes = [{ type: "oauth2", scopes: ["calm.read"] }];

/**
 * The connector: discovery documents at the root of `origin`, everything else
 * under `base` (empty when the connector has an origin to itself).
 *
 * `reports.save(report)` stores a report in this deployment: with it the
 * assistant gets the report tool and `<base>/feedback` is the public inbox
 * for local installations; without it there is neither.
 * `record(event)` receives usage counts: { kind, tool?, outcome?, app? } and
 * nothing about the tenant, the sender or the content. It is called before
 * the answer is returned, may not throw into a request, and a request does
 * not wait for what it returns.
 */
export function createGateway({ origin, base = "", sql, exchange, reader, record, reports }) {
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
  const feedback = createFeedbackIntake({ save: reports?.save, note });
  const live = createHttpHandler({ server, reader });
  // Opening the sign-in page and submitting a key come from a person's browser: a few times, not hundreds.
  // Registration and the code exchange come from the app's servers, which many users share, so they are not limited by sender.
  const signIn = createLimiter({ max: 30, windowMs: 600_000 });
  // A local installation stops at ten reports; so does one signed-in session, whatever its assistant is told to do.
  const reportsPerSession = createLimiter({ max: 10, windowMs: 3_600_000 });
  // Only tools this server has are counted by name. The list is kept once it has been read.
  let known;
  const toolNames = () =>
    (known ??= discovery(new Request(new URL("/mcp", origin), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer metadata-only", "x-calm-api-url": "https://discovery.alm.cloud.sap/api" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }))
      .then((res) => res.json())
      .then((data) => new Set((data.result?.tools ?? []).map((tool) => tool.name)))
      .catch(() => new Set())
      .then((names) => {
        if (!names.size) known = undefined;
        return names;
      }));
  const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${base}/mcp", scope="calm.read"`;
  const expired = () => json({ error: "invalid_token" }, 401, { "WWW-Authenticate": challenge + ', error="invalid_token"' });
  const refusal = (id, text) => json({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text }] } });
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
    // One message per request: what is counted and limited below is that one message.
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return json({ error: "One JSON-RPC message per request" }, 400);
    const auth = req.headers.get("authorization");
    let grant, app, session;
    if (auth) {
      const token = /^Bearer ([\w-]{43})$/i.exec(auth)?.[1];
      const [row] = token
        ? await sql`SELECT id,encrypted_grant,redirect_uri FROM connections WHERE access_hash=${digest(token)} AND expires_at>now()`
        : [];
      if (!row) {
        note?.({ kind: "invalid_token" });
        return expired();
      }
      try {
        grant = open("grant/" + row.id, row.encrypted_grant);
      } catch {
        // Sealed with a key this deployment no longer has: the app is told to sign in again, as for an expired session.
        note?.({ kind: "invalid_token" });
        return expired();
      }
      session = row.id;
      app = platform(row.redirect_uri);
    }
    // Nothing without a session, the handshake included: an app that probes the address then sees that it
    // needs a sign-in (Claude otherwise offers "No sign-in" and connects a connector that can read nothing).
    if (!grant)
      return json({ error: "unauthorized" }, 401, {
        "WWW-Authenticate": challenge,
      });
    if (msg.method === "tools/call" && msg.params?.name === REPORT_TOOL && !reportsPerSession(session)) {
      note?.({ kind: "rate_limited", outcome: "feedback" });
      return refusal(msg.id, "Enough reports from this session for now. Continue the task without reporting.");
    }
    const headers = new Headers(req.headers);
    headers.delete("cookie");
    headers.delete("x-calm-web-url");
    headers.set("authorization", "Bearer " + grant.accessToken);
    headers.set("x-calm-api-url", grant.baseUrl);
    headers.set("x-calm-web-url", grant.webUrl);
    const res = await live(
      new Request(inner, { method: "POST", headers, body }),
    );
    if (note && msg.method === "tools/call") {
      // Counted before the answer leaves, so the count is not lost when the platform suspends the function.
      const name = msg.params?.name;
      const names = await toolNames();
      const bad = res.headers.get("content-type")?.includes("application/json")
        ? await res.clone().json().then((data) => Boolean(data?.error || data?.result?.isError), () => !res.ok)
        : !res.ok;
      note({ kind: "tool_call", tool: typeof name === "string" && TOOL.test(name) && names.has(name) ? name : "other", outcome: bad ? "error" : "ok", app });
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
  async function route(req) {
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
        if (path === "/oauth/authorize" && !signIn(senderOf(req))) {
          note?.({ kind: "rate_limited", outcome: "sign_in" });
          return json({ error: "slow_down" }, 429, { "retry-after": "600" });
        }
        return await oauth(req, url, path, { origin, base, sql, exchange, note, reportsOn: Boolean(sink) });
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      if (err instanceof Response) return err;
      // The one line this service writes about a request: where it failed and why, never what was in it.
      console.error(`connector: ${area} failed: ${err instanceof Error ? err.name + ": " + err.message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 160) : "unknown error"}`);
      note?.({ kind: "server_error", outcome: area });
      return json({ error: "server_error" }, 500);
    }
  }
  return async (req) => noStore(await route(req));
}
let gateway;
/** The connector on an origin of its own: a session table, no reports, no counts. */
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
