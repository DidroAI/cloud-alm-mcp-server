import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CloudAlm } from "../src/calm/index.js";
import { createHttpHandler } from "../src/http.js";
import {
  createServer,
  type ServerOptions,
  serverOptionsFromEnv,
  TOOL_NAMES,
} from "../src/server.js";
import { readerFromKeyFile, stdioServer } from "../src/stdio.js";
import { BASE_URL, DEF, fakeCloudAlm, PROJECT_ID, REQ, TENANT } from "./tenant.js";

async function connect(
  routes: Record<string, unknown> = TENANT,
  options: ServerOptions = {},
  fakeOptions: { delayMs?: number } = {},
) {
  const fake = fakeCloudAlm(routes, fakeOptions);
  const calm = new CloudAlm(
    { accessToken: "t", baseUrl: BASE_URL },
    { fetch: fake.fetch },
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(calm, options).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    return { error: !!result.isError, text: result.content[0]?.text ?? "" };
  };
  return { client, call, fake };
}

describe("tools", () => {
  test("seven read-only tools with short descriptions", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect((t.description ?? "").length).toBeLessThan(320);
    }
    // The whole tool list stays small: it is sent with every turn.
    expect(JSON.stringify(tools).length).toBeLessThan(7000);
  });

  test("overview: phase, counts by status, gaps", async () => {
    const { call } = await connect();
    const { text } = await call("calm_overview");
    expect(text).toContain("Project Rollout Example");
    expect(text).toContain("Realize (current) 2026-10-01–2026-12-31");
    expect(text).toContain("1 requirement (1 open)");
    expect(text).toContain("2 user stories (2 open)");
    expect(text).toContain("Defects: 1 open (new) · priority: 1 very high");
    expect(text).toContain("Features: 1 (1 in testing)");
    expect(text).toContain("Test cases: 3 manual (2 prepared), 1 automated");
    expect(text).toContain("Test results (latest per test case and plan): 1 failed, 1 passed");
    expect(text).toContain(
      "Gaps: 1 of 3 open requirements/user stories without a test case · 0 open requirements without a solution process · 2 test cases linked to no task",
    );
    // Where outages and tenant-wide counts are.
    expect(text).toContain("calm_landscape");
    expect(text).toContain("calm_analytics");
  });

  test("find: words, alternatives, types and status", async () => {
    const { call } = await connect();
    const credit = await call("calm_find", { query: "credit" });
    expect(credit.text).toStartWith("6 matches");
    expect(credit.text).toContain(
      '- 3-1 · requirement · open (in refinement) · priority high · "[demo] REQ-01 Credit check on order release" · #Wave 1',
    );
    expect(credit.text).toContain('- 3-4 · defect · open (new) · priority very high · "Credit block not set for export orders"');
    const alt = await call("calm_find", { query: "worklist | regression" });
    expect(alt.text).toContain("3-2 ·");
    expect(alt.text).toContain("8-1-3 ·");
    const defects = await call("calm_find", { types: ["defect"], status: "open" });
    expect(defects.text).toStartWith("1 match");
    const tagged = await call("calm_find", { tag: "wave 1" });
    expect(tagged.text).toStartWith("3 matches");
  });

  test("get: several items by display id, with their links named", async () => {
    const { call } = await connect();
    const { text } = await call("calm_get", { ids: ["3-1", "8-1-2", "6-1", "9-9"] });
    expect(text).toContain('3-1 requirement · open (in refinement) · priority high · "[demo] REQ-01 Credit check on order release"');
    expect(text).toContain("Orders above the credit limit are blocked.");
    expect(text).toContain('User stories / tasks under it: 3-2 user story "Release blocked orders from a worklist" (open); 3-3');
    expect(text).toContain("Solution processes: Lead to Cash");
    expect(text).toContain("1.1 Open the worklist [evidence]");
    expect(text).toContain("Latest result: passed, 1 of 1 steps passed in UAT cycle 1");
    expect(text).toContain('Test cases: 8-1-1 "Order blocked by credit limit" (failed, 1 of 2 steps passed in UAT cycle 1) · defect 3-4');
    expect(text).toContain("expect: The order is listed");
    expect(text).toContain("Transports: DEVK900123");
    expect(text).toContain("9-9: not_found");
  });

  test("trace: requirement → user stories, features, transports, tests", async () => {
    const { call } = await connect();
    const { text } = await call("calm_trace", { id: "3-3" });
    expect(text).toContain("- 3-1 requirement");
    expect(text).toContain("process: Lead to Cash");
    expect(text).toContain("feature: 6-1 \"Credit management\" (in testing) · transports: DEVK900123");
    expect(text).toContain('    - 3-3 user story "Credit exposure shown in the order (see REQ-01)" (open)');
    expect(text).toContain("test cases: NONE");
  });

  test("gaps: untested, features, orphan and unprepared tests", async () => {
    const { call } = await connect();
    const { text } = await call("calm_gaps");
    expect(text).toContain("Without a test case: 1");
    expect(text).toContain("3-3 · user story");
    expect(text).toContain("1 of 2 tasks it delivers have no test case: 3-3");
    expect(text).toContain("Test cases linked to no task: 2");
    expect(text).toContain("Test cases not prepared: 1");
    expect(text).toContain(
      'Test cases whose latest run failed: 1\n- 8-1-1 · manual test case · failed, 1 of 2 steps passed in UAT cycle 1 · "Order blocked by credit limit" — covers 3-1 "[demo] REQ-01 Credit check on order release" — defect 3-4 "Credit block not set for export orders" (open (new), priority very high)',
    );
  });

  test("landscape: open events first, services by name", async () => {
    const { call } = await connect();
    const { text } = await call("calm_landscape");
    expect(text).toContain("- SAP Cloud ALM · CloudService · 100 · PROD");
    expect(text).toContain("Service status events: 1 open, 1 closed");
    expect(text.indexOf("Planned")).toBeLessThan(text.indexOf("Closed ·"));
    // The event's own text, not only its id.
    expect(text).toContain("Planned database upgrade; the service is read-only for 30 minutes. (EVB2)");
  });

  test("analytics without dataset lists the datasets, no request", async () => {
    const { call, fake } = await connect();
    const { text } = await call("calm_analytics");
    expect(text).toContain("- Tasks:");
    expect(fake.seen.length).toBe(0);
  });

  test("errors and bad ids come back as tool errors", async () => {
    const forbidden = Response.json({ message: "Forbidden" }, { status: 403 });
    const { call } = await connect({
      ...TENANT,
      "calm-landscape/v1/landscapeObjects": forbidden,
      "calm-features/v1/Features": forbidden,
    });
    const land = await call("calm_landscape");
    expect(land.error).toBe(true);
    expect(land.text).toStartWith("Cloud ALM forbidden");
    // A part the key may not read is named; the rest still answers.
    const overview = await call("calm_overview");
    expect(overview.error).toBe(false);
    expect(overview.text).toContain("Not readable with this key (missing scope): features");
    const bad = await call("calm_get", { ids: ["../../x"] });
    expect(bad.text).toContain("is not an id");
  });

  test("allow list and default project", async () => {
    const { client } = await connect(TENANT, { tools: ["calm_overview", "calm_get"] });
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["calm_overview", "calm_get"]);
    expect(serverOptionsFromEnv({ CALM_PROJECT: PROJECT_ID, CALM_TOOLS: "calm_find, calm_get" })).toEqual({
      defaultProject: PROJECT_ID,
      tools: ["calm_find", "calm_get"],
    });
    expect(() => serverOptionsFromEnv({ CALM_TOOLS: "calm_drop" })).toThrow("unknown tools calm_drop");
    expect(() => serverOptionsFromEnv({ CALM_PROJECT: "x" })).toThrow("GUID");
  });

  test("a tenant with several projects asks for one", async () => {
    const two = {
      ...TENANT,
      "calm-projects/v1/projects": [
        ...(TENANT["calm-projects/v1/projects"] as object[]),
        { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Second", status: "O" },
      ],
    };
    const { call } = await connect(two);
    expect((await call("calm_overview")).text).toStartWith("2 projects. Pass projectId");
    const find = await call("calm_find", { query: "credit" });
    expect(find.error).toBe(true);
    expect(find.text).toContain("pass projectId");
    const ok = await call("calm_get", { ids: ["3-1"], projectId: PROJECT_ID });
    expect(ok.text).toContain(`[${REQ}]`);
  });
});

describe("mode (b): streamable HTTP with a bearer per request", () => {
  const fake = fakeCloudAlm();
  const server = Bun.serve({
    port: 0,
    fetch: createHttpHandler({
      baseUrl: BASE_URL,
      reader: { fetch: fake.fetch },
      server: {},
    }),
  });
  afterAll(() => server.stop(true));
  const endpoint = new URL(`http://127.0.0.1:${server.port}/mcp`);

  test("the caller's token reaches Cloud ALM; the server holds none", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: "Bearer broker-token-1" } },
      }),
    );
    const result = (await client.callTool({
      name: "calm_overview",
      arguments: {},
    })) as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain("Rollout Example");
    expect(fake.seen.at(-1)?.authorization).toBe("Bearer broker-token-1");
    await client.close();
  });

  test("no bearer, wrong method or a foreign API address is refused", async () => {
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "x", version: "0" },
      },
    };
    const post = (headers: Record<string, string>) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify(init),
      });
    const before = fake.seen.length;
    const noToken = await post({});
    expect(noToken.status).toBe(401);
    expect(noToken.headers.get("www-authenticate")).toContain("Bearer");
    expect((await fetch(endpoint)).status).toBe(405);
    expect(
      (
        await post({
          authorization: "Bearer t",
          "x-calm-api-url": "https://evil.example.com/api",
        })
      ).status,
    ).toBe(400);
    expect(fake.seen.length).toBe(before);
  });
});

describe("mode (a): stdio with the developer's service key", () => {
  test("the key file gives tokens by client credentials", async () => {
    const dir = mkdtempSync(join(tmpdir(), "calm-mcp-"));
    const path = join(dir, "key.json");
    writeFileSync(
      path,
      JSON.stringify({
        uaa: {
          url: "https://example.authentication.eu20.hana.ondemand.com",
          clientid: "id",
          clientsecret: "secret",
        },
        endpoints: { Api: BASE_URL },
      }),
    );
    const fake = fakeCloudAlm();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(readerFromKeyFile(path, { fetch: fake.fetch })).connect(
      serverSide,
    );
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    const result = (await client.callTool({
      name: "calm_overview",
      arguments: {},
    })) as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain("Rollout Example");
    expect(fake.seen[0]?.url.pathname).toBe("/oauth/token");
    expect(fake.seen[1]?.authorization).toBe("Bearer key-token");
  });

  test("a missing key path is a clear startup error", () => {
    expect(() => stdioServer({})).toThrow("CALM_SERVICE_KEY");
    expect(() => readerFromKeyFile("/nonexistent/key.json")).toThrow(
      "Cannot read the service key file",
    );
  });
});

test("SERVER_VERSION matches package.json", async () => {
  const { SERVER_VERSION } = await import("../src/server.js");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(SERVER_VERSION).toBe(pkg.version);
});
