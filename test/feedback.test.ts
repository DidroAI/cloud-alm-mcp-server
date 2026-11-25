import { expect, test } from "bun:test";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIDRO_FEEDBACK_URL, FEEDBACK_TOOL, MAX_REPORTS, feedbackSinkFromEnv, localFeedback, localFeedbackSink, setLocalFeedback } from "../src/feedback.js";
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

test("stdio advertises friction reporting unless it is turned off, regardless of the SAP key's scopes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calm-feedback-"));
  const offDir = join(dir, "off");
  setLocalFeedback(false, offDir);
  const cases: [Record<string, string>, boolean][] = [
    [{ CALM_CONFIG_DIR: join(dir, "fresh") }, true],
    [{ CALM_CONFIG_DIR: join(dir, "fresh"), CALM_FEEDBACK_URL: "http://127.0.0.1:4317/reports" }, true],
    [{ CALM_CONFIG_DIR: join(dir, "fresh"), CALM_FEEDBACK: "off" }, false],
    [{ CALM_CONFIG_DIR: offDir }, false],
    [{ CALM_CONFIG_DIR: offDir, CALM_FEEDBACK_URL: "http://127.0.0.1:4317/reports" }, false],
  ];
  for (const [env, enabled] of cases) {
    const server = await stdioServer({ CALM_SERVICE_KEY: key, ...env }, { fetch: fakeCloudAlm().fetch });
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
  rmSync(dir, { recursive: true, force: true });
  const writable = serverOptionsForKey({} as never, ["calm_create_task"], "legacy", async () => "receipt");
  expect(writable.tools).toContain(FEEDBACK_TOOL);
});

test("a local installation reports to Didro by default, without a credential, and can be switched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calm-feedback-"));
  expect(localFeedback({}, dir)).toMatchObject({ on: true, url: DIDRO_FEEDBACK_URL });
  expect(localFeedback({ CALM_FEEDBACK_URL: "https://example.com/r" }, dir)).toMatchObject({ on: true, url: "https://example.com/r" });
  // Anything but a plain yes is off: a typo does not leave reports on.
  for (const value of ["off", "OFF", "0", "false", "no", "of", "disabled", "none"]) expect(localFeedback({ CALM_FEEDBACK: value }, dir).on).toBe(false);
  for (const value of ["on", "1", "true", "YES", " "]) expect(localFeedback({ CALM_FEEDBACK: value }, dir).on).toBe(true);
  setLocalFeedback(false, dir);
  expect(localFeedback({}, dir).on).toBe(false);
  expect(localFeedbackSink({}, dir)).toBeUndefined();
  setLocalFeedback(true, dir);
  expect(localFeedback({}, dir).on).toBe(true);

  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: URL, init: RequestInit) => {
    sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  }) as never;
  try {
    // A token set for another receiver is not sent to Didro.
    await localFeedbackSink({ CALM_FEEDBACK_TOKEN: "for-someone-else" }, dir)?.(
      { tool: "calm_list", outcome: "recovered", observation: "A filter was refused once." }, "9.9.9");
  } finally {
    globalThis.fetch = real;
    rmSync(dir, { recursive: true, force: true });
  }
  expect(sent[0]?.url).toBe(DIDRO_FEEDBACK_URL);
  expect(sent[0]?.headers.Authorization).toBeUndefined();
  expect(Object.keys(sent[0]?.body ?? {}).sort()).toEqual(["observation", "outcome", "reportId", "serverVersion", "tool"]);
});

test("one running local server sends a handful of reports, then stops", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calm-feedback-"));
  let posts = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => (posts++, new Response(null, { status: 204 }))) as never;
  try {
    const sink = localFeedbackSink({}, dir)!;
    const one = { tool: "calm_list", outcome: "recovered", observation: "A filter was refused once." } as const;
    for (let i = 0; i < MAX_REPORTS; i++) await sink(one, "9.9.9");
    await expect(sink(one, "9.9.9")).rejects.toThrow("Enough reports");
    expect(posts).toBe(MAX_REPORTS);
  } finally {
    globalThis.fetch = real;
    rmSync(dir, { recursive: true, force: true });
  }
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
