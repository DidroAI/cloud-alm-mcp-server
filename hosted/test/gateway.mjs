// The whole connector under a path prefix, with an in-memory stand-in for the session table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { createGateway } from "../api/connect.mjs";

process.env.CONNECT_KEY = randomBytes(32).toString("hex");
delete process.env.DIDRO_HOSTED_FEEDBACK_TOKEN;

/** Answers the five statements the connector sends; anything else fails the test. */
function sessions() {
  const rows = [];
  const sql = (strings, ...v) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    if (q.startsWith("DELETE FROM connections WHERE expires_at")) return Promise.resolve([]);
    if (q.startsWith("INSERT INTO connections")) {
      rows.push({ id: v[0], client_id: v[1], redirect_uri: v[2], challenge: v[3], code_hash: v[4], encrypted_grant: v[5], expires_at: v[6], access_hash: null });
      return Promise.resolve([]);
    }
    if (q.startsWith("UPDATE connections SET code_hash=NULL")) {
      const row = rows.find((r) => r.code_hash === v[1] && r.client_id === v[2] && r.redirect_uri === v[3] && r.challenge === v[4]);
      if (!row) return Promise.resolve([]);
      row.code_hash = null;
      row.access_hash = v[0];
      return Promise.resolve([{ expires_at: row.expires_at }]);
    }
    if (q.startsWith("SELECT id,encrypted_grant,redirect_uri FROM connections"))
      return Promise.resolve(rows.filter((r) => r.access_hash === v[0]));
    if (q.startsWith("DELETE FROM connections WHERE client_id")) {
      const at = rows.findIndex((r) => r.client_id === v[0] && r.access_hash === v[1]);
      if (at >= 0) rows.splice(at, 1);
      return Promise.resolve([]);
    }
    throw new Error("Unexpected statement: " + q);
  };
  sql.transaction = (all) => Promise.all(all);
  return { sql, rows };
}
const key = {
  uaa: { url: "https://synthetic.authentication.eu20.hana.ondemand.com", clientid: "example", clientsecret: "synthetic" },
  endpoints: { Api: "https://eu20.alm.cloud.sap/api" },
};
const s256 = (value) => createHash("sha256").update(value).digest("base64url");

/** The whole sign-in as an app and a browser go through it; resolves the connector's bearer header. */
async function signIn(handle, origin, base = "") {
  const req = (path, opts) => handle(new Request(origin + path, opts));
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const client = await (await req(base + "/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: "none" }) })).json();
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", code_challenge: s256(verifier), code_challenge_method: "S256" });
  const page = await req(base + "/oauth/authorize?" + query);
  const cookie = page.headers.get("set-cookie").split(";")[0];
  const data = new FormData();
  data.set("csrf", /name="csrf" value="([^"]+)"/.exec(await page.text())[1]);
  data.set("key", new File([JSON.stringify(key)], "key.json", { type: "application/json" }));
  const back = new URL((await req(base + "/oauth/authorize", { method: "POST", headers: { origin, cookie }, body: data })).headers.get("location"));
  const token = await (await req(base + "/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), code_verifier: verifier, client_id: client.client_id, redirect_uri: redirect }) })).json();
  return { authorization: "Bearer " + token.access_token };
}

for (const base of ["", "/cloud-alm/connect"])
  test(`sign-in, a tool call and disconnect under "${base || "/"}"`, async () => {
    const origin = "https://docs.test";
    const { sql, rows } = sessions();
    const events = [];
    const stored = [];
    const handle = createGateway({
      origin, base, sql,
      record: (event) => events.push(event),
      reports: { save: async (report) => void stored.push(report) },
      exchange: async () => ({ accessToken: "synthetic-sap-token", baseUrl: key.endpoints.Api, expiresAt: Date.now() + 600_000 }),
      reader: {
        fetch: async (input, init) => {
          assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-sap-token");
          return Response.json([{ id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Synthetic tenant project" }]);
        },
      },
    });
    const req = (path, opts) => handle(new Request(origin + path, opts));
    const rpc = (body, headers = {}) => req(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    });

    // Discovery sits at the root of the origin and names the paths under the base.
    const as = await (await req("/.well-known/oauth-authorization-server")).json();
    assert.equal(as.issuer, origin);
    assert.equal(as.token_endpoint, origin + base + "/oauth/token");
    const pr = await (await req("/.well-known/oauth-protected-resource" + base + "/mcp")).json();
    assert.equal(pr.resource, origin + base + "/mcp");
    assert.deepEqual(await (await req("/.well-known/oauth-protected-resource")).json(), pr);
    const unauth = await req(base + "/mcp");
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("www-authenticate"), new RegExp(`resource_metadata="${origin}/.well-known/oauth-protected-resource${base}/mcp"`));
    if (base) {
      assert.equal((await req("/mcp")).status, 404);
      assert.equal((await req("/oauth/register", { method: "POST", body: "{}" })).status, 404);
      assert.equal((await req("/cloud-alm/connectx/mcp")).status, 404);
    }

    // Without a session nothing answers, the handshake included, so an app that probes the address sees a sign-in.
    for (const method of ["initialize", "tools/list", "tools/call", "skills/list", "resources/read"]) {
      const refused = await rpc({ method, params: method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } } : {} });
      assert.equal(refused.status, 401, method);
      assert.match(refused.headers.get("www-authenticate"), /resource_metadata=/);
    }

    const redirect = "https://claude.ai/api/mcp/auth_callback";
    const client = await (await req(base + "/oauth/register", {
      method: "POST", body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: "none" }),
    })).json();
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id, redirect_uri: redirect, response_type: "code", code_challenge: s256(verifier),
      code_challenge_method: "S256", state: "abc", resource: origin + base + "/mcp",
    });
    // A request naming another resource is not ours to answer.
    const other = new URLSearchParams(query);
    other.set("resource", origin + "/mcp" + (base ? "" : "x"));
    assert.equal((await req(base + "/oauth/authorize?" + other)).status, 400);

    const consent = await req(base + "/oauth/authorize?" + query);
    assert.equal(consent.status, 200);
    const html = await consent.text();
    for (const asset of ["/connect.css", "/dropzone.css", "/key-upload.js", "/assets/logo-didro.png"])
      assert.ok(html.includes(`"${base}${asset}"`), asset);
    assert.ok(html.includes(`action="${base}/oauth/authorize"`));
    assert.match(html, /counts sign-ins and tool calls/);
    assert.match(html, /can send Didro short reports/, "the notice follows the report tool, not a setting");
    assert.match(html, /not affiliated with or endorsed by SAP/);
    assert.equal(consent.headers.get("cache-control"), "no-store");
    // A state that is not plain text is refused: encoded, it could outgrow the cookie.
    const odd = new URLSearchParams(query);
    odd.set("state", "caf\u00e9");
    assert.equal((await req(base + "/oauth/authorize?" + odd)).status, 400);
    const cookie = consent.headers.get("set-cookie").split(";")[0];
    assert.match(consent.headers.get("set-cookie"), /^__Host-calm-flow=.*; Path=\/; Secure; HttpOnly; SameSite=Lax/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];

    const form = () => {
      const data = new FormData();
      data.set("csrf", csrf);
      data.set("key", new File([JSON.stringify(key)], "key.json", { type: "application/json" }));
      return data;
    };
    // Another site cannot submit the form, with or without the cookie.
    assert.equal((await req(base + "/oauth/authorize", { method: "POST", headers: { origin: "https://evil.test", cookie }, body: form() })).status, 400);
    assert.equal((await req(base + "/oauth/authorize", { method: "POST", headers: { origin }, body: form() })).status, 400);
    const done = await req(base + "/oauth/authorize", { method: "POST", headers: { origin, cookie }, body: form() });
    assert.equal(done.status, 303);
    const back = new URL(done.headers.get("location"));
    assert.equal(back.origin + back.pathname, redirect);
    assert.equal(back.searchParams.get("iss"), origin);
    assert.equal(back.searchParams.get("state"), "abc");
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes("synthetic-sap-token"), "the SAP token is stored encrypted");

    const exchange = (code_verifier) => req(base + "/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), code_verifier, client_id: client.client_id, redirect_uri: redirect }),
    });
    assert.equal((await exchange(randomBytes(32).toString("base64url"))).status, 400);
    const token = await (await exchange(verifier)).json();
    assert.match(token.access_token, /^[\w-]{43}$/);
    assert.equal((await exchange(verifier)).status, 400, "a code works once");
    assert.ok(!JSON.stringify(rows).includes(token.access_token), "the connector token is stored as a digest");

    const auth = { authorization: "Bearer " + token.access_token };
    const sdk = new Client({ name: "hosted-skills-test", version: "1" }, { versionNegotiation: { mode: "auto" } });
    try {
      await sdk.connect(new StreamableHTTPClientTransport(new URL(origin + base + "/mcp"), {
        requestInit: { headers: auth },
        fetch: (url, init) => handle(new Request(url, init)),
      }));
      const catalog = new SkillsClient(sdk);
      const retest = (await catalog.list()).skills.find(skill => skill.frontmatter.name === "cloud-alm-retest");
      assert.ok(retest, "the hosted catalog includes the retest workflow");
      assert.equal((await catalog.read(retest)).verified, true);
    } finally {
      await sdk.close();
    }
    // Signed in, the tool list carries the report tool and the OAuth scheme on every tool.
    const signedInTools = (await (await rpc({ method: "tools/list" }, auth)).json()).result.tools;
    assert.ok(signedInTools.some((tool) => tool.name === "calm_report_feedback"));
    assert.ok(signedInTools.every((tool) => tool.securitySchemes?.[0]?.type === "oauth2"));
    const answer = await rpc({ method: "tools/call", params: { name: "calm_projects", arguments: {} } }, auth);
    // Counted by the time the answer is handed back, and never to be stored on the way.
    assert.ok(events.some((e) => e.kind === "tool_call" && e.tool === "calm_projects" && e.outcome === "ok"));
    assert.equal(answer.headers.get("cache-control"), "no-store");
    const called = await answer.json();
    assert.match(JSON.stringify(called), /Synthetic tenant project/);
    // One message per request; anything else is a bad request, not a failure of the server.
    for (const body of ["null", "[]", "[{}]", '"text"']) {
      const bad = await req(base + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...auth }, body });
      assert.equal(bad.status, 400, body);
    }
    // A session sealed with a key this deployment no longer has reads as expired: the app signs in again.
    const sealedWith = process.env.CONNECT_KEY;
    process.env.CONNECT_KEY = randomBytes(32).toString("hex");
    const rotated = await rpc({ method: "tools/list" }, auth);
    assert.equal(rotated.status, 401);
    assert.match(rotated.headers.get("www-authenticate"), /error="invalid_token"/);
    const unknown = await req(base + "/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: "x", code_verifier: verifier, client_id: client.client_id, redirect_uri: redirect }) });
    assert.equal(unknown.status, 401);
    assert.equal((await unknown.json()).error, "invalid_client");
    process.env.CONNECT_KEY = sealedWith;
    // One session sends ten reports an hour at most, whatever its assistant is told.
    const tell = () => rpc({ method: "tools/call", params: { name: "calm_report_feedback", arguments: { tool: "calm_list", outcome: "recovered", observation: "A filter was refused once and then worked." } } }, auth).then((r) => r.json());
    for (let i = 0; i < 10; i++) assert.notEqual((await tell()).result.isError, true, "report " + (i + 1));
    assert.equal(stored.length, 10);
    const eleventh = await tell();
    assert.equal(eleventh.result.isError, true);
    assert.match(eleventh.result.content[0].text, /Enough reports/);
    assert.equal(stored.length, 10);
    stored.length = 0;
    await rpc({ method: "tools/call", params: { name: "calm_made_up_name", arguments: {} } }, auth);
    // Credentials that do not decode are a refusal, not a server error.
    const garbled = await req(base + "/oauth/token", { method: "POST", headers: { authorization: "Basic " + Buffer.from("%zz:%zz").toString("base64") }, body: "grant_type=authorization_code" });
    assert.equal(garbled.status, 401);
    assert.equal((await rpc({ method: "tools/list" }, { authorization: "Bearer " + randomBytes(32).toString("base64url") })).status, 401);

    await req(base + "/oauth/revoke", { method: "POST", body: new URLSearchParams({ token: token.access_token, client_id: client.client_id }) });
    assert.equal((await rpc({ method: "tools/list" }, auth)).status, 401);

    // The public inbox stores a well-formed report here, under an id of ours.
    const report = { reportId: "11111111-2222-4333-8444-555555555555", serverVersion: "9.9.9", tool: "calm_list", outcome: "recovered", observation: "A filter was refused once." };
    const inbox = (body) => req(base + "/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await inbox(report)).status, 204);
    assert.equal((await inbox({ ...report, tenant: "x" })).status, 400);
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0].reportId, report.reportId);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const seen = events.map((e) => [e.kind, e.outcome ?? "", e.tool ?? "", e.app ?? ""].join("/"));
    for (const expected of ["register///Claude", "sign_in_page///Claude", "sign_in/ok//Claude", "token/refused//", "token/ok//Claude",
      "tool_call/ok/calm_projects/Claude", "tool_call/error/other/Claude", "invalid_token///", "revoke///", "report/accepted//", "report/invalid//"])
      assert.ok(seen.includes(expected), expected + " in " + seen.join(" "));
    // Counts say nothing about who or what: only these four fields, from short fixed lists.
    for (const event of events) {
      assert.deepEqual(Object.keys(event).filter((k) => !["kind", "outcome", "tool", "app"].includes(k)), []);
      assert.doesNotMatch(JSON.stringify(event), /synthetic|eu20|docs\.test|made_up/);
    }
    assert.ok(!seen.some((e) => e.startsWith("server_error")), seen.join(" "));
    assert.ok(seen.includes("rate_limited/feedback//"), seen.join(" "));
    // The sign-in page is for people: one sender cannot open it without end.
    let last;
    for (let i = 0; i < 31; i++) last = await req(base + "/oauth/authorize?" + query, { headers: { "x-real-ip": "203.0.113.9" } });
    assert.equal(last.status, 429);
    assert.equal((await req(base + "/oauth/register", { method: "POST", headers: { "x-real-ip": "203.0.113.9" }, body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: "none" }) })).status, 201);
  });

test("a failing counter never fails a request", async () => {
  const { sql } = sessions();
  const handle = createGateway({ origin: "https://docs.test", sql, record: () => { throw new Error("down"); } });
  const res = await handle(new Request("https://docs.test/oauth/register", {
    method: "POST", body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" }),
  }));
  assert.equal(res.status, 201);
  const rejecting = createGateway({ origin: "https://docs.test", sql, record: () => Promise.reject(new Error("down")) });
  assert.equal((await rejecting(new Request("https://docs.test/oauth/token", { method: "POST", body: "grant_type=x" }))).status, 401);
});

test("without a place to keep reports there is no report tool, no inbox and no notice", async () => {
  const origin = "https://connector.test";
  const { sql } = sessions();
  const handle = createGateway({ origin, sql, exchange: async () => ({ accessToken: "synthetic-sap-token", baseUrl: key.endpoints.Api, expiresAt: Date.now() + 600_000 }) });
  const auth = await signIn(handle, origin);
  const list = await (await handle(new Request(origin + "/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...auth },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }))).json();
  assert.ok(list.result.tools.length > 5 && !list.result.tools.some((tool) => tool.name === "calm_report_feedback"));
  assert.equal((await handle(new Request(origin + "/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status, 404);
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const client = await (await handle(new Request(origin + "/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: "none" }) }))).json();
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", code_challenge: s256("v".repeat(43)), code_challenge_method: "S256" });
  const html = await (await handle(new Request(origin + "/oauth/authorize?" + query))).text();
  assert.doesNotMatch(html, /short reports/);
  assert.doesNotMatch(html, /counts sign-ins/);
});
