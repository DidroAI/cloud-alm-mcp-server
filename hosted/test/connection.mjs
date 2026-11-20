import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createGateway } from "../api/connect.mjs";
import { digest, nonce } from "../lib/crypto.mjs";

test(
  "browser linking, single-use PKCE exchange, tenant lookup and disconnect",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.CONNECT_KEY = randomBytes(32).toString("hex");
    const origin = "https://test.invalid",
      sql = neon(process.env.TEST_DATABASE_URL);
    const key = {
      uaa: {
        url: "https://synthetic.authentication.eu20.hana.ondemand.com",
        clientid: "example",
        clientsecret: "synthetic",
      },
      endpoints: { Api: "https://eu20.alm.cloud.sap/api" },
    };
    const handle = createGateway({
      origin,
      sql,
      exchange: async (received) => {
        assert.deepEqual(received, key);
        return {
          accessToken: "synthetic-sap-token",
          baseUrl: key.endpoints.Api,
          expiresAt: Date.now() + 600000,
        };
      },
      reader: {
        fetch: async (input, init) => {
          assert.equal(
            String(input),
            key.endpoints.Api + "/calm-projects/v1/projects",
          );
          assert.equal(
            new Headers(init.headers).get("authorization"),
            "Bearer synthetic-sap-token",
          );
          return Response.json([
            {
              id: "aaaaaaaa-0000-4000-8000-000000000001",
              name: "Synthetic tenant project",
            },
          ]);
        },
      },
    });
    const req = (path, opts) => handle(new Request(origin + path, opts));
    for (const redirect of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://chatgpt.com/connector_platform_oauth_redirect",
    ]) {
      const method = redirect.includes("claude")
        ? "none"
        : "client_secret_basic";
      const register = await req("/oauth/register", {
        method: "POST",
        body: JSON.stringify({
          redirect_uris: [redirect],
          token_endpoint_auth_method: method,
        }),
      });
      assert.equal(register.status, 201);
      const client = await register.json();
      const verifier = nonce();
      const auth = await req(
        "/oauth/authorize?" +
          new URLSearchParams({
            resource: origin + "/mcp",
            client_id: client.client_id,
            redirect_uri: redirect,
            state: "return-here",
            response_type: "code",
            code_challenge_method: "S256",
            code_challenge: digest(verifier),
          }),
      );
      const cookie = auth.headers.get("set-cookie").split(";")[0];
      const form = new FormData();
      form.set(
        "csrf",
        (await auth.text()).match(/name="csrf" value="([^"]+)"/)[1],
      );
      form.set("key", new Blob([JSON.stringify(key)]), "test.json");
      const consent = await req("/oauth/authorize", {
        method: "POST",
        headers: { cookie, origin },
        body: form,
      });
      assert.equal(consent.status, 303);
      const callback = new URL(consent.headers.get("location"));
      assert.equal(callback.origin + callback.pathname, redirect);
      assert.equal(callback.searchParams.get("iss"), origin);
      assert.equal(callback.searchParams.get("state"), "return-here");
      const args = {
        grant_type: "authorization_code",
        resource: origin + "/mcp",
        redirect_uri: redirect,
        code: callback.searchParams.get("code"),
        client_id: client.client_id,
        code_verifier: verifier,
      };
      const headers = client.client_secret
        ? {
            authorization:
              "Basic " +
              Buffer.from(
                client.client_id + ":" + client.client_secret,
              ).toString("base64"),
          }
        : {};
      const tokenReq = (args) =>
        req("/oauth/token", {
          method: "POST",
          headers,
          body: new URLSearchParams(args),
        });
      assert.equal(
        (await tokenReq({ ...args, code_verifier: nonce() })).status,
        400,
      );
      const [a, b] = await Promise.all([tokenReq(args), tokenReq(args)]);
      assert.deepEqual([a.status, b.status].sort(), [200, 400]);
      const { access_token } = await (a.ok ? a : b).json();
      const call = () =>
        req("/mcp", {
          method: "POST",
          headers: {
            authorization: "Bearer " + access_token,
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "x-calm-api-url": "https://other.alm.cloud.sap/api",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "calm_projects", arguments: {} },
          }),
        });
      assert.match(
        (await (await call()).json()).result.content[0].text,
        /Synthetic tenant project/,
      );
      assert.equal(
        (
          await req("/oauth/revoke", {
            method: "POST",
            headers,
            body: new URLSearchParams({
              client_id: client.client_id,
              token: access_token,
            }),
          })
        ).status,
        200,
      );
      assert.equal((await call()).status, 401);
    }
  },
);
