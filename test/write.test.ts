import { describe, expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CloudAlm } from "../src/calm/index.js";
import { CloudAlmWriter } from "../src/calm/writer.js";
import { createServer, type ServerOptions, WRITE_TOOL_NAMES } from "../src/server.js";
import {
  BASE_URL,
  DEF,
  DOC,
  FEATURE,
  fakeWritableTenant,
  NEW_ACTIVITY,
  NEW_DOC,
  NEW_FEATURE,
  NEW_TC,
  PHASE_ID,
  REQ,
  REQ_DOC_LINK,
  TC2,
  TC2_LINK,
  TEST_CASE_MODIFIED_AT,
  US1,
  US1_REQ_RELATION,
  US2,
} from "./tenant.js";

async function connect(options: ServerOptions = { writeMode: "on" }, forbid: string[] = []) {
  const fake = fakeWritableTenant({ forbid });
  const grant = { accessToken: "t", baseUrl: BASE_URL };
  const calm = new CloudAlm(grant, { fetch: fake.fetcher });
  const writer = new CloudAlmWriter(grant, { fetch: fake.fetcher });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(calm, { writer, approval: "off", ...options }).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
    return { error: !!r.isError, text: r.content[0]?.text ?? "", structured: r.structuredContent };
  };
  return { client, call, posts: fake.posts, writes: fake.writes };
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

  test("on: write tools are listed and marked as not read-only; delete is destructive", async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools.filter((t) => (WRITE_TOOL_NAMES as readonly string[]).includes(t.name));
    expect(tools.map((t) => t.name)).toEqual([...WRITE_TOOL_NAMES]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(false);
      expect(Object.keys(t.inputSchema.properties ?? {})).toContain("dryRun");
    }
    expect(tools.find((t) => t.name === "calm_delete")?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "calm_create_task")?.annotations?.destructiveHint).toBe(false);
  });

  test("create a test case: one POST with steps, then the links, then a read back", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_create_test_case", testCase);
    expect(r.error).toBe(false);
    expect(r.text).toContain('Created 8-1-9 "Exposure shown"');
    expect(r.text).toContain("linked to 3-3");
    expect(r.text).toContain("cannot be tagged");
    expect(r.text).not.toContain("cannot be deleted");
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
    const { call, writes } = await connect();
    expect((await call("calm_create_test_case", { ...testCase, dryRun: true })).text).toStartWith("Dry run, nothing sent");
    const dup = await call("calm_create_test_case", { ...testCase, title: "release FROM the worklist" });
    expect(dup.text).toContain("exists: 8-1-2");
    const noDesc = await call("calm_create_test_case", {
      ...testCase,
      activities: [{ title: "x", steps: [{ title: "y", expected: "z" }] }],
    });
    expect(noDesc.error).toBe(true);
    expect(writes).toEqual([]);
  });

  test("dry-run mode turns every write into a preview", async () => {
    const { call, writes } = await connect({ writeMode: "dry-run" });
    expect((await call("calm_link", { from: "8-1-2", tasks: ["3-3"] })).text).toStartWith("Dry run");
    expect((await call("calm_update", { ids: ["3-3"], status: "done", dryRun: false })).text).toStartWith("Dry run (the server is in dry-run mode");
    expect((await call("calm_delete", { ids: ["3-4"], dryRun: false })).text).toStartWith("Dry run");
    expect((await call("calm_comment", { task: "3-4", text: "x" })).text).toStartWith("Dry run");
    expect(writes).toEqual([]);
  });

  test("tag merges with the current list and reports what Cloud ALM dropped", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_tag", { tasks: ["3-3"], add: ["Wave 2", "old"], remove: ["Old"] });
    expect(posts[0]?.body).toEqual({ taskId: US2, tags: ["Wave 2", "old"] });
    expect(r.text).toContain("3-3: [Old] → [Wave 2]");
    expect(r.text).toContain("did not store old");
  });

  test("tag keeps every existing tag, also past the 20th", async () => {
    const { call, posts } = await connect();
    await call("calm_tag", { tasks: ["[3-2]"], add: ["New"] });
    expect((posts[0]?.body as { tags: string[] }).tags).toHaveLength(26);
  });

  test("create a user story under a requirement", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_create_task", { type: "user_story", title: "Credit limit warning", description: "As a rep\n\nI see a warning.", requirement: "3-1" });
    expect(r.text).toStartWith('Created 3-99 user story "Credit limit warning" in scope "Order to Cash" under 3-1');
    expect(posts[0]?.body).toMatchObject({ type: "CALMUS", parentId: REQ, description: "<p>As a rep</p><p>I see a warning.</p>" });
    const bad = await call("calm_create_task", { type: "defect", title: "x", description: "y", requirement: "3-1" });
    expect(bad.text).toContain("only user stories and project tasks");
  });

  test("create a task without a description, with a named priority", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_create_task", { type: "defect", title: "Credit check skipped", priority: 20 });
    expect(r.text).toContain("priority high");
    expect(posts[0]?.body).toMatchObject({ type: "CALMDEF", priorityId: 20 });
    expect(posts[0]?.body).not.toHaveProperty("description");
  });

  test("the writer sends only allowed (method, path) pairs", async () => {
    const writer = new CloudAlmWriter({ accessToken: "t", baseUrl: BASE_URL });
    await expect(writer.post("calm-tasks/v1/tasks/x/delete", {})).rejects.toThrow("not a path");
    await expect(writer.delete("calm-tasks/v1/tasks")).rejects.toThrow("not a path");
    await expect(writer.patch(`calm-documents/v1/Documents/${DOC}`, {})).rejects.toThrow("not a path");
    await expect(writer.delete(`calm-tasks/v1/tasks/${US1}/relations/${US1_REQ_RELATION}`)).rejects.toThrow("not a path");
    await expect(writer.delete(`calm-features/v1/Features/${FEATURE}`)).rejects.toThrow("not a path");
    await expect(writer.patch(`calm-tasks/v1/tasks/${US1}`, {}, { ifMatch: 'x"\r\nX: y' })).rejects.toThrow("ETag");
  });
  test("refuses missing or quoted test-case timestamps before sending the write", async () => {
    const writer = new CloudAlmWriter({ accessToken: "t", baseUrl: BASE_URL });
    const path = `calm-testmanagement/v1/ManualTestCases/${TC2}`;
    await expect(writer.patch(path, {})).rejects.toThrow("modifiedAt");
    await expect(writer.delete(path, { ifMatch: 'W/"1"' })).rejects.toThrow("modifiedAt");
    await expect(writer.post(path + "/api.v1.ExternalTestCaseServiceAPI.forceDeletionIncludingTestRunsAndResults", {}, { ifMatch: "*" })).rejects.toThrow("modifiedAt");
    expect(writer.log).toHaveLength(0);
  });

  test("a lost response leaves the write outcome unknown", async () => {
    const fetcher = Object.assign(async () => { throw new TypeError("connection reset"); }, { preconnect: fetch.preconnect });
    const writer = new CloudAlmWriter({ accessToken: "t", baseUrl: BASE_URL }, { fetch: fetcher });
    await expect(writer.post("calm-tasks/v1/tasks", {})).rejects.toThrow("read the item before trying again");
    expect(writer.log).toHaveLength(1);
  });

});

describe("calm_link", () => {
  test("test case and feature links skip existing ones", async () => {
    const { call, posts } = await connect();
    const r = await call("calm_link", { from: "8-1-2", tasks: ["3-2", "3-3"] });
    expect(r.text).toBe("Linked test case 8-1-2 to 3-3. Already linked: 3-2.");
    expect(posts).toEqual([{ path: "calm-testmanagement/v1/TaskAssignments", body: { parentTestCase_ID: TC2, taskId: US2 } }]);
    const f = await call("calm_link", { from: "6-1", tasks: ["3-2"] });
    expect(f.text).toBe("Linked feature 6-1 to 3-2.");
    expect(posts[1]).toEqual({ path: `calm-tasks/v1/tasks/${US1}/featureAssignments`, body: { featureId: FEATURE } });
  });

  test("dry run names both sides with titles", async () => {
    const { call, writes } = await connect();
    const r = await call("calm_link", { from: "7-1", tasks: ["3-2"], dryRun: true });
    expect(r.text).toBe('Dry run, nothing sent. Would link document 7-1 "Credit design" to 3-2 user story "Release blocked orders from a worklist".');
    expect(writes).toEqual([]);
    // The same for the card, in people's words: kinds and titles, no ids.
    expect(r.structured?.change).toMatchObject({
      kind: "update",
      items: [{ type: "document", title: "Credit design", fields: [{ field: "Link to", after: 'User story "Release blocked orders from a worklist"' }] }],
    });
    const tc = await call("calm_create_test_case", { ...testCase, dryRun: true });
    const fields = (tc.structured?.change as { items: { type: string; fields: { field: string; after: string }[] }[] }).items[0]?.fields ?? [];
    expect(fields.map((f) => f.field)).toContain("Steps");
    expect(fields.find((f) => f.field === "Steps")?.after).toContain(testCase.activities[0]?.steps[0]?.expected ?? "?");
  });

  test("a document is linked through the Tasks API and unlinked by its assignment id", async () => {
    const { call, writes } = await connect();
    expect((await call("calm_link", { from: "7-1", tasks: ["3-2"] })).text).toBe("Linked document 7-1 to 3-2.");
    expect(writes[0]).toMatchObject({ method: "POST", path: `calm-tasks/v1/tasks/${US1}/documentAssignments`, body: { documentId: DOC } });
    const un = await call("calm_link", { from: "7-1", tasks: ["3-1", "3-4"], unlink: true });
    expect(un.text).toBe("Unlinked document 7-1 from 3-1. Not linked: 3-4.");
    expect(writes[1]).toMatchObject({ method: "DELETE", path: `calm-tasks/v1/tasks/documentAssignments/${REQ_DOC_LINK}` });
  });

  test("user stories go under a requirement as relation type 10, from either side", async () => {
    const { call, writes } = await connect();
    expect((await call("calm_link", { from: "3-1", tasks: ["3-2"] })).text).toBe("Nothing to do: requirement 3-1 is already linked to 3-2.");
    const un = await call("calm_link", { from: "3-2", tasks: ["3-1"], unlink: true });
    expect(un.text).toBe("Unlinked requirement 3-1 from 3-2.");
    expect(writes[0]).toMatchObject({ method: "DELETE", path: `calm-tasks/v1/tasks/relations/${US1_REQ_RELATION}` });
    const re = await call("calm_link", { from: "3-1", tasks: ["3-2"] });
    expect(re.text).toBe("Linked requirement 3-1 to 3-2.");
    expect(writes[1]).toMatchObject({ method: "POST", path: `calm-tasks/v1/tasks/${US1}/relations`, body: { type: "10", relationTaskId: REQ } });
    const bad = await call("calm_link", { from: "3-1", tasks: ["3-4"] });
    expect(bad.text).toContain("only user stories and project tasks go under a requirement, not 3-4 (defect)");
    const two = await call("calm_link", { from: "3-2", tasks: ["3-1", "3-3"] });
    expect(two.text).toContain("goes under one requirement");
  });

  test("named from the user story, the card still shows the requirement and the story, not the story twice", async () => {
    const { call } = await connect();
    const r = await call("calm_link", { from: "3-2", tasks: ["3-1"], unlink: true, dryRun: true });
    const change = r.structured?.change as { items: { id: string; type: string; fields: { field: string; after: string }[] }[] };
    expect(change.items[0]).toMatchObject({ id: "3-1", type: "requirement" });
    expect(change.items[0]?.fields[0]?.field).toBe("Remove the link to");
    expect(change.items[0]?.fields[0]?.after).toContain("User story");
    expect(change.items[0]?.fields[0]?.after).not.toContain("requirement");
  });

  test("unlinking a test case deletes its task assignment; a 403 names the scope", async () => {
    const { call, writes } = await connect();
    expect((await call("calm_link", { from: "8-1-2", tasks: ["3-2"], unlink: true })).text).toBe("Unlinked test case 8-1-2 from 3-2.");
    expect(writes[0]).toMatchObject({ method: "DELETE", path: `calm-testmanagement/v1/TaskAssignments/${TC2_LINK}` });
    const denied = await connect(undefined, ["DELETE calm-testmanagement/v1/TaskAssignments"]);
    const r = await denied.call("calm_link", { from: "8-1-2", tasks: ["3-2"], unlink: true });
    expect(r.error).toBe(true);
    expect(r.text).toContain("calm-api.testcases.delete");
  });
});

describe("calm_update", () => {
  test("dry run previews every field before → after and sends nothing", async () => {
    const { call, writes } = await connect();
    const r = await call("calm_update", { ids: ["3-3"], status: "in progress", priority: 10, dueDate: "2026-12-01", timebox: "realize", dryRun: true });
    expect(r.text).toBe(
      [
        "Dry run, nothing sent. Would change:",
        '3-3 user story "Credit exposure shown in the order (see REQ-01)":',
        "  status: open → in progress",
        "  priority: 20 high → 10 very high",
        "  dueDate: none → 2026-12-01",
        "  timebox: none → Realize",
      ].join("\n"),
    );
    expect(writes).toEqual([]);
  });

  test("PATCHes only changed fields, maps plain status per type, reads back", async () => {
    const { call, writes } = await connect();
    const r = await call("calm_update", { ids: ["3-3", "3-4"], status: "done", priority: 20, description: "Line one\n\nLine two" });
    expect(r.error).toBe(false);
    expect(writes.map((w) => [w.method, w.path])).toEqual([
      ["PATCH", `calm-tasks/v1/tasks/${US2}`],
      ["PATCH", `calm-tasks/v1/tasks/${DEF}`],
    ]);
    // Priority 20 is already set on 3-3 (not sent); 3-4 had 10.
    expect(writes[0]?.body).toEqual({ description: "<p>Line one</p><p>Line two</p>", status: "CIPUSCLOSE" });
    expect(writes[1]?.body).toEqual({ description: "<p>Line one</p><p>Line two</p>", priorityId: 20, status: "CIPDFCTDONE" });
    expect(r.text).toContain('3-3 user story "Credit exposure shown in the order (see REQ-01)":\n  description: "" → "Line one Line two"\n  status: open → done');
    expect(r.text).toContain("3-4 defect");
    expect(r.text).toContain("status: open → done");
    expect(r.text).not.toContain("asked for");
  });

  test("a requirement's approval states set subStatus and approvalState", async () => {
    const { call, writes } = await connect();
    const dry = await call("calm_update", { ids: ["3-1"], status: "approved", dryRun: true });
    expect(dry.text).toContain("status: open → in progress (in planning, approval approved)");
    expect(dry.text).toContain("an approval cannot be undone through the API");
    await call("calm_update", { ids: ["3-1"], status: "to be approved" });
    expect(writes[0]?.body).toEqual({ status: "CIPREQUINP", subStatus: "TO_BE_APPROVED", approvalState: "READY_4_APPR" });
    const review = await call("calm_update", { ids: ["3-1"], status: "in review" });
    expect(review.error).toBe(true);
    expect(review.text).toContain('a requirement has no status "in review"; it takes open, in progress, blocked, done, not relevant, to be approved');
  });

  test("refuses fields that do not apply, before writing anything", async () => {
    const { call, writes } = await connect();
    const a = await call("calm_update", { ids: ["3-3", "8-1-2"], prepared: true });
    expect(a.error).toBe(true);
    expect(a.text).toContain('3-3 user story "Credit exposure shown in the order (see REQ-01)": a task has no prepared to change');
    const b = await call("calm_update", { ids: ["6-1"], dueDate: "2026-12-01" });
    expect(b.text).toContain("a feature has no dueDate to change (it takes title, description, status, priority)");
    const c = await call("calm_update", { ids: ["7-1"], status: "released" });
    expect(c.text).toContain("a document cannot be changed through the Cloud ALM API");
    const d = await call("calm_update", { ids: ["3-2", "3-3"], title: "Same" });
    expect(d.text).toContain("one item at a time");
    const e = await call("calm_update", { ids: ["3-3"], timebox: "Sprint 9" });
    expect(e.text).toContain('no timebox "Sprint 9" in the project; it has Explore, Realize, Go-Live');
    expect(writes).toEqual([]);
  });

  test("a feature: status in plain words, known transitions, ready for production refused", async () => {
    const { call, writes } = await connect();
    const r = await call("calm_update", { ids: ["6-1"], status: "successfully tested", priority: 10 });
    expect(r.text).toBe('6-1 feature "Credit management":\n  status: in testing → tested\n  priority: 20 high → 10 very high');
    expect(writes[0]).toMatchObject({ method: "PATCH", path: `calm-features/v1/Features/${FEATURE}`, body: { statusCode: "SUCCESSFULLY_TESTED", priorityCode: 10 } });
    const back = await call("calm_update", { ids: ["6-1"], status: "in specification" });
    expect(back.text).toContain("from tested it allows in realization");
    const ready = await call("calm_update", { ids: ["6-1"], status: "ready for production" });
    expect(ready.text).toContain("does not let the API set a feature to ready for production");
    expect(writes).toHaveLength(1);
  });

  test("a manual test case: PATCH with its exact modifiedAt, addActivity appends an activity and its steps", async () => {
    const { call, writes } = await connect();
    const args = {
      ids: ["8-1-2"],
      prepared: false,
      addActivity: { title: "Undo", steps: [{ title: "Reset the block", description: "As controller", expected: "Blocked again" }] },
    };
    const dry = await call("calm_update", { ...args, dryRun: true });
    expect(dry.text).toContain('8-1-2 manual test case "Release from the worklist":\n  prepared: yes → no\n  activities: 1 → 2 (adds "Undo" as activity 2 with 1 steps: "Reset the block")');
    const r = await call("calm_update", args);
    expect(r.error).toBe(false);
    expect(writes[0]).toMatchObject({ method: "PATCH", path: `calm-testmanagement/v1/ManualTestCases/${TC2}`, body: { isPrepared: false }, ifMatch: TEST_CASE_MODIFIED_AT });
    expect(writes[1]).toMatchObject({ method: "POST", path: "calm-testmanagement/v1/Activities", body: { parent_ID: TC2, title: "Undo", sequence: 2, isInScope: true } });
    expect(writes[2]).toMatchObject({
      method: "POST",
      path: "calm-testmanagement/v1/Actions",
      body: { parent_ID: NEW_ACTIVITY, title: "Reset the block", description: "As controller", expectedResult: "Blocked again", sequence: 1 },
    });
    expect(r.text).toContain("prepared: yes → no");
    expect(r.text).toContain('added "Undo" with 1 steps (2 activities stored)');
  });

  test("an activity survives a failed step even when no parent fields changed", async () => {
    const { call, writes } = await connect(undefined, ["POST calm-testmanagement/v1/Actions"]);
    const result = await call("calm_update", {
      ids: ["8-1-2"],
      addActivity: { title: "Undo", steps: [{ title: "Reset", description: "Restore", expected: "Restored" }] },
    });
    expect(result.text).toContain(`Created activity "Undo" (${NEW_ACTIVITY}). Confirmed 0 of 1 steps`);
    expect(result.text).toContain("Read the activity");
    expect(writes.map(w => w.path)).toEqual(["calm-testmanagement/v1/Activities", "calm-testmanagement/v1/Actions"]);
  });

  test("no change when every field already has the value; a 403 names the scope", async () => {
    const { call, writes } = await connect();
    expect((await call("calm_update", { ids: ["3-3"], priority: 20 })).text).toBe('Nothing to do: 3-3 user story "Credit exposure shown in the order (see REQ-01)" already has priority 20 high.');
    expect(writes).toEqual([]);
    const denied = await connect(undefined, ["PATCH calm-tasks"]);
    const r = await denied.call("calm_update", { ids: ["3-3"], status: "blocked" });
    expect(r.error).toBe(true);
    expect(r.text).toContain("the key lacks calm-api.tasks.write");
  });
});

describe("calm_delete", () => {
  test("dry run lists exactly what goes; features are refused", async () => {
    const { call, writes } = await connect();
    const r = await call("calm_delete", { ids: ["3-4", "7-1"], dryRun: true });
    expect(r.text).toBe(
      [
        "Dry run, nothing sent. Would:",
        '- delete 3-4 defect "Credit block not set for export orders" (status open) with its comments and links; cannot be undone',
        '- delete 7-1 document "Credit design" (solution design, with its 3 links); cannot be undone',
        "Warning: 1 of them record a failed test (their test case loses its defect); marking it obsolete instead can be undone (SAP recommends it).",
      ].join("\n"),
    );
    const f = await call("calm_delete", { ids: ["3-4", "6-1"] });
    expect(f.error).toBe(true);
    expect(f.text).toContain("features cannot be deleted through the Cloud ALM API");
    expect(writes).toEqual([]);
  });

  test("deletes a task and reads back that it is gone; soft marks it obsolete", async () => {
    const { call, writes } = await connect();
    expect((await call("calm_delete", { ids: ["3-4"] })).text).toBe('Deleted 3-4 defect "Credit block not set for export orders".');
    expect(writes[0]).toMatchObject({ method: "DELETE", path: `calm-tasks/v1/tasks/${DEF}` });
    const soft = await call("calm_delete", { ids: ["3-3"], soft: true });
    expect(soft.text).toBe('Marked 3-3 user story "Credit exposure shown in the order (see REQ-01)" obsolete: obsolete yes.');
    expect(writes[1]).toMatchObject({ method: "PATCH", path: `calm-tasks/v1/tasks/${US2}`, body: { obsolete: true } });
    expect((await call("calm_delete", { ids: ["8-1-2"], soft: true })).text).toContain("soft applies to tasks only");
  });

  test("an approved requirement is not deleted", async () => {
    const { call } = await connect();
    await call("calm_update", { ids: ["3-1"], status: "approved" });
    const r = await call("calm_delete", { ids: ["3-1"] });
    expect(r.text).toContain("Cloud ALM does not delete approved requirements. Use soft: true");
  });

  test("test cases and documents: a 403 names the missing delete scope", async () => {
    const { call } = await connect(undefined, ["DELETE calm-testmanagement/v1/ManualTestCases", "DELETE calm-documents", "POST calm-testmanagement/v1/ManualTestCases/"]);
    const tc = await call("calm_delete", { ids: ["8-1-2"] });
    expect(tc.error).toBe(true);
    expect(tc.text).toContain("the key lacks calm-api.testcases.delete");
    const force = await call("calm_delete", { ids: ["8-1-2"], force: true });
    expect(force.text).toContain("the key lacks calm-api.testcases.force-delete");
    const doc = await call("calm_delete", { ids: ["7-1"] });
    expect(doc.text).toContain("the key lacks calm-api.documents.delete");
  });

  test("with the scopes: a test case is deleted with its exact modifiedAt, force uses the bound action", async () => {
    const { call, writes } = await connect();
    const normal = await connect();
    expect((await normal.call("calm_delete", { ids: ["8-1-2"] })).error).toBe(false);
    expect(normal.writes[0]).toMatchObject({ method: "DELETE", ifMatch: TEST_CASE_MODIFIED_AT });
    const dry = await call("calm_delete", { ids: ["8-1-2"], force: true, dryRun: true });
    expect(dry.text).toContain('force-delete 8-1-2 manual test case "Release from the worklist" (1 activities, 1 steps, linked to 3-2)');
    expect(dry.text).toContain("together with all its test runs and results");
    const r = await call("calm_delete", { ids: ["8-1-2"], force: true });
    expect(r.text).toBe('Deleted 8-1-2 manual test case "Release from the worklist" with its runs and results.');
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `calm-testmanagement/v1/ManualTestCases/${TC2}/api.v1.ExternalTestCaseServiceAPI.forceDeletionIncludingTestRunsAndResults`,
      ifMatch: TEST_CASE_MODIFIED_AT,
    });
    expect((await call("calm_delete", { ids: ["7-1"] })).text).toBe('Deleted 7-1 document "Credit design".');
  });
});

describe("calm_comment, calm_create_feature, calm_create_document", () => {
  test("a comment: preview with the text, then plain text as HTML", async () => {
    const { call, writes } = await connect();
    const dry = await call("calm_comment", { task: "3-4", text: "Seen in QA <again>", dryRun: true });
    expect(dry.text).toBe('Dry run, nothing sent. Would add to 3-4 defect "Credit block not set for export orders" the comment:\nSeen in QA <again>');
    const r = await call("calm_comment", { task: "3-4", text: "Seen in QA <again>" });
    expect(r.text).toStartWith('Added a comment to 3-4 defect "Credit block not set for export orders" [');
    expect(writes[0]).toMatchObject({ method: "POST", path: `calm-tasks/v1/tasks/${DEF}/comments`, body: { text: "<p>Seen in QA &lt;again&gt;</p>" } });
    const missing = await call("calm_comment", { task: "6-1", text: "x" });
    expect(missing.text).toContain("tasks not found");
  });

  test("an update whose comment fails still reports the fields it wrote", async () => {
    const { call, writes } = await connect(undefined, [`POST calm-tasks/v1/tasks/${DEF}/comments`]);
    const r = await call("calm_update", { ids: ["3-4"], priority: 20, comment: "Lowered after triage" });
    expect(r.error).toBe(false);
    expect(writes.some((w) => w.method === "PATCH")).toBe(true);
    expect(r.text).toContain("not confirmed");
    expect(r.text).toContain("the changes above were written");
  });

  test("a feature: duplicate refused, created and linked, read back", async () => {
    const { call, writes } = await connect();
    expect((await call("calm_create_feature", { title: "credit MANAGEMENT" })).text).toContain("exists: 6-1");
    const dry = await call("calm_create_feature", { title: "Dunning", tasks: ["3-2"], dryRun: true });
    expect(dry.text).toBe(
      'Dry run, nothing sent. Would create feature "Dunning" (in specification, priority 30 medium) linked to 3-2 user story "Release blocked orders from a worklist".\nNote: features cannot be deleted through the Cloud ALM API.',
    );
    const r = await call("calm_create_feature", { title: "Dunning", description: "Two levels", tasks: ["3-2"], priority: 20 });
    expect(r.text).toBe(`Created 6-9 feature "Dunning" [${NEW_FEATURE}]: in specification, priority 20 high; linked to 3-2.`);
    expect(writes[0]?.body).toEqual({ projectId: expect.any(String), title: "Dunning", description: "<p>Two levels</p>", statusCode: "CREATED", priorityCode: 20 });
    expect(writes[1]).toMatchObject({ path: `calm-tasks/v1/tasks/${US1}/featureAssignments`, body: { featureId: NEW_FEATURE } });
  });

  test("a document: type by name, links in the create, immutability said up front", async () => {
    const { call, writes } = await connect();
    expect((await call("calm_create_document", { title: "Credit design", content: "x" })).text).toContain("exists: 7-1");
    const dry = await call("calm_create_document", { title: "Dunning design", content: "Levels\n\nLetters", type: "solution design document", tasks: ["3-1"], dryRun: true });
    expect(dry.text).toContain('Would create document "Dunning design" (Solution Design Document, in progress, priority 30 medium');
    expect(dry.text).toContain('linked to 3-1 requirement "[demo] REQ-01 Credit check on order release"');
    expect(dry.text).toContain("cannot change a document's title, content, status, priority or type");
    const r = await call("calm_create_document", { title: "Dunning design", content: "Levels\n\nLetters", type: "SD", tasks: ["3-1"] });
    expect(r.text).toBe(`Created 7-9 document "Dunning design" [${NEW_DOC}]: solution design, in progress, linked to 1 tasks.`);
    expect(writes[0]?.body).toMatchObject({ content: "<p>Levels</p><p>Letters</p>", documentTypeCode: "SD", statusCode: 10, toTaskAssignments: [{ id: REQ }] });
    expect((await call("calm_create_document", { title: "y", content: "x", type: "Memo" })).text).toContain('no document type "Memo"');
  });
});

test("timebox by name resolves to its id", async () => {
  const { call, writes } = await connect();
  await call("calm_update", { ids: ["3-2"], timebox: "Realize" });
  expect(writes[0]?.body).toEqual({ timeboxId: PHASE_ID });
});

describe("title codes in write tools", () => {
  test("REQ-01 resolves to its task in writes, as in reads", async () => {
    const { call } = await connect();
    const r = await call("calm_create_task", { type: "user_story", title: "Code parent", requirement: "REQ-01", dryRun: true });
    expect(r.text).toContain("under 3-1");
    const c = await call("calm_comment", { task: "REQ-01", text: "x", dryRun: true });
    expect(c.text).toContain("3-1");
  });
});

test("a defect from a test case names it, and warns about an open defect for it", async () => {
  const { call, posts } = await connect();
  const r = await call("calm_create_task", { type: "defect", title: "Block missing again", testCase: "8-1-1", dryRun: true });
  expect(r.text).toContain('Found in test case 8-1-1 "Order blocked by credit limit"');
  expect(r.text).toContain("an open defect already exists for 8-1-1");
  expect(posts).toEqual([]);
  const bad = await call("calm_create_task", { type: "requirement", title: "x", testCase: "8-1-1", dryRun: true });
  expect(bad.text).toContain("testCase is for defects");
});

test("calm_update adds a comment with the change, in one call", async () => {
  const { call } = await connect();
  const r = await call("calm_update", { ids: ["3-3"], status: "blocked", comment: "Waiting for the credit team.", dryRun: true });
  expect(r.text).toContain('comment: "Waiting for the credit team."');
});

test("deleting defects raised from tests warns, and points to soft", async () => {
  const { call } = await connect();
  const all = await call("calm_list", { types: ["defect"], limit: 100 });
  const ids = [...all.text.matchAll(/- (3-\d+) defect/g)].map((m) => m[1]);
  const r = await call("calm_delete", { ids, dryRun: true });
  expect(r.text).toContain("record a failed test");
  expect(r.text).toContain("obsolete instead can be undone");
});

test("a title that reads like an empty value is shown as the title it is", async () => {
  const { call } = await connect();
  const r = await call("calm_update", { ids: ["3-3"], title: "None", dryRun: true });
  const change = r.structured?.change as { items: { fields: { field: string; after: string }[] }[] };
  expect(change.items[0]?.fields[0]?.after).toBe("None");
});

test("every write tool only proposes: nothing is sent before the user's yes, and the yes runs it once", async () => {
  const proposals: Record<string, Record<string, unknown>> = {
    calm_create_test_case: testCase,
    calm_link: { from: "8-1-2", tasks: ["3-3"] },
    calm_tag: { tasks: ["3-1"], add: ["Review"] },
    calm_create_task: { type: "defect", title: "Credit limit ignored on rush orders", description: "Steps to reproduce." },
    calm_update: { ids: ["3-3"], status: "in progress" },
    calm_delete: { ids: ["3-4"] },
    calm_comment: { task: "3-4", text: "Checked with the key user." },
    calm_create_feature: { title: "Rush order credit check" },
    calm_create_document: { title: "Credit check decisions", content: "Decided in the workshop." },
  };
  expect(Object.keys(proposals).sort()).toEqual([...WRITE_TOOL_NAMES].sort());
  for (const [name, args] of Object.entries(proposals)) {
    const { call, writes } = await connect({ writeMode: "on", approval: "prefer", chatHoldMs: 0 });
    const r = await call(name, args);
    expect(`${name}: ${r.text.slice(0, 15)}`).toBe(`${name}: Approval needed`);
    const approval = r.structured?.approval as { id: string; tool: string };
    expect(approval.tool).toBe(name);
    expect(writes).toEqual([]);
    const done = await call("calm_confirm", { id: approval.id, tool: name });
    expect(`${name}: ${done.error}`).toBe(`${name}: false`);
    expect(writes.length).toBeGreaterThan(0);
    const sent = writes.length;
    expect((await call("calm_confirm", { id: approval.id, tool: name })).error).toBe(true);
    expect(writes.length).toBe(sent);
  }
});
