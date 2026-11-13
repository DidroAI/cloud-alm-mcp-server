import { describe, expect, test } from "bun:test";
import { CloudAlmError } from "../src/calm/errors.js";
import { json } from "./fixtures.js";
import { clientCredentials, parseServiceKey, serviceKeyGrants } from "../src/calm/grant.js";

const key = {
  uaa: {
    url: "https://example.authentication.eu20.hana.ondemand.com",
    clientid: "sb-x!b1|calm-api!b2",
    clientsecret: "s3cret",
  },
  endpoints: { Api: "https://eu20.alm.cloud.sap/api" },
};

describe("service keys", () => {
  test("a key without the needed parts is refused without echoing it", () => {
    const error = (() => {
      try {
        parseServiceKey({ uaa: { url: "https://x", clientsecret: "s3cret" } });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(CloudAlmError);
    expect(String((error as Error).message)).not.toContain("s3cret");
  });

  test("client credentials posts to /oauth/token and returns a grant", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), ...(init ? { init } : {}) });
      return json({ access_token: "tok", expires_in: 7200 });
    }) as typeof fetch;
    const grant = await clientCredentials(key, {
      fetch: fetcher,
      now: () => 1000,
    });
    expect(grant).toEqual({
      accessToken: "tok",
      baseUrl: key.endpoints.Api,
      expiresAt: 1000 + 7_200_000,
    });
    expect(seen[0]?.url).toBe(`${key.uaa.url}/oauth/token`);
    expect(seen[0]?.init?.body).toBe("grant_type=client_credentials");
    const auth = (seen[0]?.init?.headers as Record<string, string> | undefined)
      ?.Authorization;
    expect(
      Buffer.from(auth?.replace("Basic ", "") ?? "", "base64").toString(),
    ).toBe("sb-x!b1|calm-api!b2:s3cret");
  });

  test("a refused key is unauthorized, with no secret in the error", async () => {
    const fetcher = (async () =>
      json(
        { error: "unauthorized", error_description: "Bad credentials s3cret" },
        401,
      )) as unknown as typeof fetch;
    const error = await clientCredentials(key, { fetch: fetcher }).catch(
      (e) => e,
    );
    expect(error).toMatchObject({ code: "unauthorized" });
    expect(error.message).not.toContain("s3cret");
  });

  test("serviceKeyGrants reuses a token until a minute before expiry", async () => {
    let requests = 0;
    let now = 0;
    const fetcher = (async () => {
      requests++;
      return json({ access_token: `tok${requests}`, expires_in: 120 });
    }) as unknown as typeof fetch;
    const getGrant = serviceKeyGrants(key, { fetch: fetcher, now: () => now });
    const [a, b] = await Promise.all([getGrant(), getGrant()]);
    expect(requests).toBe(1);
    expect(a?.accessToken).toBe("tok1");
    expect(b?.accessToken).toBe("tok1");
    now = 59_000;
    expect((await getGrant()).accessToken).toBe("tok1");
    now = 61_000;
    expect((await getGrant()).accessToken).toBe("tok2");
  });
});
