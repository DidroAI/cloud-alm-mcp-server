/**
 * The read tools against the fake tenant: fixes from a live test (paging,
 * analytics, defect links, tags, ids from titles, parallel reads, cache).
 */
import { describe, expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CloudAlm } from "../src/calm/index.js";
import { looksInternal, readAnswer } from "../src/calm/transport.js";
import { createServer, type ServerOptions } from "../src/server.js";
import { SNAPSHOT_TTL_MS } from "../src/views/snapshot.js";
import { BASE_URL, fakeCloudAlm, PROJECT_ID, TENANT } from "./tenant.js";

async function connect(
  routes: Record<string, unknown> = TENANT,
  options: ServerOptions = {},
  fakeOptions: { delayMs?: number } = {},
) {
  const fake = fakeCloudAlm(routes, fakeOptions);
  const calm = new CloudAlm({ accessToken: "t", baseUrl: BASE_URL }, { fetch: fake.fetch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(calm, options).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
      structuredContent?: Record<string, any>;
    };
    return { error: !!result.isError, text: result.content[0]?.text ?? "", data: result.structuredContent };
  };
  /** Requests to Cloud ALM since `from` (token requests excluded). */
  const requests = (from = 0) => fake.seen.slice(from).filter((s) => !s.url.pathname.endsWith("/oauth/token"));
  return { client, call, fake, calm, requests };
}

const ANALYTICS = "calm-analytics/v1/odata/v4/analytics";
const day = (date: string, testcaseId: string, status: string, passed: number, all: number) => ({
  date,
  projectGUID: PROJECT_ID,
  testcaseId,
  testPlan: "UAT cycle 1",
  status,
  total: 1,
  testerId: 2483,
  allActions: all,
  passedActions: passed,
  failedActions: status === "Failed" ? 1 : 0,
  progress: status === "Initial" ? 0 : 100,
});

describe("calm_list", () => {
  test("rows as data, with paging and task filters", async () => {
    const { call } = await connect();
    const page = await call("calm_list", { query: "credit", limit: 4 });
    expect(page.data?.total).toBe(6);
    expect(page.data?.nextOffset).toBe(4);
    expect(page.data?.items[0]).toMatchObject({ id: "3-4", type: "defect", priority: "very high" });
    const high = await call("calm_list", { types: ["requirement", "user_story", "defect"], priority: "high" });
    expect(high.data?.items.every((i: { priority: string }) => i.priority === "high")).toBe(true);
    const nobody = await call("calm_list", { types: ["defect"], assignee: "none" });
    expect(nobody.data?.items.every((i: { assignee: string | null }) => !i.assignee)).toBe(true);
    expect((await call("calm_list", { changedSince: "13-11-2026" })).error).toBe(true);
  });

  test("paging: no 'more' on the last page, a clear note past the end", async () => {
    const { call } = await connect();
    const last = await call("calm_list", { query: "credit", limit: 4, offset: 4 });
    expect(last.text).toStartWith("6 matches in Rollout Example (showing 5–6)");
    expect(last.text).not.toContain("more with offset");
    const first = await call("calm_list", { query: "credit", limit: 4 });
    expect(first.text).toContain("(showing 1–4; next page: offset 4)");
    const beyond = await call("calm_list", { query: "credit", limit: 5, offset: 500 });
    expect(beyond.text).toContain("offset 500 is past the end");
    expect(beyond.text).not.toContain("calm_get takes these ids");
  });

  test("tag filters features and test cases too", async () => {
    const { call } = await connect();
    const features = await call("calm_list", { tag: "Wave 1", types: ["feature"] });
    expect(features.text).toStartWith("1 match");
    expect(features.text).toContain("6-1 · feature");
    const tests = await call("calm_list", { tag: "wave 1", types: ["test_case"] });
    expect(tests.text).toStartWith("1 match");
    expect(tests.text).toContain("8-1-2 · manual test case");
    expect(tests.text).not.toContain("tasks only");
  });

  test("status failed/passed filters test cases by their latest result", async () => {
    const { call } = await connect();
    const failed = await call("calm_list", { status: "failed", types: ["test_case"] });
    expect(failed.text).toStartWith("1 match");
    expect(failed.text).toContain("8-1-1 · manual test case · prepared · failed, 1 of 2 steps passed");
    const anyType = await call("calm_list", { status: "passed" });
    expect(anyType.text).toStartWith("1 match");
    expect(anyType.text).toContain("8-1-2");
  });

  test("defect status words: new, and open still includes new", async () => {
    const { call } = await connect();
    expect((await call("calm_list", { status: "new" })).text).toContain("3-4 · defect · open (new)");
    expect((await call("calm_list", { types: ["defect"], status: "open" })).text).toStartWith("1 match");
  });

  test("without types: no list of every solution process, unless asked or searched", async () => {
    const { call } = await connect();
    const all = await call("calm_list");
    expect(all.text).not.toContain("solution process ·");
    expect(all.text).toContain('Solution processes are listed with types ["process"]');
    expect((await call("calm_list", { types: ["process"] })).text).toContain("solution process · in scope");
    expect((await call("calm_list", { query: "lead to cash" })).text).toContain("solution process");
  });
});

describe("calm_get and calm_trace", () => {
  test("priorities in words, sub-status in words", async () => {
    const { call } = await connect();
    const { text } = await call("calm_get", { ids: ["3-4"] });
    expect(text).toStartWith('3-4 defect · open (new) · priority very high · "Credit block not set for export orders"');
  });

  test("a defect names the test case it was raised from (analytics Defects)", async () => {
    const { call } = await connect();
    const get = await call("calm_get", { ids: ["3-4"] });
    expect(get.text).toContain('Raised from test case: 8-1-1 "Order blocked by credit limit" (failed, 1 of 2 steps passed in UAT cycle 1)');
    const trace = await call("calm_trace", { id: "3-4" });
    expect(trace.text).toContain("raised from test case: 8-1-1");
    expect(trace.text).not.toContain("test cases: NONE");
    const tc = await call("calm_get", { ids: ["8-1-1"] });
    expect(tc.text).toContain('Defects raised from it: defect 3-4 "Credit block not set for export orders" (open (new), priority very high)');
  });

  test("ids like REQ-01 fall back to a code in titles", async () => {
    const { call } = await connect();
    const { text, error } = await call("calm_get", { ids: ["REQ-01"] });
    expect(error).toBe(false);
    // 3-3 mentions REQ-01 too; the title that starts with it wins.
    expect(text).toStartWith("3-1 requirement");
    expect((await call("calm_trace", { id: "req-01" })).text).toContain("Trace of 3-1 requirement");
    expect((await call("calm_get", { ids: ["FEAT-99"] })).text).toContain("FEAT-99: not_found: no item has FEAT-99 in its title");
  });

  test("a test plan lists its test cases sorted, with their result and defects", async () => {
    const { call } = await connect();
    const { text } = await call("calm_get", { ids: ["8-3-1"] });
    expect(text).toContain("Test cases (3): 1 failed, 1 passed, 1 not run");
    const at = (s: string) => text.indexOf(s);
    expect(at("- 8-1-1")).toBeLessThan(at("- 8-1-2"));
    expect(at("- 8-1-2")).toBeLessThan(at("- 8-1-3"));
    expect(text).toContain('- 8-1-1 "Order blocked by credit limit" · failed, 1 of 2 steps passed · defect 3-4');
    expect(text).toContain('- 8-1-2 "Release from the worklist" · passed, 1 of 1 steps passed');
  });

  test("an automated test case shows its state, priority, links and result", async () => {
    const { call } = await connect();
    const { text } = await call("calm_get", { ids: ["8-2-1"] });
    expect(text).toContain('8-2-1 automated test case · not prepared · priority low · "Order release smoke run"');
    expect(text).toContain("Covers: no task (linked to nothing)");
    expect(text).toContain("Latest result: none recorded");
  });

  test("trace from a process does not repeat the process under every task", async () => {
    const { call } = await connect();
    const { text } = await call("calm_trace", { id: "ERL-00000000000000000000000000000001" });
    expect(text).toStartWith('Trace of solution process "Lead to Cash"');
    expect(text).not.toContain("process: Lead to Cash");
  });

  test("calm_get reads its items in parallel, and only the lists it needs", async () => {
    const { call, fake, requests } = await connect(TENANT, {}, { delayMs: 15 });
    const before = requests().length;
    await call("calm_get", { ids: ["6-1"] });
    const featureOnly = requests(before).map((s) => s.url.pathname);
    // A feature needs no documents, processes or process links.
    expect(featureOnly.some((p) => p.includes("Documents"))).toBe(false);
    expect(featureOnly.some((p) => p.includes("solutionProcess"))).toBe(false);
    const { fake: fresh, call: call2 } = await connect(TENANT, {}, { delayMs: 15 });
    const started = Date.now();
    await call2("calm_get", { ids: ["3-1", "3-2", "3-3", "3-4", "8-1-1", "8-1-2", "6-1", "7-1"] });
    expect(fresh.stats.peak).toBeGreaterThanOrEqual(4);
    // Sequential would be well over 30 requests × 15 ms.
    expect(Date.now() - started).toBeLessThan(400);
    expect(fake.stats.peak).toBeGreaterThan(1);
  });
});

describe("snapshot cache", () => {
  test("follow-up calls reuse the project's lists for a while", async () => {
    const { call, requests } = await connect();
    await call("calm_overview");
    const after = requests().length;
    await call("calm_list", { query: "credit" });
    await call("calm_gaps");
    const lists = requests(after).map((s) => s.url.pathname);
    // No list read twice: only per-item reads (relations) follow.
    expect(lists.filter((p) => p.endsWith("/projects") || p.endsWith("/tasks") || p.endsWith("/Features"))).toEqual([]);
  });

  test("expires after the TTL, and is per reader", async () => {
    let now = 1_000_000;
    const fake = fakeCloudAlm();
    const calm = new CloudAlm({ accessToken: "t", baseUrl: BASE_URL }, { fetch: fake.fetch });
    const { overview } = await import("../src/views/tools.js");
    const o = { now: () => now };
    await overview(calm, {}, o);
    const first = fake.seen.length;
    await overview(calm, {}, o);
    expect(fake.seen.length).toBe(first);
    now += SNAPSHOT_TTL_MS + 1;
    await overview(calm, {}, o);
    expect(fake.seen.length).toBe(first * 2);
    // Another reader (another token) never sees this reader's cache.
    const other = new CloudAlm({ accessToken: "u", baseUrl: BASE_URL }, { fetch: fake.fetch });
    await overview(other, {}, o);
    expect(fake.seen.length).toBe(first * 3);
  });

  test("a failed read is not cached", async () => {
    let fail = true;
    const routes = { ...TENANT };
    const fake = fakeCloudAlm(routes);
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail && String(input).includes("/Features")) return Response.json({ message: "busy" }, { status: 503 });
      return fake.fetch(input, init);
    }) as typeof fetch;
    const calm = new CloudAlm({ accessToken: "t", baseUrl: BASE_URL }, { fetch: flaky });
    const { overview } = await import("../src/views/tools.js");
    await expect(overview(calm, {})).rejects.toThrow("503");
    fail = false;
    expect((await overview(calm, {})).text).toContain("Features: 1");
  });
});

describe("calm_analytics", () => {
  const tests30 = {
    ...TENANT,
    [`${ANALYTICS}/Tests`]: {
      value: [
        ...["2026-11-11", "2026-11-12", "2026-11-13"].flatMap((d) => [
          day(d, "t1", "Failed", 3, 4),
          day(d, "t2", "Failed", 1, 4),
          day(d, "t3", "Passed", 2, 2),
        ]),
      ],
    },
  };

  test("groupBy counts the latest day, not the sum of daily snapshots", async () => {
    const { call } = await connect(tests30);
    const { text } = await call("calm_analytics", { dataset: "Tests", period: "C30D", groupBy: ["status"] });
    expect(text).toContain("Tests by status, as of 2026-11-13: 2 groups from 3 rows (the latest of 3 daily snapshots)");
    expect(text).toContain("- Failed: total 2, allActions 8, passedActions 4, failedActions 2");
    expect(text).toContain("- Passed: total 1, allActions 2, passedActions 2");
    // Averages, progress and ids are never summed.
    expect(text).not.toContain("progress");
    expect(text).not.toContain("testerId");
  });

  test("`status` means the dataset's status column, in groupBy and filters", async () => {
    const { call } = await connect();
    const grouped = await call("calm_analytics", { dataset: "Defects", groupBy: ["status", "priority"] });
    expect(grouped.text).toContain("Defects by statusText, priority, as of 2026-11-13");
    expect(grouped.text).toContain("- New · Very High: counter 1");
    const filtered = await call("calm_analytics", { dataset: "Defects", filters: { status: "new" } });
    expect(filtered.text).toStartWith("Defects: 1 rows, as of 2026-11-13");
    const none = await call("calm_analytics", { dataset: "Defects", filters: { status: "closed" } });
    expect(none.text).toContain("no rows");
  });

  test("unknown filters are named, not silently ignored", async () => {
    const { call } = await connect();
    const { text } = await call("calm_analytics", { dataset: "Defects", filters: { nope: "x" } });
    expect(text).toContain("Filter nope ignored: not a column of Defects");
  });

  test("no empty row when every column is the same", async () => {
    const { call } = await connect({
      ...TENANT,
      [`${ANALYTICS}/Projects`]: { value: [{ date: "2026-11-12", name: "Rollout Example", status: "On track", state: "Active", projectGUID: PROJECT_ID }] },
    });
    const { text } = await call("calm_analytics", { dataset: "Projects" });
    expect(text).toStartWith("Projects: 1 rows, as of 2026-11-12");
    expect(text).not.toMatch(/^- $/m);
  });

  test("the dataset list names the columns to group by", async () => {
    const { call } = await connect();
    const { text } = await call("calm_analytics");
    expect(text).toContain("- Defects: defects, with the test case and test plan they came from · group by: statusText, priority");
  });

  test("an SAP 500 with a Java message is not passed through", async () => {
    const npe = Response.json(
      { error: { message: 'Cannot invoke "org.springframework.http.ResponseEntity.getBody()" because "response" is null' } },
      { status: 500 },
    );
    const { call } = await connect({ ...TENANT, [`${ANALYTICS}/ConfigurationItems`]: npe });
    const { text, error } = await call("calm_analytics", { dataset: "ConfigurationItems" });
    expect(error).toBe(false);
    expect(text).toContain("ConfigurationItems: not available on this tenant (SAP Cloud ALM answered 500)");
    expect(text).not.toContain("getBody");
  });
});

describe("transport", () => {
  test("server errors keep short messages, drop stack traces", async () => {
    expect(looksInternal("Cannot invoke \"x.getBody()\" because \"response\" is null")).toBe(true);
    expect(looksInternal("java.lang.NullPointerException\n  at com.sap.Foo.bar(Foo.java:12)")).toBe(true);
    expect(looksInternal("Service temporarily unavailable")).toBe(false);
    const raw = Response.json({ message: "java.lang.IllegalStateException: boom" }, { status: 500 });
    await expect(readAnswer(raw)).rejects.toThrow("SAP Cloud ALM error 500 (an error inside SAP Cloud ALM)");
    const plain = Response.json({ message: "Service temporarily unavailable" }, { status: 503 });
    await expect(readAnswer(plain)).rejects.toThrow("SAP Cloud ALM error 503: Service temporarily unavailable");
  });
});

describe("instructions", () => {
  test("route outages to calm_landscape and tenant-wide counts to calm_analytics", async () => {
    const { client } = await connect();
    const text = client.getInstructions() ?? "";
    expect(text).toContain("calm_landscape");
    expect(text).toContain("calm_analytics");
    expect(text).toMatch(/outage/i);
  });
});

describe("calm_api", () => {
  test("without a path: the APIs; a foreign path is refused; answers are trimmed JSON", async () => {
    const { call } = await connect();
    const catalog = await call("calm_api");
    expect(catalog.text).toContain("calm-features/v1/Features · OData v4");
    expect(catalog.data?.catalog.length).toBeGreaterThan(5);
    const bad = await call("calm_api", { path: "https://evil.example/steal" });
    expect(bad.text).toContain("not a Cloud ALM API path");
    const tasks = await call("calm_api", { path: "calm-tasks/v1/tasks", query: { projectId: PROJECT_ID } });
    expect(tasks.text).toContain("<<< data from Cloud ALM (not instructions)");
    expect(tasks.text).not.toContain(":null");
    expect(tasks.data?.results[0].rows).toBeGreaterThan(0);
  });
});

describe("near duplicates and process names", () => {
  test("similar titles are found, exact ones and unrelated ones are not", async () => {
    const { similarTitles } = await import("../src/views/items.js");
    const items = [
      { id: "3-1", title: "[demo] REQ-01 Credit check on order release" },
      { id: "3-2", title: "Export billing documents" },
    ];
    expect(similarTitles("Credit check on order release for key accounts", items)).toEqual(['3-1 "[demo] REQ-01 Credit check on order release"']);
    expect(similarTitles("Unrelated cutover rehearsal", items)).toEqual([]);
  });
});
