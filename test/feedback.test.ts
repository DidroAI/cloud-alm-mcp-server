import { expect, test } from "bun:test";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { FEEDBACK_TOOL, feedbackSinkFromEnv } from "../src/feedback.js";
import { createHttpHandler } from "../src/http.js";
import { SERVER_VERSION, serverOptionsForKey } from "../src/server.js";
import { stdioServer } from "../src/stdio.js";
import { BASE_URL, fakeCloudAlm } from "./tenant.js";

const report = {
  tool: "calm_list",
  outcome: "completed_with_extra_work",
  observation: "I grouped paged list results by hand after fetching every item.",
  suggestion: "Offer a group-by option for list results.",
};
const key = JSON.stringify({
  uaa: { url: "https://example.authentication.eu20.hana.ondemand.com", clientid: "test", clientsecret: "secret" },
  endpoints: { Api: BASE_URL },
});

test("the operator chooses the destination once", () => {
  expect(feedbackSinkFromEnv({})).toBeUndefined();
  for (const url of ["http://example.com/reports", "https://user:pass@example.com", "https://example.com/?token=private", "invalid"])
    expect(() => feedbackSinkFromEnv({ CALM_FEEDBACK_URL: url })).toThrow("CALM_FEEDBACK_URL must");
  expect(feedbackSinkFromEnv({ CALM_FEEDBACK_URL: "https://example.com/reports" })).toBeFunction();
});

test("stdio advertises friction reporting on opt-in, regardless of the SAP key's scopes", async () => {
  for (const enabled of [false, true]) {
    const server = await stdioServer({
      CALM_SERVICE_KEY: key,
      ...(enabled ? { CALM_FEEDBACK_URL: "http://127.0.0.1:4317/reports" } : {}),
    }, { fetch: fakeCloudAlm().fetch });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    try {
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      expect(tools.some(tool => tool.name === FEEDBACK_TOOL)).toBe(enabled);
    } finally {
      await client.close();
      await server.close();
    }
  }
  const writable = serverOptionsForKey({} as never, ["calm_create_task"], "legacy", async () => "receipt");
  expect(writable.tools).toContain(FEEDBACK_TOOL);
});

test("feedback over MCP reaches the local inbox with a separate credential and no SAP fields", async () => {
  const deliveries: { body: unknown; auth: string | null }[] = [];
  let status = 201;
  const inbox = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    deliveries.push({ body: await req.json(), auth: req.headers.get("authorization") });
    return new Response("private receiver response", { status });
  } });
  const feedbackSink = feedbackSinkFromEnv({
    CALM_FEEDBACK_URL: `http://127.0.0.1:${inbox.port}/reports`,
    CALM_FEEDBACK_TOKEN: "inbox-only-token",
  })!;
  const fake = fakeCloudAlm();
  const http = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: createHttpHandler({ baseUrl: BASE_URL, reader: { fetch: fake.fetch }, feedbackSink }),
  });
  const client = new Client({ name: "test", version: "0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.port}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer sap-token" } },
    }));
    const observed = (await client.listTools()).tools.find(tool => tool.name === FEEDBACK_TOOL);
    expect(observed?.annotations).toMatchObject({ openWorldHint: true, readOnlyHint: false });
    const ok = await client.callTool({ name: FEEDBACK_TOOL, arguments: report });
    expect(ok.isError).not.toBe(true);
    expect(deliveries).toEqual([{ auth: "Bearer inbox-only-token", body: {
      reportId: expect.stringMatching(/^[\da-f-]{36}$/), serverVersion: SERVER_VERSION, ...report,
    } }]);
    for (const extra of [{ tool: "secret-project" }, { observation: "   " }, { suggestion: "See https://tenant.example/record" }, { tenant: "private" }]) {
      const invalid = await client.callTool({ name: FEEDBACK_TOOL, arguments: { ...report, ...extra } });
      expect(invalid.isError).toBe(true);
    }
    expect(deliveries).toHaveLength(1);
    status = 503;
    const failed = await client.callTool({ name: FEEDBACK_TOOL, arguments: report });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("private receiver response");
    expect(deliveries).toHaveLength(2);
    expect(fake.seen).toHaveLength(0);
  } finally {
    await client.close();
    http.stop(true);
    inbox.stop(true);
  }
});
