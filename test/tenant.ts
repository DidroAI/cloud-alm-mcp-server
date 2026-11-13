/**
 * A small fake Cloud ALM tenant in the shapes the real APIs return, with
 * invented values: one project, a requirement with two user stories, a
 * defect, a feature, test cases, a document, a solution process.
 */
export const BASE_URL = "https://eu20.alm.cloud.sap/api";
export const PROJECT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PHASE_ID = "12121212-0000-4000-8000-000000000002";
export const REQ = "cccccccc-0000-4000-8000-000000000001";
export const US1 = "cccccccc-0000-4000-8000-000000000002";
export const US2 = "cccccccc-0000-4000-8000-000000000003";
export const DEF = "cccccccc-0000-4000-8000-000000000004";
export const FEATURE = "ffffffff-0000-4000-8000-000000000001";
export const DOC = "abababab-0000-4000-8000-000000000001";
export const TC1 = "dddddddd-0000-4000-8000-000000000001";
export const TC2 = "dddddddd-0000-4000-8000-000000000002";
export const TC3 = "dddddddd-0000-4000-8000-000000000003";
export const PROCESS = "ERL-00000000000000000000000000000001";

const task = (id: string, displayId: string, type: string, status: string, title: string, tags: string[] = []) => ({
  id,
  projectId: PROJECT_ID,
  displayId,
  type,
  status,
  title,
  priorityId: 20,
  tags,
  scopeName: "Order to Cash",
});
const tasks = [
  task(REQ, "3-1", "CALMREQU", "CIPREQUOPEN", "Credit check on order release", ["Wave 1"]),
  task(US1, "3-2", "CALMUS", "CIPUSOPEN", "Release blocked orders from a worklist"),
  task(US2, "3-3", "CALMUS", "CIPUSOPEN", "Credit exposure shown in the order"),
  task(DEF, "3-4", "CALMDEF", "CIPDFCTOPEN", "Credit block not set for export orders"),
];
const odata = (value: unknown[]) => ({ "@context": "$metadata#X", value });
const testCase = (uuid: string, displayId: string, title: string, prepared: boolean, taskIds: string[]) => ({
  uuid,
  displayId,
  title,
  isPrepared: prepared,
  projectId: PROJECT_ID,
  toTaskAssignments: taskIds.map((taskId, i) => ({ uuid: `17171717-0000-4000-8000-00000000000${i}`, taskId, parentTestCase_ID: uuid })),
});

export const TENANT: Record<string, unknown> = {
  "calm-projects/v1/projects": [
    { id: PROJECT_ID, name: "Rollout Example", status: "O", purpose: "IMPLEMENTATION", operationalStatus: "ONTRK", phaseId: PHASE_ID },
  ],
  [`calm-projects/v1/projects/${PROJECT_ID}`]: {
    id: PROJECT_ID, name: "Rollout Example", status: "O", purpose: "IMPLEMENTATION", operationalStatus: "ONTRK", phaseId: PHASE_ID,
  },
  [`calm-projects/v1/projects/${PROJECT_ID}/timeboxes`]: [
    { id: "12121212-0000-4000-8000-000000000001", name: "Explore", type: 1, startDate: null, endDate: null },
    { id: PHASE_ID, name: "Realize", type: 1, startDate: "2026-10-01", endDate: "2026-12-31" },
    { id: "12121212-0000-4000-8000-000000000003", name: "Go-Live", type: 0, startDate: null, endDate: null },
  ],
  "calm-tasks/v1/tasks": tasks,
  [`calm-tasks/v1/tasks/${REQ}`]: { ...tasks[0], description: "<p>Orders above the credit limit are <b>blocked</b>.</p>", timeboxName: "Realize" },
  [`calm-tasks/v1/tasks/${REQ}/comments`]: [],
  [`calm-tasks/v1/tasks/${REQ}/relations`]: [{ id: "r1", type: "0", relationTaskId: US1 }, { id: "r2", type: "0", relationTaskId: US2 }],
  [`calm-tasks/v1/tasks/${US1}/relations`]: [{ id: "r3", type: "10", relationTaskId: REQ }],
  [`calm-tasks/v1/tasks/${US2}/relations`]: [{ id: "r4", type: "10", relationTaskId: REQ }],
  [`calm-tasks/v1/tasks/${DEF}/relations`]: [],
  "calm-tasks/v1/tasks/solutionProcessAssignments": [
    { relationId: "p1", taskId: REQ, projectId: PROJECT_ID, solutionProcessId: PROCESS },
  ],
  "calm-features/v1/Features": odata([
    { uuid: FEATURE, displayId: "6-1", title: "Credit management", projectId: PROJECT_ID, statusCode: "IN_TESTING", priorityCode: 20,
      toTaskAssignments: [{ uuid: REQ, parent_uuid: FEATURE, type: "CALMREQU" }, { uuid: US2, parent_uuid: FEATURE, type: "CALMUS" }] },
  ]),
  [`calm-features/v1/Features/${FEATURE}`]: {
    uuid: FEATURE, displayId: "6-1", title: "Credit management", projectId: PROJECT_ID, statusCode: "IN_TESTING", priorityCode: 20,
    description: "<p>Credit segment per sales organisation.</p>",
    toTransports: [{ id: "DEVK900123" }], toTransportReferences: [],
  },
  "calm-documents/v1/Documents": odata([
    { uuid: DOC, displayId: "7-1", title: "Credit design", projectId: PROJECT_ID, documentTypeCode: "SD",
      toTaskAssignments: [{ uuid: "x1", parent_uuid: DOC, id: REQ, type: "CALMREQU" }],
      toTestCaseAssignments: [{ uuid: "x2", parent_uuid: DOC, testCaseUuid: TC1 }],
      toSolutionProcessAssignments: [{ uuid: "x3", parent_uuid: DOC, solutionProcessId: PROCESS }] },
  ]),
  "calm-testmanagement/v1/ManualTestCases": odata([
    testCase(TC1, "8-1-1", "Order blocked by credit limit", true, [REQ]),
    testCase(TC2, "8-1-2", "Release from the worklist", true, [US1]),
    testCase(TC3, "8-1-3", "Old regression case", false, []),
  ]),
  [`calm-testmanagement/v1/ManualTestCases/${TC2}`]: {
    ...testCase(TC2, "8-1-2", "Release from the worklist", true, [US1]),
    priorityCode: 10,
    toTagAssignments: [],
    toActivities: [
      { uuid: "a1", title: "Release", sequence: 1, isInScope: true,
        toActions: [{ uuid: "s1", title: "Open the worklist", description: "As credit controller", expectedResult: "The order is listed", sequence: 1, isEvidenceRequired: true }] },
    ],
  },
  "calm-testmanagement/v1/AutomatedTestCases": odata([]),
  "calm-testmanagement-testplans/v1/TestPlans": odata([
    { uuid: "eeeeeeee-0000-4000-8000-000000000001", displayId: "8-3-1", title: "UAT cycle 1", projectId: PROJECT_ID },
  ]),
  "calm-processmanagement/v1/solutionProcesses": odata([
    { solutionProcessId: PROCESS, solutionProcessVersionName: "Lead to Cash", isScoped: true, projectId: PROJECT_ID },
  ]),
  "calm-analytics/v1/odata/v4/analytics/Tests": {
    value: [
      { date: "2026-11-13", period: "C1D", projectGUID: PROJECT_ID, testcaseId: TC1, testPlan: "UAT cycle 1", status: "Failed", passedActions: 1, failedActions: 1, allActions: 2 },
      { date: "2026-11-13", period: "C1D", projectGUID: PROJECT_ID, testcaseId: TC1, testPlan: "(None)", status: "Initial", passedActions: 0, failedActions: 0, allActions: 0 },
      { date: "2026-11-13", period: "C1D", projectGUID: PROJECT_ID, testcaseId: TC2, testPlan: "UAT cycle 1", status: "Passed", passedActions: 1, failedActions: 0, allActions: 1 },
    ],
  },
  "calm-landscape/v1/landscapeObjects": [
    { lmsId: "l1", name: "acct-1", objectType: "CloudService", systemNumber: "100", role: "PROD", serviceType: "SAP Cloud ALM" },
  ],
  "bsm-service/v1/events": [
    { eventId: "e1", eventName: "EVB1", eventType: "Degradation", eventStatus: "Closed", eventStartTime: "2026-11-09T08:00:00Z", eventEndTime: "2026-11-09T09:00:00Z", systemNumber: "100" },
    { eventId: "e2", eventName: "EVB2", eventType: "Maintenance", eventStatus: "Planned", eventStartTime: "2026-11-20T08:00:00Z", systemNumber: "100" },
  ],
};

export type Seen = { url: URL; authorization: string | null };

/** A fake `fetch` answering from `routes` by path (after `/api/`). */
export function fakeCloudAlm(routes: Record<string, unknown> = TENANT) {
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
    if (body instanceof Response) return body.clone();
    return Response.json(body);
  }) as typeof fetch;
  return { fetch: fetcher, seen };
}
