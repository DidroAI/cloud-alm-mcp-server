import { describe, expect, test } from "bun:test";
import { CloudAlm } from "../src/calm/client.js";
import {
  fakeFetch,
  grant,
  landscapeObjects,
  manualTestCases,
  PROJECT_ID,
  TASK_ID,
  TEST_CASE_ID,
  task,
  taskDetail,
  taskLinkRoutes,
  testCaseExpanded,
} from "./fixtures.js";
import {
  formatAnalytics,
  formatCoverage,
  formatLandscape,
  formatTask,
  formatTasks,
  formatTestCase,
  formatTestCases,
} from "../src/calm/format.js";
import { plainText } from "../src/calm/values.js";

const calm = new CloudAlm(grant, {
  fetch: fakeFetch({
    ...taskLinkRoutes(),
    "calm-tasks/v1/tasks": [taskDetail],
    [`calm-tasks/v1/tasks/${TASK_ID}`]: taskDetail,
    [`calm-tasks/v1/tasks/${TASK_ID}/comments`]: [],
    "calm-testmanagement/v1/ManualTestCases": manualTestCases(3),
    [`calm-testmanagement/v1/ManualTestCases/${TEST_CASE_ID}`]:
      testCaseExpanded,
    "calm-landscape/v1/landscapeObjects": landscapeObjects,
  }).fetch,
});

describe("formatters", () => {
  test("a task list line carries ids an agent can reuse", async () => {
    const text = formatTasks(await calm.listTasks({ projectId: PROJECT_ID }));
    expect(text).toBe(
      `- 3-12 Credit memo uses the wrong tax code [${TASK_ID}] defect · CIPDFCTOPEN · priority 20 · assignee Alex Example · tags uat\ntasks: 1–1.`,
    );
  });

  test("a task shows its description and references", async () => {
    const text = formatTask(await calm.getTask(TASK_ID));
    expect(text).toContain(
      "defect · status CIPDFCTOPEN / DFC_NEW · priority 20 · scope Order to Cash · timebox Explore",
    );
    expect(text).toContain("- Create a return");
    expect(text).toContain("References:\n- Ticket https://example.com/t/1");
    expect(text).toContain(
      `Links:\n- requirement: [cccccccc-0000-4000-8000-000000000099]\n- test cases: 8-1-1 O2C-01 Example case [${TEST_CASE_ID}]`,
    );
  });

  test("test case lists say how to get the next page", async () => {
    const text = formatTestCases(await calm.listTestCases({ limit: 2 }));
    expect(text.split("\n").at(-1)).toBe(
      "test cases: 1–2 of 3. More: call again with offset 2.",
    );
  });

  test("a test case lists steps with what to do and expect", async () => {
    const text = formatTestCase(await calm.getTestCase(TEST_CASE_ID));
    expect(text).toContain(
      "1. Create order\n   1.1 Enter the order [evidence required]\n      Do: Customer 1000, material M-01\n      Expect: Order saved",
    );
    expect(text).toContain("2. Bill");
    expect(text).toContain(`Covers: 3-12 defect [${TASK_ID}]`);
    expect(text).toContain("Tags: Release: Wave 1, Pricing");
  });

  test("coverage lists tasks without a test case first", () => {
    const covered = task({ displayId: "3-1", title: "Covered", tags: [] });
    const open = task({
      id: "cccccccc-0000-4000-8000-000000000002",
      displayId: "3-2",
      title: "Open",
      tags: [],
    });
    const summary = (row: Record<string, unknown>) => ({
      id: String(row.id),
      displayId: String(row.displayId),
      projectId: PROJECT_ID,
      title: String(row.title),
      type: "CALMREQU",
      typeName: "requirement",
      status: null,
      subStatus: null,
      priority: null,
      assigneeName: null,
      scopeName: null,
      dueDate: null,
      tags: [],
      changedAt: null,
    });
    const text = formatCoverage({
      projectId: PROJECT_ID,
      types: ["CALMREQU"],
      rows: [
        {
          task: summary(covered),
          testCases: [
            {
              id: TEST_CASE_ID,
              displayId: "8-1-1",
              title: "T",
              kind: "manual",
            },
          ],
        },
        { task: summary(open), testCases: [] },
      ],
      covered: 1,
      uncovered: 1,
      testCaseCount: 1,
      unlinkedTestCases: [],
      truncated: false,
    });
    expect(text).toContain("2 tasks, 1 with a test case, 1 without");
    expect(text.indexOf("Without a test case:\n- 3-2 Open")).toBeGreaterThan(0);
    expect(text).toContain("3-1 Covered");
    expect(text).toContain("<- 8-1-1 T");
  });

  test("landscape and empty results", async () => {
    expect(formatLandscape(await calm.listLandscapeObjects())).toContain(
      "CloudService · SAP S/4HANA Cloud Public Edition",
    );
    expect(
      formatTasks({
        items: [],
        offset: 0,
        limit: 50,
        nextOffset: null,
        total: null,
      }),
    ).toBe("No tasks found.");
    expect(
      formatAnalytics({
        provider: "Tasks",
        rows: [],
        columns: [],
        total: null,
        truncated: false,
      }),
    ).toBe("No Tasks rows.");
  });
});

describe("plain text", () => {
  test("HTML becomes lines, entities decode, long text is cut", () => {
    expect(plainText("<p>a &lt;b&gt;</p><p>c&#39;d</p>")).toBe("a <b>\nc'd");
    expect(plainText("<script>x()</script>ok")).toBe("ok");
    expect(plainText("x".repeat(50), 10)).toBe(
      "xxxxxxxxx… [cut at 10 characters]",
    );
    expect(plainText("   ")).toBeNull();
  });
});
