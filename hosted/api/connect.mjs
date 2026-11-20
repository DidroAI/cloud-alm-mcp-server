import { neon } from "@neondatabase/serverless";
import { createHttpHandler } from "cloud-alm-mcp-server";
import { digest, open } from "../lib/crypto.mjs";
import { limited, json } from "../lib/http.mjs";
import { metadata, oauth } from "../lib/oauth.mjs";

const server = { writeMode: "off", contentPresentation: "explicit" };
const discovery = createHttpHandler({
  server,
  reader: {
    fetch: async () => {
      throw new Error("Discovery has no tenant");
    },
  },
});
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

export function createGateway({ origin, sql, exchange, reader }) {
  const live = createHttpHandler({ server, reader });
  const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="calm.read"`;
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
    let grant;
    if (auth) {
      const token = /^Bearer ([\w-]{43})$/i.exec(auth)?.[1];
      const [row] = token
        ? await sql`SELECT id,encrypted_grant FROM connections WHERE access_hash=${digest(token)} AND expires_at>now()`
        : [];
      if (!row)
        return json({ error: "invalid_token" }, 401, {
          "WWW-Authenticate": challenge,
        });
      grant = open("grant/" + row.id, row.encrypted_grant);
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
      new Request(req.url, { method: "POST", headers, body }),
    );
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
    try {
      const url = new URL(req.url);
      const doc = metadata(origin, url.pathname);
      if (doc && req.method === "GET") return json(doc);
      if (url.pathname === "/mcp") return await mcp(req);
      if (url.pathname.startsWith("/oauth/"))
        return await oauth(req, url, origin, sql, exchange);
      return json({ error: "not_found" }, 404);
    } catch (err) {
      if (err instanceof Response) return err;
      return json({ error: "server_error" }, 500);
    }
  };
}
let gateway;
export default {
  fetch(request) {
    gateway ??= createGateway({
      origin: process.env.CONNECT_ORIGIN,
      sql: neon(process.env.DATABASE_URL),
    });
    return gateway(request);
  },
};
