import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CloudAlm } from "../src/calm/index.js";
import { CloudAlmWriter } from "../src/calm/writer.js";
import { createServer, type ServerOptions, WRITE_TOOL_NAMES } from "../src/server.js";
import { BASE_URL, FEATURE, REQ, TC2, TENANT, US1, US2 } from "./tenant.js";

const NEW_TC = "dddddddd-0000-4000-8000-000000000099";

/** The fake tenant plus POST handling: records bodies, answers like Cloud ALM. */
function fakeTenant() {
  const posts: { path: string; body: unknown }[] = [];
  const tags = new Map<string, string[]>([[US2, ["Old"]]]);
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\//, "");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ path, body });
      if (path === "calm-testmanagement/v1/ManualTestCases")
        return Response.json({ uuid: NEW_TC, displayId: "8-1-9" }, { status: 201 });
      if (path === "calm-tasks/v1/tasks/updateTags") {
        // Cloud ALM drops a tag differing only in capitals from an existing one.
        tags.set(String(body.taskId), (body.tags as string[]).filter((t) => t !== "old"));
        return Response.json(body);
      }
      if (path === "calm-tasks/v1/tasks")
        return Response.json({ id: "cccccccc-0000-4000-8000-000000000099", displayId: "3-99" }, { status: 201 });
      return new Response(null, { status: 201 });
    }
    if (path === `calm-testmanagement/v1/ManualTestCases/${NEW_TC}`)
      return Response.json({
        uuid: NEW_TC, displayId: "8-1-9", title: "Exposure shown",
        toActivities: [{ title: "Check", sequence: 1, toActions: [{ title: "Open the order", sequence: 1 }] }],
      });
    const taskId = /^calm-tasks\/v1\/tasks\/([0-9a-f-]{36})$/.exec(path)?.[1];
    if (taskId && tags.has(taskId))
      return Response.json({ ...(TENANT["calm-tasks/v1/tasks"] as { id: string }[]).find((t) => t.id === taskId), tags: tags.get(taskId) });
    const body = TENANT[path];
    if (path === "calm-processmanagement/v1/scopes") return Response.json([{ id: "bbbbbbbb-0000-4000-8000-000000000001", name: "O2C" }]);
    if (body === undefined) return Response.json({ message: "Not Found" }, { status: 404 });
    return Response.json(body);
  }) as typeof fetch;
  return { fetcher, posts };
}

async function connect(options: ServerOptions = { writeMode: "on" }) {
  const fake = fakeTenant();
  const grant = { accessToken: "t", baseUrl: BASE_URL };
  const calm = new CloudAlm(grant, { fetch: fake.fetcher });
  const writer = new CloudAlmWriter(grant, { fetch: fake.fetcher });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(calm, { writer, ...options }).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    return { error: !!r.isError, text: r.content[0]?.text ?? "" };
  };
  return { client, call, posts: fake.posts };
}

const testCase = {
  title: "Exposure shown",
  covers: ["3-3"],
  activities: [{ title: "Check", steps: [{ title: "Open the order", description: "As sales rep", expected: "Exposure is shown" }] }],
};

describe("write mode", () => {
  test("off by default: no write tools", async () => {
    const { client } = await connect({});
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const w of WRITE_TOOL_NAMES) expect(names).not.toContain(w);
  });

  test("on: write tools are listed and marked as not read-only", async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools.filter((t) => (WRITE_TOOL_NAMES as readonly string[]).includes(t.name));
    expect(tools.map((t) => t.name)).toEqual([...WRITE_TOOL_NAMES]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(false);
  });

  test("create a test case: one POST with steps, then the links, then a read back", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_create_test_case", testCase);
    expect(r.error).toBe(false);
    expect(r.text).toContain('Created 8-1-9 "Exposure shown"');
    expect(r.text).toContain("linked to 3-3");
    expect(r.text).toContain("cannot be deleted or tagged");
    expect(posts.map((p) => p.path)).toEqual([
      "calm-testmanagement/v1/ManualTestCases",
      "calm-testmanagement/v1/TaskAssignments",
    ]);
    const body = posts[0]?.body as { toActivities: { toActions: { description: string }[] }[]; scopeId: string };
    expect(body.toActivities[0]?.toActions[0]?.description).toBe("As sales rep");
    expect(body.scopeId).toBe("bbbbbbbb-0000-4000-8000-000000000001");
    expect(posts[1]?.body).toEqual({ parentTestCase_ID: NEW_TC, taskId: US2 });
  });

  test("dry run sends nothing; a duplicate title is refused; a step needs a description", async () => {
    const { call, posts } = await connect();
    expect((await call("calm_create_test_case", { ...testCase, dryRun: true })).text).toStartWith("Dry run, nothing sent");
    const dup = await call("calm_create_test_case", { ...testCase, title: "release FROM the worklist" });
    expect(dup.text).toContain("exists: 8-1-2");
    const noDesc = await call("calm_create_test_case", {
      ...testCase,
      activities: [{ title: "x", steps: [{ title: "y", expected: "z" }] }],
    });
    expect(noDesc.error).toBe(true);
    expect(posts).toEqual([]);
  });

  test("dry-run mode turns every write into a preview", async () => {
    const { call, posts } = await connect({ writeMode: "dry-run" });
    expect((await call("calm_link", { from: "8-1-2", tasks: ["3-3"] })).text).toStartWith("Dry run");
    expect(posts).toEqual([]);
  });

  test("link skips existing links and posts the new ones", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_link", { from: "8-1-2", tasks: ["3-2", "3-3"] });
    expect(r.text).toBe("Linked test case 8-1-2 to 3-3. Already linked: 3-2.");
    expect(posts).toEqual([{ path: "calm-testmanagement/v1/TaskAssignments", body: { parentTestCase_ID: TC2, taskId: US2 } }]);
    const f = await call("calm_link", { from: "6-1", tasks: ["3-2"] });
    expect(f.text).toBe("Linked feature 6-1 to 3-2.");
    expect(posts[1]).toEqual({ path: `calm-tasks/v1/tasks/${US1}/featureAssignments`, body: { featureId: FEATURE } });
  });

  test("tag merges with the current list and reports what Cloud ALM dropped", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_tag", { tasks: ["3-3"], add: ["Wave 2", "old"], remove: ["Old"] });
    expect(posts[0]?.body).toEqual({ taskId: US2, tags: ["Wave 2", "old"] });
    expect(r.text).toContain("3-3: [Old] → [Wave 2]");
    expect(r.text).toContain("did not store old");
  });

  test("create a user story under a requirement", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_create_task", { type: "user_story", title: "Credit limit warning", description: "As a rep\n\nI see a warning.", requirement: "3-1" });
    expect(r.text).toStartWith('Created 3-99 user story "Credit limit warning" under 3-1');
    expect(posts[0]?.body).toMatchObject({ type: "CALMUS", parentId: REQ, description: "<p>As a rep</p><p>I see a warning.</p>" });
    const bad = await call("calm_create_task", { type: "defect", title: "x", description: "y", requirement: "3-1" });
    expect(bad.text).toContain("only user stories and project tasks");
  });

  test("the writer posts only to its list of paths", async () => {
    const writer = new CloudAlmWriter({ accessToken: "t", baseUrl: BASE_URL });
    await expect(writer.post("calm-tasks/v1/tasks/x/delete", {})).rejects.toThrow("not a path");
  });
});
