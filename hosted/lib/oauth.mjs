import { randomUUID } from "node:crypto";
import {
  parseServiceKey,
  clientCredentials,
  apiRoot,
} from "cloud-alm-mcp-server";
import { seal, open, nonce, clientSecret, digest, equal } from "./crypto.mjs";
import { fail, json, page, limited } from "./http.mjs";

const scope = "calm.read";
const methods = ["none", "client_secret_basic", "client_secret_post"];
const cookie = "__Host-calm-flow";
const cookieOptions = "; Path=/; Secure; HttpOnly; SameSite=Lax";
const platforms = new Map([
  ["https://claude.ai/api/mcp/auth_callback", "Claude"],
  ["https://chatgpt.com/connector_platform_oauth_redirect", "ChatGPT"],
]);
function platform(uri) {
  return (
    platforms.get(uri) ??
    (/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,160}$/.test(
      uri,
    )
      ? "ChatGPT"
      : undefined)
  );
}
function unpack(type, value) {
  try {
    return open(type, value);
  } catch {
    fail();
  }
}
export function metadata(origin, path) {
  if (
    [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ].includes(path)
  )
    return {
      resource: origin + "/mcp",
      authorization_servers: [origin],
      scopes_supported: [scope],
      bearer_methods_supported: ["header"],
    };
  if (path === "/.well-known/oauth-authorization-server")
    return {
      issuer: origin,
      authorization_endpoint: origin + "/oauth/authorize",
      token_endpoint: origin + "/oauth/token",
      registration_endpoint: origin + "/oauth/register",
      revocation_endpoint: origin + "/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: methods,
      scopes_supported: [scope],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    };
}
async function register(req) {
  let data;
  const raw = await limited(req, 8192);
  try {
    data = JSON.parse(raw);
  } catch {
    fail();
  }
  const redirects = data?.redirect_uris;
  const method = data?.token_endpoint_auth_method ?? "client_secret_basic";
  if (
    !Array.isArray(redirects) ||
    !redirects.length ||
    redirects.length > 4 ||
    !redirects.every(
      (uri) =>
        typeof uri === "string" &&
        platform(uri) === platform(redirects[0]) &&
        platform(uri),
    )
  )
    fail("invalid_redirect_uri");
  if (!methods.includes(method)) fail("invalid_client_metadata");
  const id = seal("client", { redirects, method });
  return json(
    {
      client_id: id,
      ...(method === "none"
        ? {}
        : { client_secret: clientSecret(id), client_secret_expires_at: 0 }),
      redirect_uris: redirects,
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    201,
  );
}
function authorize(origin, params) {
  const id = params.get("client_id"),
    redirect = params.get("redirect_uri"),
    challenge = params.get("code_challenge");
  const client = unpack("client", id);
  if (
    !client.redirects.includes(redirect) ||
    params.get("response_type") !== "code" ||
    params.get("code_challenge_method") !== "S256" ||
    !/^[-_a-zA-Z0-9]{43}$/.test(challenge ?? "") ||
    (params.get("scope") || scope) !== scope ||
    (params.has("resource") && params.get("resource") !== origin + "/mcp")
  )
    fail();
  const state = params.get("state") ?? "";
  if (state.length > 1024) fail();
  const csrf = nonce();
  const flow = seal("flow", {
    origin,
    id,
    redirect,
    challenge,
    state,
    csrf,
    until: Date.now() + 600000,
  });
  return page(
    "Connect SAP Cloud ALM",
    `<p>Allow <strong>${platform(redirect)}</strong> to read your Cloud ALM tenant for up to one hour. Anyone who can use this connection can read what your key allows.</p><form method="post" action="/oauth/authorize" enctype="multipart/form-data"><label>BTP service key JSON<input type="file" name="key" accept=".json,application/json" required></label><input type="hidden" name="csrf" value="${csrf}"><p>Your key is exchanged directly with SAP and discarded. Only the temporary SAP token is stored, encrypted, for this session.</p><button>Connect my tenant</button></form>`,
    { "set-cookie": cookie + "=" + flow + cookieOptions + "; Max-Age=600" },
  );
}
async function consent(req, origin, sql, exchange) {
  if (req.headers.get("origin") !== origin) fail();
  const cookies = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((x) => x.trim());
  const flow = unpack(
    "flow",
    cookies.find((x) => x.startsWith(cookie + "="))?.slice(cookie.length + 1),
  );
  const bytes = await limited(req, 65536);
  let form;
  try {
    form = await new Response(bytes, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    fail();
  }
  if (
    flow.origin !== origin ||
    flow.until < Date.now() ||
    form.get("csrf") !== flow.csrf
  )
    fail();
  let grant, webUrl;
  try {
    const file = form.get("key");
    const key = parseServiceKey(
      JSON.parse((await file.text()).replace(/^\uFEFF/, "")),
    );
    const auth = new URL(key.uaa.url),
      api = new URL(apiRoot(key.endpoints.Api));
    const match =
      /^([a-z0-9-]+)\.authentication\.([a-z0-9-]+)\.hana\.ondemand\.com$/.exec(
        auth.hostname,
      );
    if (
      !match ||
      auth.href !== auth.origin + "/" ||
      auth.protocol !== "https:" ||
      auth.port ||
      api.port ||
      !["/api", "/api/", "/"].includes(api.pathname) ||
      !/^[-a-z0-9]+\.alm\.cloud\.sap$/.test(api.hostname)
    )
      throw new Error();
    webUrl = "https://" + match[1] + "." + api.hostname;
    if (api.pathname === "/") key.endpoints.Api = api.origin + "/api";
    grant = await exchange(key);
  } catch {
    return page(
      "Check your service key",
      "<p>SAP authentication was unsuccessful. Choose a Cloud ALM client-secret service key from a supported SAP commercial region. Go back to try again.</p>",
    );
  }
  const id = randomUUID(),
    code = nonce(),
    expires = new Date(Math.min(grant.expiresAt - 30000, Date.now() + 3600000));
  if (expires.getTime() <= Date.now()) fail();
  const encrypted = seal("grant/" + id, {
    accessToken: grant.accessToken,
    baseUrl: grant.baseUrl,
    webUrl,
  });
  await sql.transaction([
    sql`DELETE FROM connections WHERE expires_at <= now() OR (access_hash IS NULL AND code_until <= now())`,
    sql`INSERT INTO connections(id,client_id,redirect_uri,challenge,code_hash,code_until,encrypted_grant,expires_at)
       VALUES (${id},${flow.id},${flow.redirect},${flow.challenge},${digest(code)},now()+interval '90 seconds',${encrypted},${expires.toISOString()})`,
  ]);
  const dest = new URL(flow.redirect);
  dest.searchParams.set("code", code);
  dest.searchParams.set("iss", origin);
  if (flow.state) dest.searchParams.set("state", flow.state);
  return new Response(null, {
    status: 303,
    headers: {
      location: dest.href,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "set-cookie": cookie + "=" + cookieOptions + "; Max-Age=0",
    },
  });
}
function authenticate(req, p) {
  let id = p.get("client_id"),
    secret = p.get("client_secret");
  const basic = req.headers.get("authorization");
  if (basic) {
    if (!basic.startsWith("Basic ") || secret) fail("invalid_client", 401);
    const decoded = Buffer.from(basic.slice(6), "base64").toString();
    const sep = decoded.indexOf(":");
    if (sep < 1) fail("invalid_client", 401);
    const basicId = decodeURIComponent(decoded.slice(0, sep));
    if (id && id !== basicId) fail("invalid_client", 401);
    id = basicId;
    secret = decodeURIComponent(decoded.slice(sep + 1));
  }
  const { method } = unpack("client", id);
  const used = basic
    ? "client_secret_basic"
    : secret
      ? "client_secret_post"
      : "none";
  if (
    method !== used ||
    (method !== "none" && !equal(secret, clientSecret(id)))
  )
    fail("invalid_client", 401);
  return id;
}
export async function oauth(
  req,
  url,
  origin,
  sql,
  exchange = clientCredentials,
) {
  const path = url.pathname;
  if (path === "/oauth/register" && req.method === "POST") return register(req);
  if (path === "/oauth/authorize") {
    if (req.method === "GET") return authorize(origin, url.searchParams);
    if (req.method === "POST") return consent(req, origin, sql, exchange);
  }
  if (
    req.method !== "POST" ||
    !["/oauth/token", "/oauth/revoke"].includes(path)
  )
    fail("invalid_request", 404);
  const p = new URLSearchParams((await limited(req, 16384)).toString());
  const id = authenticate(req, p);
  if (path === "/oauth/revoke") {
    await sql`DELETE FROM connections WHERE client_id=${id} AND access_hash=${digest(p.get("token") ?? "")}`;
    return new Response(null, { status: 200 });
  }
  if (p.get("grant_type") !== "authorization_code")
    fail("unsupported_grant_type");
  const verifier = p.get("code_verifier");
  if (
    !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier ?? "") ||
    (p.has("resource") && p.get("resource") !== origin + "/mcp")
  )
    fail("invalid_grant");
  const token = nonce();
  const [row] =
    await sql`UPDATE connections SET code_hash=NULL,access_hash=${digest(token)}
    WHERE code_hash=${digest(p.get("code") ?? "")} AND client_id=${id} AND redirect_uri=${p.get("redirect_uri") ?? ""}
    AND challenge=${digest(verifier)} AND code_until>now() AND expires_at>now() RETURNING expires_at`;
  if (!row) fail("invalid_grant");
  return json({
    access_token: token,
    token_type: "Bearer",
    scope,
    expires_in: Math.max(
      0,
      Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000),
    ),
  });
}
