import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudAlm } from "../src/calm/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHttpHandler } from "../src/http.js";
import { createServer, TOOL_NAMES } from "../src/server.js";
import { readerFromKeyFile, stdioServer } from "../src/stdio.js";

// Hand-written answers in Cloud ALM's shapes; invented values.
const BASE_URL = "https://eu20.alm.cloud.sap/api";
const PROJECT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const TASK_ID = "cccccccc-0000-4000-8000-000000000001";
const ROUTES: Record<string, unknown> = {
  "calm-projects/v1/projects": [
    {
      id: PROJECT_ID,
      name: "Rollout Example",
      status: "O",
      purpose: "IMPLEMENTATION",
      operationalStatus: "ONTRK",
    },
  ],
  "calm-tasks/v1/tasks": [
    {
      id: TASK_ID,
      projectId: PROJECT_ID,
      displayId: "3-12",
      title: "Credit memo uses the wrong tax code",
      type: "CALMDEF",
      status: "CIPDFCTOPEN",
      priorityId: 20,
    },
  ],
};

type Seen = { url: URL; authorization: string | null };
function fakeCloudAlm(routes: Record<string, unknown> = ROUTES) {
  const seen: Seen[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ url, authorization: headers.get("authorization") });
    if (url.pathname.endsWith("/oauth/token"))
      return Response.json({ access_token: "key-token", expires_in: 3600 });
    const body = routes[url.pathname.replace(/^\/api\//, "")];
    if (body === undefined)
      return Response.json({ message: "Not Found" }, { status: 404 });
    if (body instanceof Response) return body;
    return Response.json(body);
  }) as typeof fetch;
  return { fetch: fetcher, seen };
}

async function connect(calm: CloudAlm) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(calm).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

const text = (result: unknown) =>
  (result as { content: { type: string; text: string }[] }).content[0]?.text ??
  "";

describe("tools (in-process client)", () => {
  test("every tool is listed, read-only, with a description", async () => {
    const client = await connect(
      new CloudAlm(
        { accessToken: "t", baseUrl: BASE_URL },
        { fetch: fakeCloudAlm().fetch },
      ),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.description?.length).toBeGreaterThan(10);
    }
    const search = tools.find((t) => t.name === "calm_search_tasks");
    expect(Object.keys(search?.inputSchema.properties ?? {})).toEqual([
      "projectId",
      "type",
      "status",
      "query",
      "limit",
      "offset",
    ]);
  });

  test("tools answer with the library's text", async () => {
    const fake = fakeCloudAlm();
    const client = await connect(
      new CloudAlm(
        { accessToken: "t", baseUrl: BASE_URL },
        { fetch: fake.fetch },
      ),
    );
    expect(
      text(
        await client.callTool({ name: "calm_list_projects", arguments: {} }),
      ),
    ).toContain(`Rollout Example [${PROJECT_ID}]`);
    const tasks = await client.callTool({
      name: "calm_search_tasks",
      arguments: { type: "defect", limit: 5 },
    });
    expect(text(tasks)).toContain(
      `3-12 Credit memo uses the wrong tax code [${TASK_ID}] defect`,
    );
    expect(fake.seen.at(-1)?.url.searchParams.get("type")).toBe("CALMDEF");
  });

  test("Cloud ALM errors and bad arguments come back as tool errors", async () => {
    const client = await connect(
      new CloudAlm(
        { accessToken: "t", baseUrl: BASE_URL },
        {
          fetch: fakeCloudAlm({
            "calm-landscape/v1/landscapeObjects": Response.json(
              { message: "Forbidden", status: 403 },
              { status: 403 },
            ),
          }).fetch,
        },
      ),
    );
    const forbidden = await client.callTool({
      name: "calm_list_landscape",
      arguments: {},
    });
    expect(forbidden.isError).toBe(true);
    expect(text(forbidden)).toBe(
      "Cloud ALM forbidden: the token lacks the scope for this read (Forbidden)",
    );
    const notFound = await client.callTool({
      name: "calm_get_task",
      arguments: { taskId: TASK_ID },
    });
    expect(text(notFound)).toStartWith("Cloud ALM not_found");
    // Cloud ALM ids need not be RFC 4122 UUIDs; any GUID shape is accepted.
    const odd = await client.callTool({
      name: "calm_get_project",
      arguments: { projectId: "11111111-1111-1111-1111-111111111111" },
    });
    expect(text(odd)).toStartWith("Cloud ALM not_found");
    const invalid = await client.callTool({
      name: "calm_get_task",
      arguments: { taskId: "../../x" },
    });
    expect(invalid.isError).toBe(true);
  });
});

describe("mode (b): streamable HTTP with a bearer per request", () => {
  const fake = fakeCloudAlm();
  const server = Bun.serve({
    port: 0,
    fetch: createHttpHandler({
      baseUrl: BASE_URL,
      reader: { fetch: fake.fetch },
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
    const result = await client.callTool({
      name: "calm_list_projects",
      arguments: {},
    });
    expect(text(result)).toContain("Rollout Example");
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
    const client = await connect(
      readerFromKeyFile(path, { fetch: fake.fetch }),
    );
    expect(
      text(
        await client.callTool({ name: "calm_list_projects", arguments: {} }),
      ),
    ).toContain("Rollout Example");
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
