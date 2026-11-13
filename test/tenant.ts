/**
 * A small fake Cloud ALM tenant in the shapes the real APIs return, with
 * invented values: one project, a requirement with two user stories, a
 * defect, a feature, test cases, a document, a solution process.
 */
export const BASE_URL = "https://eu20.alm.cloud.sap/api";
export const PROJECT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const PHASE_ID = "12121212-0000-4000-8000-000000000002";
export const REQ = "cccccccc-0000-4000-8000-000000000001";
export const US1 = "cccccccc-0000-4000-8000-000000000002";
export const US2 = "cccccccc-0000-4000-8000-000000000003";
export const DEF = "cccccccc-0000-4000-8000-000000000004";
export const FEATURE = "ffffffff-0000-4000-8000-000000000001";
export const DOC = "abababab-0000-4000-8000-000000000001";
export const TC1 = "dddddddd-0000-4000-8000-000000000001";
export const TC2 = "dddddddd-0000-4000-8000-000000000002";
export const TC3 = "dddddddd-0000-4000-8000-000000000003";
export const ATC = "dddddddd-0000-4000-8000-000000000004";
export const PLAN = "eeeeeeee-0000-4000-8000-000000000001";
export const PROCESS = "ERL-00000000000000000000000000000001";

const task = (id: string, displayId: string, type: string, status: string, title: string, tags: string[] = [], priorityId = 20, subStatus: string | null = null) => ({
  id,
  projectId: PROJECT_ID,
  displayId,
  type,
  status,
  subStatus,
  title,
  priorityId,
  tags,
  scopeName: "Order to Cash",
});
const tasks = [
  task(REQ, "3-1", "CALMREQU", "CIPREQUOPEN", "[demo] REQ-01 Credit check on order release", ["Wave 1"], 20, "CREATED"),
  task(US1, "3-2", "CALMUS", "CIPUSOPEN", "Release blocked orders from a worklist"),
  task(US2, "3-3", "CALMUS", "CIPUSOPEN", "Credit exposure shown in the order (see REQ-01)"),
  task(DEF, "3-4", "CALMDEF", "CIPDFCTOPEN", "Credit block not set for export orders", [], 10, "DFC_NEW"),
];
const odata = (value: unknown[]) => ({ "@context": "$metadata#X", value });
const testCase = (uuid: string, displayId: string, title: string, prepared: boolean, taskIds: string[], tags: string[] = []) => ({
  uuid,
  displayId,
  title,
  isPrepared: prepared,
  priorityCode: 30,
  projectId: PROJECT_ID,
  toTaskAssignments: taskIds.map((taskId, i) => ({ uuid: `17171717-0000-4000-8000-00000000000${i}`, taskId, parentTestCase_ID: uuid })),
  toTagAssignments: tags.map((label, i) => ({ uuid: `18181818-0000-4000-8000-00000000000${i}`, label, groupLabel: null })),
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
  [`calm-tasks/v1/tasks/${DEF}`]: { ...tasks[3], description: "<p>Found in UAT cycle 1.</p>" },
  [`calm-tasks/v1/tasks/${DEF}/comments`]: [],
  [`calm-tasks/v1/tasks/${US2}`]: { ...tasks[2] },
  [`calm-tasks/v1/tasks/${US2}/comments`]: [],
  "calm-tasks/v1/tasks/solutionProcessAssignments": [
    { relationId: "p1", taskId: REQ, projectId: PROJECT_ID, solutionProcessId: PROCESS },
  ],
  "calm-features/v1/Features": odata([
    { uuid: FEATURE, displayId: "6-1", title: "Credit management", projectId: PROJECT_ID, statusCode: "IN_TESTING", priorityCode: 20, tags: ["Wave 1"],
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
    testCase(TC2, "8-1-2", "Release from the worklist", true, [US1], ["Wave 1"]),
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
  [`calm-testmanagement/v1/ManualTestCases/${TC1}`]: {
    ...testCase(TC1, "8-1-1", "Order blocked by credit limit", true, [REQ]),
    toActivities: [],
  },
  "calm-testmanagement/v1/AutomatedTestCases": odata([
    { uuid: ATC, displayId: "8-2-1", title: "Order release smoke run", isPrepared: false, priorityCode: 40, projectId: PROJECT_ID, toTaskAssignments: [] },
  ]),
  "calm-testmanagement-testplans/v1/TestPlans": odata([
    { uuid: PLAN, displayId: "8-3-1", title: "UAT cycle 1", projectId: PROJECT_ID },
  ]),
  [`calm-testmanagement-testplans/v1/TestPlans/${PLAN}`]: {
    uuid: PLAN, displayId: "8-3-1", title: "UAT cycle 1", projectId: PROJECT_ID, description: "First acceptance cycle.",
    toTestCaseAssignments: [
      { testCaseId: TC2, testCaseDisplayId: "8-1-2", testCaseTitle: "Release from the worklist", sequence: 1 },
      { testCaseId: TC3, testCaseDisplayId: "8-1-3", testCaseTitle: "Old regression case", sequence: 2 },
      { testCaseId: TC1, testCaseDisplayId: "8-1-1", testCaseTitle: "Order blocked by credit limit", sequence: 3 },
    ],
  },
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
  "calm-analytics/v1/odata/v4/analytics/Defects": {
    value: [
      { date: "2026-11-13", period: "C1D", project: PROJECT_ID, GUID: DEF, defectId: "3-4", statusText: "New", defectStatus: "DFC_NEW", priority: "Very High", testcaseId: TC1, testcaseName: "Order blocked by credit limit", testPlan: "UAT cycle 1", counter: 1 },
    ],
  },
  "calm-landscape/v1/landscapeObjects": [
    { lmsId: "l1", name: "acct-1", objectType: "CloudService", systemNumber: "100", role: "PROD", serviceType: "SAP Cloud ALM" },
  ],
  "bsm-service/v1/events": [
    { eventId: "e1", eventName: "EVB1", eventType: "Degradation", eventStatus: "Closed", eventStartTime: "2026-11-09T08:00:00Z", eventEndTime: "2026-11-09T09:00:00Z", systemNumber: "100" },
    { eventId: "e2", eventName: "EVB2", eventType: "Maintenance", eventStatus: "Planned", eventStartTime: "2026-11-20T08:00:00Z", systemNumber: "100",
      eventDescription: "<p>Planned database upgrade; the service is read-only for 30 minutes.</p>" },
  ],
};

export type Seen = { url: URL; authorization: string | null };

/**
 * A fake `fetch` answering from `routes` by path (after `/api/`). With
 * `delayMs`, each answer waits that long, and `peak` records the most
 * requests in flight at once.
 */
export function fakeCloudAlm(routes: Record<string, unknown> = TENANT, options: { delayMs?: number } = {}) {
  const seen: Seen[] = [];
  const stats = { inFlight: 0, peak: 0 };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ url, authorization: headers.get("authorization") });
    if (url.pathname.endsWith("/oauth/token"))
      return Response.json({ access_token: "key-token", expires_in: 3600 });
    stats.inFlight++;
    stats.peak = Math.max(stats.peak, stats.inFlight);
    try {
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    } finally {
      stats.inFlight--;
    }
    const body = routes[url.pathname.replace(/^\/api\//, "")];
    if (body === undefined)
      return Response.json({ message: "Not Found" }, { status: 404 });
    if (body instanceof Response) return body.clone();
    return Response.json(body);
  }) as typeof fetch;
  return { fetch: fetcher, seen, stats };
}

export const NEW_TC = "dddddddd-0000-4000-8000-000000000099";
export const NEW_TASK = "cccccccc-0000-4000-8000-000000000099";
export const NEW_FEATURE = "ffffffff-0000-4000-8000-000000000099";
export const NEW_DOC = "abababab-0000-4000-8000-000000000099";
export const NEW_ACTIVITY = "a1a1a1a1-0000-4000-8000-000000000099";
/** The task assignment linking TC2 to US1 (see `testCase` above). */
export const TC2_LINK = "17171717-0000-4000-8000-000000000000";
export const US1_REQ_RELATION = "e1e1e1e1-0000-4000-8000-000000000001";
export const REQ_DOC_LINK = "d1d1d1d1-0000-4000-8000-000000000001";

export type Write = { method: string; path: string; body: unknown; ifMatch: string | null };
type Row = Record<string, unknown>;

/**
 * The fake tenant with writes: POST, PATCH and DELETE change an in-memory
 * copy and are recorded in `writes` (POSTs also in `posts`). Answers like
 * Cloud ALM: a test case PATCH needs its ETag in If-Match (else 428), an
 * approved requirement is not deleted (400), a path in `forbid`
 * ("METHOD path-prefix") answers 403 as for a missing scope.
 */
const TENANT_ROWS = TENANT;
export function fakeWritableTenant(options: { forbid?: string[] } = {}) {
  const writes: Write[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const rows = new Map<string, Row>();
  // A deep copy: writes must not change TENANT for other tests.
  const TENANT = structuredClone(TENANT_ROWS);
  const many = Array.from({ length: 25 }, (_, i) => `T${i + 1}`);
  const tags = new Map<string, string[]>([[US2, ["Old"]], [US1, many]]);
  for (const t of TENANT["calm-tasks/v1/tasks"] as Row[]) {
    const path = `calm-tasks/v1/tasks/${t.id}`;
    rows.set(path, {
      ...t,
      ...((TENANT[path] as Row | undefined) ?? {}),
      tags: tags.get(String(t.id)) ?? t.tags,
      subStatus: null,
      approvalState: null,
      timeboxId: null,
      assigneeId: null,
      assigneeName: null,
      startDate: null,
      dueDate: null,
      obsolete: false,
    });
  }
  rows.set(`calm-features/v1/Features/${FEATURE}`, { ...(TENANT[`calm-features/v1/Features/${FEATURE}`] as Row) });
  rows.set(`calm-testmanagement/v1/ManualTestCases/${TC2}`, {
    ...(TENANT[`calm-testmanagement/v1/ManualTestCases/${TC2}`] as Row),
    "@etag": 'W/"1"',
  });
  rows.set(`calm-documents/v1/Documents/${DOC}`, { ...((TENANT["calm-documents/v1/Documents"] as { value: Row[] }).value[0] as Row) });
  // Link rows of the Tasks API, with GUID ids as Cloud ALM has.
  const relations = [
    { id: US1_REQ_RELATION, taskId: US1, type: "10", relationTaskId: REQ },
    { id: "e1e1e1e1-0000-4000-8000-000000000002", taskId: US2, type: "10", relationTaskId: REQ },
  ];
  const featureLinks = [
    { id: "f1f1f1f1-0000-4000-8000-000000000001", taskId: REQ, featureId: FEATURE },
    { id: "f1f1f1f1-0000-4000-8000-000000000002", taskId: US2, featureId: FEATURE },
  ];
  const documentLinks = [{ id: REQ_DOC_LINK, taskId: REQ, documentId: DOC }];
  let next = 100;
  const newId = () => `eeeeeeee-0000-4000-8000-000000000${next++}`;
  const statusOk = (type: unknown, status: unknown) => {
    const prefix = ({ CALMREQU: "CIPREQU", CALMUS: "CIPUS", CALMDEF: "CIPDFCT", CALMTASK: "CIPTK" } as Record<string, string>)[String(type)];
    return !prefix || String(status).startsWith(prefix);
  };
  const removeFrom = (list: { id: string }[], id: string) => {
    const at = list.findIndex((x) => x.id === id);
    if (at < 0) return false;
    list.splice(at, 1);
    return true;
  };
  const ofTask = (list: { id: string; taskId: string }[], taskId: string) =>
    list.filter((x) => x.taskId === taskId).map(({ taskId: _, ...rest }) => rest);
  const listOf = (name: string) => (name === "relations" ? relations : name === "featureAssignments" ? featureLinks : documentLinks);

  function write(method: string, path: string, body: Row, ifMatch: string | null): Response {
    const created = (row: Row) => Response.json(row, { status: 201 });
    if (method === "PATCH") {
      const row = rows.get(path);
      if (!row) return Response.json({ message: "Not Found" }, { status: 404 });
      if (path.startsWith("calm-testmanagement/")) {
        if (!ifMatch) return Response.json({ code: "428", message: "Precondition required" }, { status: 428 });
        if (ifMatch !== row["@etag"]) return Response.json({ code: "412", message: "ETag condition not met" }, { status: 412 });
      }
      if (body.status && !statusOk(row.type, body.status))
        return Response.json([{ message: `Task status ID ${body.status} is not valid for the type ID ${row.type}.` }], { status: 400 });
      if (body.statusCode === "APPROVED_FOR_DEPLOYMENT")
        return Response.json({ code: "400", message: "Status code 'APPROVED_FOR_DEPLOYMENT' can't be set via API." }, { status: 400 });
      Object.assign(row, body);
      // Cloud ALM derives a defect's sub-status from its status.
      if (body.status && !body.subStatus && row.type === "CALMDEF") row.subStatus = `DFC_${String(body.status).slice(7)}`;
      if (row["@etag"]) row["@etag"] = `W/"${Number(String(row["@etag"]).slice(3, -1)) + 1}"`;
      return Response.json(row);
    }
    if (method === "DELETE") {
      const link = /^calm-tasks\/v1\/tasks\/(relations|featureAssignments|documentAssignments)\/(.+)$/.exec(path);
      if (link)
        return removeFrom(listOf(link[1] as string), link[2] as string)
          ? new Response(null, { status: 204 })
          : Response.json([{ message: "Not found" }], { status: 404 });
      if (path.startsWith("calm-testmanagement/v1/TaskAssignments/")) return new Response(null, { status: 204 });
      const row = rows.get(path);
      if (!row) return Response.json([{ message: "Cannot find task" }], { status: 404 });
      if (row.type === "CALMREQU" && row.approvalState === "APPROVED")
        return Response.json([{ message: "Approved requirements cannot be deleted" }], { status: 400 });
      rows.delete(path);
      return new Response(null, { status: 204 });
    }
    if (path === "calm-testmanagement/v1/ManualTestCases") {
      rows.set(`${path}/${NEW_TC}`, {
        uuid: NEW_TC,
        displayId: "8-1-9",
        title: body.title,
        "@etag": 'W/"1"',
        toActivities: [{ title: "Check", sequence: 1, toActions: [{ title: "Open the order", sequence: 1 }] }],
      });
      return created({ uuid: NEW_TC, displayId: "8-1-9" });
    }
    const action = /^calm-testmanagement\/v1\/ManualTestCases\/([0-9a-f-]{36})\/api\.v1\.ExternalTestCaseServiceAPI\.forceDeletionIncludingTestRunsAndResults$/.exec(path);
    if (action) {
      if (!ifMatch) return Response.json({ code: "428", message: "Precondition required" }, { status: 428 });
      rows.delete(`calm-testmanagement/v1/ManualTestCases/${action[1]}`);
      return Response.json({ value: true });
    }
    if (path === "calm-testmanagement/v1/Activities") {
      const tc = rows.get(`calm-testmanagement/v1/ManualTestCases/${body.parent_ID}`);
      (tc?.toActivities as Row[] | undefined)?.push({ uuid: NEW_ACTIVITY, title: body.title, sequence: body.sequence, toActions: [] });
      return created({ uuid: NEW_ACTIVITY, ...body });
    }
    if (path === "calm-testmanagement/v1/Actions") return created({ uuid: newId(), ...body });
    if (path === "calm-tasks/v1/tasks/updateTags") {
      // Cloud ALM drops a tag differing only in capitals from an existing one.
      const row = rows.get(`calm-tasks/v1/tasks/${body.taskId}`);
      if (row) row.tags = (body.tags as string[]).filter((t) => t !== "old");
      return Response.json(body);
    }
    if (path === "calm-tasks/v1/tasks") {
      rows.set(`${path}/${NEW_TASK}`, { id: NEW_TASK, displayId: "3-99", ...body, tags: [] });
      return created({ id: NEW_TASK, displayId: "3-99" });
    }
    const sub = /^calm-tasks\/v1\/tasks\/([0-9a-f-]{36})\/(relations|featureAssignments|documentAssignments|comments)$/.exec(path);
    if (sub) {
      const taskId = sub[1] as string;
      const id = newId();
      if (sub[2] === "relations") relations.push({ id, taskId, type: String(body.type), relationTaskId: String(body.relationTaskId) });
      if (sub[2] === "featureAssignments") featureLinks.push({ id, taskId, featureId: String(body.featureId) });
      if (sub[2] === "documentAssignments") documentLinks.push({ id, taskId, documentId: String(body.documentId) });
      return created({ id, ...body });
    }
    if (path === "calm-features/v1/Features") {
      rows.set(`${path}/${NEW_FEATURE}`, { uuid: NEW_FEATURE, displayId: "6-9", ...body });
      return created({ uuid: NEW_FEATURE, displayId: "6-9", ...body });
    }
    if (path === "calm-documents/v1/Documents") {
      rows.set(`${path}/${NEW_DOC}`, { uuid: NEW_DOC, displayId: "7-9", ...body });
      return created({ uuid: NEW_DOC, displayId: "7-9" });
    }
    return new Response(null, { status: 201 });
  }

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\//, "");
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (method !== "GET") {
      const body = init?.body ? (JSON.parse(String(init.body)) as Row) : undefined;
      writes.push({ method, path, body, ifMatch: headers.get("if-match") });
      if (method === "POST") posts.push({ path, body });
      if ((options.forbid ?? []).some((f) => `${method} ${path}`.startsWith(f)))
        return Response.json([{ message: "Forbidden", status: 403 }], { status: 403 });
      return write(method, path, body ?? {}, headers.get("if-match"));
    }
    const row = rows.get(path);
    if (row) return Response.json(row);
    const sub = /^calm-tasks\/v1\/tasks\/([0-9a-f-]{36})\/(relations|featureAssignments|documentAssignments)$/.exec(path);
    if (sub) return Response.json(ofTask(listOf(sub[2] as string), sub[1] as string));
    if (path === "calm-processmanagement/v1/scopes") return Response.json([{ id: "bbbbbbbb-0000-4000-8000-000000000001", name: "O2C" }]);
    const body = TENANT[path];
    if (body === undefined || /\/(tasks|Features|Documents|ManualTestCases)\/[0-9a-f-]{36}$/.test(path))
      return Response.json({ message: "Not Found" }, { status: 404 });
    return Response.json(body);
  }) as typeof fetch;

  return { fetcher, posts, writes };
}
