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
  taskDetail,
  testCaseExpanded,
} from "./fixtures.js";
import {
  formatAnalytics,
  formatLandscape,
  formatTask,
  formatTasks,
  formatTestCase,
  formatTestCases,
} from "../src/calm/format.js";
import { plainText } from "../src/calm/values.js";

const calm = new CloudAlm(grant, {
  fetch: fakeFetch({
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
      `- 3-12 Credit memo uses the wrong tax code [${TASK_ID}] defect · CIPDFCTOPEN · priority 20 · assignee Alex Example\ntasks: 1–1.`,
    );
  });

  test("a task shows its description and references", async () => {
    const text = formatTask(await calm.getTask(TASK_ID));
    expect(text).toContain(
      "defect · status CIPDFCTOPEN / DFC_NEW · priority 20 · scope Order to Cash · timebox Explore",
    );
    expect(text).toContain("- Create a return");
    expect(text).toContain("References:\n- Ticket https://example.com/t/1");
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
