import { describe, expect, test } from "bun:test";
import { CloudAlm, taskTypeCode } from "../src/calm/client.js";
import { CloudAlmError } from "../src/calm/errors.js";
import {
  BASE_URL,
  emptyOData,
  FEATURE_ID,
  fakeFetch,
  grant,
  json,
  landscapeObjects,
  manualTestCases,
  PROCESS_ID,
  PROJECT_ID,
  projects,
  REQUIREMENT_ID,
  SECOND_PROJECT_ID,
  solutionProcesses,
  statusEvents,
  TASK_ID,
  TEST_CASE_ID,
  TEST_PLAN_ID,
  task,
  taskDetail,
  taskLinkRoutes,
  teams,
  testCaseExpanded,
  testPlanExpanded,
  timeboxes,
} from "./fixtures.js";

const client = (routes: Parameters<typeof fakeFetch>[0]) => {
  const fake = fakeFetch(routes);
  return {
    calm: new CloudAlm(grant, { fetch: fake.fetch }),
    calls: fake.calls,
  };
};

const tasksOf = (count: number, prefix = "cccccccc") =>
  Array.from({ length: count }, (_, i) =>
    task({
      id: `${prefix}-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      title: `Task ${i + 1}`,
    }),
  );

describe("projects", () => {
  test("lists and gets a project with timeboxes and teams", async () => {
    const { calm } = client({
      "calm-projects/v1/projects": projects,
      [`calm-projects/v1/projects/${PROJECT_ID}`]: projects[0],
      [`calm-projects/v1/projects/${PROJECT_ID}/timeboxes`]: timeboxes,
      [`calm-projects/v1/projects/${PROJECT_ID}/teams`]: teams,
    });
    expect(await calm.listProjects()).toEqual([
      {
        id: PROJECT_ID,
        name: "Rollout Example",
        status: "O",
        purpose: "IMPLEMENTATION",
        operationalStatus: "ONTRK",
        programId: null,
      },
    ]);
    const detail = await calm.getProject(PROJECT_ID.toUpperCase());
    expect(detail.timeboxes[0]?.name).toBe("Explore");
    expect(detail.teams[0]?.name).toBe("Core Team");
  });

  test("rejects a project id that is not a GUID before any request", async () => {
    const { calm, calls } = client({});
    await expect(calm.getProject("../x")).rejects.toMatchObject({
      code: "bad_request",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("tasks", () => {
  test("passes projectId, the type code and limit+1 paging", async () => {
    const { calm, calls } = client({ "calm-tasks/v1/tasks": tasksOf(3) });
    const page = await calm.listTasks({
      projectId: PROJECT_ID,
      type: "defect",
      limit: 2,
    });
    const query = calls[0]?.url.searchParams;
    expect(query?.get("projectId")).toBe(PROJECT_ID);
    expect(query?.get("type")).toBe("CALMDEF");
    expect(query?.get("limit")).toBe("3");
    expect(page.items).toHaveLength(2);
    expect(page.nextOffset).toBe(2);
    expect(page.items[0]).toMatchObject({
      displayId: "3-12",
      typeName: "defect",
      priority: 20,
      assigneeName: "Alex Example",
    });
    expect(Object.keys(page.items[0] ?? {})).not.toContain("customField1");
  });

  test("without a projectId, reads every project and merges", async () => {
    const { calm, calls } = client({
      "calm-projects/v1/projects": [
        projects[0],
        { ...projects[0], id: SECOND_PROJECT_ID },
      ],
      "calm-tasks/v1/tasks": (url: URL) =>
        json(
          url.searchParams.get("projectId") === PROJECT_ID
            ? tasksOf(2, "cccccccc")
            : tasksOf(2, "dededede"),
        ),
    });
    const page = await calm.listTasks({ limit: 3 });
    expect(calls.map((c) => c.url.searchParams.get("projectId"))).toEqual([
      null,
      PROJECT_ID,
      SECOND_PROJECT_ID,
    ]);
    expect(page.items.map((t) => t.id.slice(0, 8))).toEqual([
      "cccccccc",
      "cccccccc",
      "dededede",
    ]);
    expect(page.nextOffset).toBe(3);
    const next = await calm.listTasks({ limit: 3, offset: 3 });
    expect(next.items).toHaveLength(1);
    expect(next.nextOffset).toBeNull();
  });

  test("matches all query words in titles", async () => {
    const { calm } = client({
      "calm-tasks/v1/tasks": [
        task({ title: "Credit memo tax" }),
        task({
          id: "cccccccc-0000-4000-8000-000000000009",
          title: "Invoice output",
        }),
      ],
    });
    const page = await calm.listTasks({
      projectId: PROJECT_ID,
      query: "TAX memo",
    });
    expect(page.items.map((t) => t.title)).toEqual(["Credit memo tax"]);
  });

  test("gets a task with plain-text description, references and comments", async () => {
    const { calm } = client({
      ...taskLinkRoutes(),
      [`calm-tasks/v1/tasks/${TASK_ID}`]: taskDetail,
      [`calm-tasks/v1/tasks/${TASK_ID}/comments`]: [
        {
          createdByName: "Sam Example",
          createdAt: "2026-03-03T08:00:00Z",
          content: "<p>Seen again</p>",
        },
      ],
    });
    const t = await calm.getTask(TASK_ID);
    expect(t.description).toBe(
      "Found in UAT cycle 1.\n- Create a return\n- Bill it\nTax & totals differ.",
    );
    expect(t.externalReferences).toEqual([
      { name: "Ticket", url: "https://example.com/t/1" },
    ]);
    expect(t.comments).toEqual([
      {
        author: "Sam Example",
        createdAt: "2026-03-03T08:00:00Z",
        text: "Seen again",
      },
    ]);
  });

  test("a task comes with its requirement, test cases, features and processes", async () => {
    const { calm, calls } = client({
      ...taskLinkRoutes(),
      [`calm-tasks/v1/tasks/${TASK_ID}`]: taskDetail,
      [`calm-tasks/v1/tasks/${TASK_ID}/comments`]: [],
    });
    const t = await calm.getTask(TASK_ID);
    expect(t.links).toEqual({
      requirementId: REQUIREMENT_ID,
      testCases: [
        {
          id: TEST_CASE_ID,
          displayId: "8-1-1",
          title: "O2C-01 Example case",
          kind: "manual",
        },
      ],
      featureIds: [FEATURE_ID],
      solutionProcessIds: [PROCESS_ID],
      unavailable: [],
    });
    const manual = calls.find((c) =>
      c.url.pathname.endsWith("/ManualTestCases"),
    );
    expect(manual?.url.searchParams.get("$filter")).toBe(
      `toTaskAssignments/any(a:a/taskId eq ${TASK_ID})`,
    );
    const processes = calls.find((c) =>
      c.url.pathname.endsWith("/solutionProcessAssignments"),
    );
    expect(processes?.url.searchParams.get("taskId")).toBe(TASK_ID);
    expect(processes?.url.searchParams.get("projectId")).toBe(PROJECT_ID);
  });

  test("a link the key may not read is named, the task still comes", async () => {
    const forbidden = () => json({ message: "Forbidden", status: 403 }, 403);
    const { calm } = client({
      ...taskLinkRoutes(),
      "calm-testmanagement/v1/ManualTestCases": forbidden,
      "calm-testmanagement/v1/AutomatedTestCases": forbidden,
      [`calm-tasks/v1/tasks/${TASK_ID}`]: taskDetail,
      [`calm-tasks/v1/tasks/${TASK_ID}/comments`]: [],
    });
    const t = await calm.getTask(TASK_ID);
    expect(t.links?.unavailable).toEqual(["testCases"]);
    expect(t.links?.featureIds).toEqual([FEATURE_ID]);
    const noLinks = await calm.getTask(TASK_ID, { links: false });
    expect(noLinks.links).toBeNull();
  });

  test("a 404 becomes not_found with Cloud ALM's reason", async () => {
    const { calm } = client({
      [`calm-tasks/v1/tasks/${TASK_ID}`]: () =>
        json({ message: "Cannot find task" }, 404),
    });
    const error = await calm.getTask(TASK_ID).catch((e) => e);
    expect(error).toBeInstanceOf(CloudAlmError);
    expect(error).toMatchObject({
      code: "not_found",
      reason: "Cannot find task",
      status: 404,
    });
  });

  test("type names and codes map to codes", () => {
    expect(taskTypeCode("requirement")).toBe("CALMREQU");
    expect(taskTypeCode("User Story")).toBe("CALMUS");
    expect(taskTypeCode("calmtmpl")).toBe("CALMTMPL");
    expect(() => taskTypeCode("epic")).toThrow(CloudAlmError);
  });
});

describe("OData areas", () => {
  test("test cases: unquoted GUID filter, $top/$skip/$count, total", async () => {
    const { calm, calls } = client({
      "calm-testmanagement/v1/ManualTestCases": manualTestCases(3),
    });
    const page = await calm.listTestCases({
      projectId: PROJECT_ID,
      limit: 2,
      offset: 4,
    });
    const query = calls[0]?.url.searchParams;
    expect(query?.get("$filter")).toBe(`projectId eq ${PROJECT_ID}`);
    expect(query?.get("$top")).toBe("3");
    expect(query?.get("$skip")).toBe("4");
    expect(query?.get("$count")).toBe("true");
    // `$` is sent literally: Cloud ALM's process services need it so.
    expect(calls[0]?.url.search).toContain("$top=3");
    expect(page).toMatchObject({ total: 3, nextOffset: 6, offset: 4 });
    expect(page.items[0]).toMatchObject({
      id: TEST_CASE_ID,
      kind: "manual",
      displayId: "8-1-1",
    });
  });

  test("automated test cases use their own entity set", async () => {
    const { calm, calls } = client({
      "calm-testmanagement/v1/AutomatedTestCases":
        emptyOData("AutomatedTestCases"),
    });
    await calm.listTestCases({ kind: "automated" });
    expect(calls[0]?.url.pathname).toBe(
      "/api/calm-testmanagement/v1/AutomatedTestCases",
    );
  });

  test("a test case comes with activities and actions in sequence", async () => {
    const { calm, calls } = client({
      [`calm-testmanagement/v1/ManualTestCases/${TEST_CASE_ID}`]:
        testCaseExpanded,
    });
    const t = await calm.getTestCase(TEST_CASE_ID);
    expect(calls[0]?.url.searchParams.get("$expand")).toBe(
      "toActivities($expand=toActions),toTaskAssignments,toTagAssignments",
    );
    expect(t.tasks).toEqual([
      {
        taskId: TASK_ID,
        displayId: "3-12",
        type: "CALMDEF",
        typeName: "defect",
      },
    ]);
    expect(t.tags).toEqual([
      { label: "Wave 1", group: "Release" },
      { label: "Pricing", group: null },
    ]);
    expect(t.activities.map((a) => a.title)).toEqual(["Create order", "Bill"]);
    expect(t.activities[0]?.actions[0]).toEqual({
      title: "Enter the order",
      description: "Customer 1000, material M-01",
      expectedResult: "Order saved",
      evidenceRequired: true,
    });
  });

  test("coverage maps test cases to requirements and user stories", async () => {
    const req = task({
      id: REQUIREMENT_ID,
      type: "CALMREQU",
      displayId: "3-1",
    });
    const story = task({ type: "CALMUS", displayId: "3-2" });
    const tc = (uuid: string, displayId: string, taskIds: string[]) => ({
      uuid,
      displayId,
      title: displayId,
      toTaskAssignments: taskIds.map((taskId) => ({ taskId })),
    });
    const { calm, calls } = client({
      "calm-tasks/v1/tasks": (url: URL) =>
        json(url.searchParams.get("type") === "CALMREQU" ? [req] : [story]),
      "calm-testmanagement/v1/ManualTestCases": {
        value: [
          tc(TEST_CASE_ID, "8-1-1", [REQUIREMENT_ID]),
          tc("dddddddd-0000-4000-8000-000000000002", "8-1-2", []),
        ],
      },
      "calm-testmanagement/v1/AutomatedTestCases": {
        value: [
          tc("dddddddd-0000-4000-8000-000000000003", "8-2-1", [REQUIREMENT_ID]),
        ],
      },
    });
    const c = await calm.testCoverage({ projectId: PROJECT_ID });
    expect(c.types).toEqual(["CALMREQU", "CALMUS"]);
    expect(
      c.rows.map((r) => [
        r.task.displayId,
        r.testCases.map((t) => t.displayId),
      ]),
    ).toEqual([
      ["3-1", ["8-1-1", "8-2-1"]],
      ["3-2", []],
    ]);
    expect(c).toMatchObject({
      covered: 1,
      uncovered: 1,
      testCaseCount: 3,
      truncated: false,
    });
    expect(c.unlinkedTestCases.map((t) => t.displayId)).toEqual(["8-1-2"]);
    const manual = calls.find((x) =>
      x.url.pathname.endsWith("/ManualTestCases"),
    );
    expect(manual?.url.searchParams.get("$filter")).toBe(
      `projectId eq ${PROJECT_ID}`,
    );
    expect(manual?.url.searchParams.get("$expand")).toBe("toTaskAssignments");
    await expect(calm.testCoverage({ projectId: "nope" })).rejects.toThrow(
      CloudAlmError,
    );
  });

  test("a test plan comes with its test cases", async () => {
    const { calm } = client({
      [`calm-testmanagement-testplans/v1/TestPlans/${TEST_PLAN_ID}`]:
        testPlanExpanded,
    });
    const plan = await calm.getTestPlan(TEST_PLAN_ID);
    expect(plan.testCases).toEqual([
      {
        testCaseId: TEST_CASE_ID,
        displayId: "8-1-1",
        title: "O2C-01 Example case",
        type: "MANUAL",
      },
    ]);
  });

  test("a feature lists its transports", async () => {
    const { calm, calls } = client({
      [`calm-features/v1/Features/${FEATURE_ID}`]: {
        uuid: FEATURE_ID,
        displayId: "6-1",
        title: "Discount rule",
        projectId: PROJECT_ID,
        statusCode: "CIPFEATIMPL",
        priorityCode: 20,
        toTransports: [{ id: "S4DK900123", parent_uuid: FEATURE_ID }],
      },
    });
    const f = await calm.getFeature(FEATURE_ID);
    expect(calls[0]?.url.searchParams.get("$expand")).toBe("toTransports");
    expect(f.transports).toEqual(["S4DK900123"]);
  });

  test("documents select summary fields, and content only on get", async () => {
    const { calm, calls } = client({
      "calm-documents/v1/Documents": emptyOData("Documents"),
    });
    await calm.listDocuments();
    expect(calls[0]?.url.searchParams.get("$select")).not.toContain("content");
  });

  test("library kinds map to their services", async () => {
    const { calm, calls } = client({
      "calm-crosslibraryinterfaces/v1/Interfaces": {
        value: [
          {
            uuid: "22222222-0000-4000-8000-000000000001",
            displayId: "9-1",
            title: "Orders to WMS",
            interfaceTypeCode: "IDOC",
            sendingSolutionComponentName: "S/4HANA",
            receivingSolutionComponentName: "WMS",
            interfaceReadinessCode: "READY",
          },
        ],
      },
    });
    const page = await calm.listLibraryItems("interfaces");
    expect(calls[0]?.url.pathname).toBe(
      "/api/calm-crosslibraryinterfaces/v1/Interfaces",
    );
    expect(page.items[0]).toMatchObject({
      kind: "interfaces",
      typeCode: "IDOC",
      sender: "S/4HANA",
      receiver: "WMS",
      readinessCode: "READY",
    });
    await expect(
      calm.listLibraryItems("widgets" as "interfaces"),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  test("an OData 400 carries the provider's message", async () => {
    const { calm } = client({
      "calm-features/v1/Features": () =>
        json(
          {
            error: {
              code: "400",
              message:
                "The types 'Edm.Guid' and 'Edm.String' are not compatible.",
            },
          },
          400,
        ),
    });
    await expect(calm.listFeatures()).rejects.toMatchObject({
      code: "bad_request",
      reason: "The types 'Edm.Guid' and 'Edm.String' are not compatible.",
    });
  });
});

describe("REST areas", () => {
  test("solution processes page with literal $top/$skip", async () => {
    const { calm, calls } = client({
      "calm-processmanagement/v1/solutionProcesses": solutionProcesses,
    });
    const page = await calm.listSolutionProcesses({
      projectId: PROJECT_ID,
      limit: 5,
      offset: 5,
    });
    expect(calls[0]?.url.search).toBe(
      `?projectId=${PROJECT_ID}&$top=6&$skip=5`,
    );
    expect(page.items[0]).toMatchObject({
      id: "ERL-0001",
      name: "Lead to Cash for Cloud Deployment",
      isScoped: true,
      countryCount: 2,
      status: "Design",
    });
    expect(page.nextOffset).toBeNull();
  });

  test("landscape filters by object type and uses limit/offset", async () => {
    const { calm, calls } = client({
      "calm-landscape/v1/landscapeObjects": landscapeObjects,
    });
    const page = await calm.listLandscapeObjects({
      objectType: "CloudService",
      limit: 10,
    });
    expect(calls[0]?.url.search).toBe("?objectType=CloudService&limit=11");
    expect(page.items[0]).toMatchObject({
      objectType: "CloudService",
      serviceType: "SAP S/4HANA Cloud Public Edition",
      systemNumber: "000000001",
    });
    await expect(
      calm.listLandscapeObjects({ objectType: "a&b" }),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  test("status events", async () => {
    const { calm } = client({ "bsm-service/v1/events": statusEvents });
    const page = await calm.listStatusEvents();
    expect(page.items[0]).toMatchObject({
      name: "EVB00000001",
      type: "Communication",
      status: "Closed",
    });
  });
});

describe("analytics", () => {
  test("builds the filter, drops technical and empty columns", async () => {
    const { calm, calls } = client({
      "calm-analytics/v1/odata/v4/analytics/Defects": {
        value: [
          {
            firstWeekDay: 1,
            period: "C30D",
            timeZone: "UTC",
            date: "2026-03-01",
            name: "Wrong tax",
            priority: "High",
            workstream: null,
            counter: 1,
          },
        ],
      },
    });
    const result = await calm.queryAnalytics({
      dataset: "Defects",
      period: "C30D",
      filters: { project: "O'Brien" },
    });
    expect(calls[0]?.url.searchParams.get("$filter")).toBe(
      "period eq 'C30D' and project eq 'O''Brien'",
    );
    expect(result.columns).toEqual(["date", "name", "priority", "counter"]);
    expect(result.rows[0]).toEqual({
      date: "2026-03-01",
      name: "Wrong tax",
      priority: "High",
      counter: 1,
    });
  });

  test("rejects unknown datasets and odd codes", async () => {
    const { calm, calls } = client({});
    await expect(
      calm.queryAnalytics({ dataset: "Secrets" as "Tasks" }),
    ).rejects.toMatchObject({ code: "bad_request" });
    await expect(
      calm.queryAnalytics({ dataset: "Tasks", period: "C1D' or 1 eq 1" }),
    ).rejects.toMatchObject({ code: "bad_request" });
    expect(calls).toHaveLength(0);
  });

  test("a 428 (filter required) is a bad request with the reason", async () => {
    const { calm } = client({
      "calm-analytics/v1/odata/v4/analytics/MonitoringEvents": () =>
        json(
          {
            message: "PRECONDITION_REQUIRED : No filters provided",
            status: 428,
          },
          428,
        ),
    });
    await expect(
      calm.queryAnalytics({ dataset: "MonitoringEvents" }),
    ).rejects.toMatchObject({
      code: "bad_request",
      reason: "PRECONDITION_REQUIRED : No filters provided",
    });
  });
});

describe("paging bounds", () => {
  test("limit and offset are checked", async () => {
    const { calm } = client({});
    await expect(
      calm.listTasks({ projectId: PROJECT_ID, limit: 0 }),
    ).rejects.toMatchObject({ code: "bad_request" });
    await expect(calm.listFeatures({ limit: 201 })).rejects.toMatchObject({
      code: "bad_request",
    });
    await expect(calm.listFeatures({ offset: -1 })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  test("grant callback is called once per operation", async () => {
    let calls = 0;
    const fake = fakeFetch({ "calm-projects/v1/projects": projects });
    const calm = new CloudAlm(
      () => {
        calls++;
        return { accessToken: "t", baseUrl: BASE_URL };
      },
      { fetch: fake.fetch },
    );
    await calm.listProjects();
    await calm.listProjects();
    expect(calls).toBe(2);
  });
});
