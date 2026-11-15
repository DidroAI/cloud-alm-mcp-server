import { describe, expect, test } from "bun:test";
import { CloudAlm } from "../src/calm/client.js";
import { CloudAlmError, cleanReason } from "../src/calm/errors.js";
import { BASE_URL, fakeFetch, json, projects } from "./fixtures.js";
import { apiRoot, queryString } from "../src/calm/transport.js";

const failing = (
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) =>
  fakeFetch({ "calm-projects/v1/projects": () => json(body, status, headers) });

describe("grant checks", () => {
  test("only https Cloud ALM hosts receive a token", () => {
    expect(apiRoot("https://eu20.alm.cloud.sap/api/")).toBe(
      "https://eu20.alm.cloud.sap/api",
    );
    expect(apiRoot("https://acme.eu10.alm.cloud.sap/api")).toBe(
      "https://acme.eu10.alm.cloud.sap/api",
    );
    for (const bad of [
      "http://eu20.alm.cloud.sap/api",
      "https://evil.example.com/api",
      "https://alm.cloud.sap.evil.com/api",
      "https://user:pw@eu20.alm.cloud.sap/api",
      "https://eu20.alm.cloud.sap/api?x=1",
      "not a url",
    ])
      expect(() => apiRoot(bad)).toThrow(CloudAlmError);
  });

  test("an empty or expiring token is not sent", async () => {
    const fake = fakeFetch({ "calm-projects/v1/projects": projects });
    const empty = new CloudAlm(
      { accessToken: "", baseUrl: BASE_URL },
      { fetch: fake.fetch },
    );
    await expect(empty.listProjects()).rejects.toMatchObject({
      code: "unauthorized",
    });
    const expiring = new CloudAlm(
      { accessToken: "t", baseUrl: BASE_URL, expiresAt: 1_000_010_000 },
      { fetch: fake.fetch, now: () => 1_000_000_000 },
    );
    await expect(expiring.listProjects()).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fake.calls).toHaveLength(0);
  });

  test("requests are GET with a bearer token and no redirects", async () => {
    const fake = fakeFetch({ "calm-projects/v1/projects": projects });
    await new CloudAlm(
      { accessToken: "abc", baseUrl: BASE_URL },
      { fetch: fake.fetch },
    ).listProjects();
    const init = fake.calls[0]?.init;
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(
      (init?.headers as Record<string, string> | undefined)?.Authorization,
    ).toBe("Bearer abc");
  });
});

describe("status codes become error codes", () => {
  const cases: [number, string][] = [
    [400, "bad_request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [428, "bad_request"],
    [500, "unavailable"],
    [503, "unavailable"],
    [302, "unavailable"],
  ];
  for (const [status, code] of cases)
    test(`${status} → ${code}`, async () => {
      const fake = failing(status, { message: "nope" });
      const calm = new CloudAlm(
        { accessToken: "t", baseUrl: BASE_URL },
        { fetch: fake.fetch, sleep: async () => {} },
      );
      await expect(calm.listProjects()).rejects.toMatchObject({ code, status });
    });

  test("429 is retried, then rate_limited", async () => {
    const fake = failing(429, {}, { "retry-after": "1" });
    const waits: number[] = [];
    const calm = new CloudAlm(
      { accessToken: "t", baseUrl: BASE_URL },
      { fetch: fake.fetch, sleep: async (ms) => void waits.push(ms) },
    );
    await expect(calm.listProjects()).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(fake.calls).toHaveLength(3);
    expect(waits).toEqual([1000, 1000]);
  });

  test("a network failure is unavailable", async () => {
    const calm = new CloudAlm(
      { accessToken: "t", baseUrl: BASE_URL },
      {
        fetch: (async () => {
          throw new TypeError("boom");
        }) as unknown as typeof fetch,
      },
    );
    await expect(calm.listProjects()).rejects.toMatchObject({
      code: "unavailable",
      reason: "network error",
    });
  });

  test("a body that is not JSON is unavailable", async () => {
    const calm = new CloudAlm(
      { accessToken: "t", baseUrl: BASE_URL },
      {
        fetch: (async () =>
          new Response("<html>login</html>", {
            status: 200,
          })) as unknown as typeof fetch,
      },
    );
    await expect(calm.listProjects()).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  test("an oversized answer is refused", async () => {
    const calm = new CloudAlm(
      { accessToken: "t", baseUrl: BASE_URL },
      {
        fetch: (async () =>
          new Response("[]", {
            status: 200,
            headers: { "content-length": String(64 * 1024 * 1024) },
          })) as unknown as typeof fetch,
      },
    );
    await expect(calm.listProjects()).rejects.toMatchObject({
      code: "unavailable",
      reason: "answer too large",
    });
  });
});

describe("reasons stay short and clean", () => {
  test("tokens are redacted and length is capped", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
    expect(cleanReason(`bad token ${jwt}`)).toBe("bad token [redacted]");
    expect(cleanReason("x".repeat(500))).toBe("[redacted]");
    expect(cleanReason("word ".repeat(100), 200).length).toBeLessThanOrEqual(200);
    expect(cleanReason("word ".repeat(1000)).length).toBeLessThanOrEqual(1500);
    expect(cleanReason("a\nb\tc")).toBe("a b c");
  });
});

describe("query strings", () => {
  test("keys verbatim, values encoded, undefined skipped", () => {
    expect(
      queryString({ $top: 3, $filter: "projectId eq x", skip: undefined }),
    ).toBe("?$top=3&$filter=projectId%20eq%20x");
    expect(() => queryString({ "a&b": 1 })).toThrow(CloudAlmError);
  });
});
