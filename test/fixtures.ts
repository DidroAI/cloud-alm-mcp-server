/**
 * Hand-written answers in the shapes a real Cloud ALM tenant returned
 * while building this server. The values are invented: no tenant data, no real
 * names. Ids are made-up GUIDs.
 */
import type { Grant } from "../src/calm/transport.js";

export const BASE_URL = "https://eu20.alm.cloud.sap/api";
export const grant: Grant = { accessToken: "test-token", baseUrl: BASE_URL };

export const PROJECT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const SECOND_PROJECT_ID = "aaaaaaaa-0000-4000-8000-000000000002";
export const SCOPE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
export const TASK_ID = "cccccccc-0000-4000-8000-000000000001";
export const TEST_CASE_ID = "dddddddd-0000-4000-8000-000000000001";
export const TEST_PLAN_ID = "eeeeeeee-0000-4000-8000-000000000001";
export const FEATURE_ID = "ffffffff-0000-4000-8000-000000000001";
export const DOCUMENT_ID = "abababab-0000-4000-8000-000000000001";
export const REQUIREMENT_ID = "cccccccc-0000-4000-8000-000000000099";
export const PROCESS_ID = "ERL-00000000000000000000000000000001";

export const projects = [
  {
    id: PROJECT_ID,
    name: "Rollout Example",
    status: "O",
    purpose: "IMPLEMENTATION",
    operationalStatus: "ONTRK",
    phaseId: "12121212-0000-4000-8000-000000000001",
    deploymentPlanId: null,
    programId: null,
    etag: "1700000000000",
  },
];

export const timeboxes = [
  {
    id: "13131313-0000-4000-8000-000000000001",
    name: "Explore",
    type: 1,
    startDate: "2026-01-01",
    endDate: "2026-02-28",
    closed: false,
    predefined: true,
  },
];
export const teams = [
  {
    id: "14141414-0000-4000-8000-000000000001",
    name: "Core Team",
    description: "",
    isDefault: true,
  },
];

const customFields = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [`customField${i + 1}`, null]),
);

export function task(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    title: "Credit memo uses the wrong tax code",
    type: "CALMDEF",
    status: "CIPDFCTOPEN",
    source: "MANUAL",
    externalIntegration: null,
    externalId: null,
    startDate: "2026-03-01",
    dueDate: null,
    priorityId: 20,
    assigneeId: null,
    assigneeName: "Alex Example",
    parentId: null,
    subStatus: "DFC_NEW",
    approvalState: null,
    scopeId: SCOPE_ID,
    scopeName: "Order to Cash",
    timeboxId: "13131313-0000-4000-8000-000000000001",
    obsolete: false,
    createdTimestamp: "2026-03-01T09:00:00.000000000Z",
    lastChangedTimestamp: "2026-03-02T10:00:00.000000000Z",
    displayId: "3-12",
    tags: ["uat"],
    ...customFields,
    ...overrides,
  };
}

export const taskDetail = task({
  description:
    "<p>Found in UAT cycle 1.</p><ul><li>Create a return</li><li>Bill it</li></ul><p>Tax &amp; totals differ.</p>",
  timeboxName: "Explore",
  externalReferences: [{ name: "Ticket", url: "https://example.com/t/1" }],
});

export const manualTestCases = (count: number) => ({
  "@context": "$metadata#ManualTestCases",
  "@metadataEtag": 'W/"x"',
  "@count": count,
  value: Array.from({ length: count }, (_, i) => ({
    "@etag": 'W/"x"',
    uuid:
      i === 0
        ? TEST_CASE_ID
        : `dddddddd-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    title: `O2C-${String(i + 1).padStart(2, "0")} Example case`,
    isPrepared: true,
    projectId: PROJECT_ID,
    scopeId: SCOPE_ID,
    solutionProcessId: null,
    solutionProcessFlowId: null,
    solutionProcessFlowDiagramId: null,
    contentPackageId: null,
    priorityCode: 30,
    sourceName: null,
    externalId: null,
    modifiedAt: "2026-03-01T10:00:00.000000000Z",
    displayId: `8-1-${i + 1}`,
  })),
});

export const testCaseExpanded = {
  ...manualTestCases(1).value[0],
  toTaskAssignments: [
    {
      uuid: "17171717-0000-4000-8000-000000000001",
      parentTestCase_ID: TEST_CASE_ID,
      taskId: TASK_ID,
      taskDisplayId: "3-12",
      type: "CALMDEF",
    },
  ],
  toTagAssignments: [
    { label: "Wave 1", groupLabel: "Release", parentTestCase_ID: TEST_CASE_ID },
    { label: "Pricing", groupLabel: null, parentTestCase_ID: TEST_CASE_ID },
  ],
  toActivities: [
    {
      uuid: "15151515-0000-4000-8000-000000000002",
      title: "Bill",
      sequence: 2,
      isInScope: true,
      isFromContentRepository: false,
      parent_ID: TEST_CASE_ID,
      toActions: [
        {
          uuid: "16161616-0000-4000-8000-000000000002",
          title: "Create the invoice",
          description: "",
          expectedResult: "Invoice posted",
          sequence: 1,
          isEvidenceRequired: false,
        },
      ],
    },
    {
      uuid: "15151515-0000-4000-8000-000000000001",
      title: "Create order",
      sequence: 1,
      isInScope: true,
      isFromContentRepository: false,
      parent_ID: TEST_CASE_ID,
      toActions: [
        {
          uuid: "16161616-0000-4000-8000-000000000001",
          title: "Enter the order",
          description: "Customer 1000, material M-01",
          expectedResult: "Order saved",
          sequence: 1,
          isEvidenceRequired: true,
        },
      ],
    },
  ],
};

/** The link reads of `getTask` for TASK_ID, in the shapes seen live (X-249). */
export const taskLinkRoutes = () => ({
  [`calm-tasks/v1/tasks/${TASK_ID}/relations`]: [
    {
      id: "18181818-0000-4000-8000-000000000001",
      type: "10",
      relationTaskId: REQUIREMENT_ID,
    },
  ],
  [`calm-tasks/v1/tasks/${TASK_ID}/featureAssignments`]: [
    {
      id: "19191919-0000-4000-8000-000000000001",
      taskId: TASK_ID,
      taskType: "CALMDEF",
      taskTitle: "Credit memo uses the wrong tax code",
      featureId: FEATURE_ID,
    },
  ],
  "calm-tasks/v1/tasks/solutionProcessAssignments": [
    {
      relationId: "20202020-0000-4000-8000-000000000001",
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      scopeId: SCOPE_ID,
      solutionScenarioVersionId: "21212121-0000-4000-8000-000000000001",
      solutionProcessId: PROCESS_ID,
    },
  ],
  "calm-testmanagement/v1/ManualTestCases": manualTestCases(1),
  "calm-testmanagement/v1/AutomatedTestCases": {
    "@context": "$metadata#AutomatedTestCases",
    value: [],
  },
});

export const testPlanExpanded = {
  "@context": "$metadata#TestPlans(toTestCaseAssignments())/$entity",
  uuid: TEST_PLAN_ID,
  displayId: "8-3-1",
  title: "UAT cycle 1",
  projectId: PROJECT_ID,
  statusCode: 20,
  responsibleId: null,
  startDate: "2026-04-01",
  endDate: "2026-04-15",
  description: "First cycle.",
  isSequenceActive: false,
  modifiedAt: "2026-03-30T10:00:00Z",
  toTestCaseAssignments: [
    {
      uuid: "17171717-0000-4000-8000-000000000001",
      testPlanId: TEST_PLAN_ID,
      testCaseId: TEST_CASE_ID,
      testCaseDisplayId: "8-1-1",
      testCaseTitle: "O2C-01 Example case",
      testCaseType: "MANUAL",
      testerId: null,
      sequence: null,
    },
  ],
};

export const solutionProcesses = {
  value: [
    {
      scopeId: SCOPE_ID,
      solutionScenarioVersionId: "18181818-0000-4000-8000-000000000001",
      solutionScenarioId: "EARL_SolS-001",
      solutionProcessId: "ERL-0001",
      solutionProcessVersionId: "19191919-0000-4000-8000-000000000001",
      solutionProcessVersionName: "Lead to Cash for Cloud Deployment",
      projectId: PROJECT_ID,
      projectName: "Rollout Example",
      statusId: null,
      statusName: "Design",
      countries: ["DE", "FR"],
      isScoped: true,
    },
  ],
};

export const landscapeObjects = [
  {
    lmsId: "20202020-0000-4000-8000-000000000001",
    name: "Example S/4HANA Cloud",
    description: "",
    objectType: "CloudService",
    source: "SAP",
    systemNumber: "000000001",
    systemType: "",
    installationNumber: "",
    role: "PROD",
    mainUrl: "",
    logonUrl: "",
    location: "",
    customerNumber: "",
    customerName: "",
    externalId: "",
    serviceType: "S4_PC",
    serviceTypeLabel: "SAP S/4HANA Cloud Public Edition",
    identifier: "",
    deploymentModel: "SAP Public Cloud",
    lifecycleStatus: 0,
  },
];

export const emptyOData = (context: string) => ({
  "@context": `$metadata#${context}`,
  "@count": 0,
  value: [],
});

export const statusEvents = [
  {
    eventId: "21212121-0000-4000-8000-000000000001",
    eventName: "EVB00000001",
    eventDescription: "",
    eventType: "Communication",
    eventSource: "SAP",
    eventStartTime: "2026-03-01T10:00:00Z",
    eventEndTime: "2026-03-01T10:00:00Z",
    eventDuration: 0,
    eventStatus: "Closed",
    serviceName: "21212121-0000-4000-8000-000000000002",
    serviceDescription: "21212121-0000-4000-8000-000000000002",
    serviceId: "21212121-0000-4000-8000-000000000003",
    systemNumber: "000000001",
    serviceType: "foundational services for SAP BTP",
    type: "CloudService",
  },
];

export type Recorded = { url: URL; init: RequestInit | undefined };
export type Route = (url: URL) => Response | Promise<Response> | undefined;

export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/**
 * A fake `fetch` that answers from routes keyed by path (after `/api/`), and
 * records every request. Unknown paths answer 404 like Cloud ALM's gateway.
 */
export function fakeFetch(routes: Record<string, unknown | Route>) {
  const calls: Recorded[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const path = url.pathname.replace(/^\/api\//, "");
    const route = routes[path];
    if (route === undefined)
      return json({ message: "Not Found", status: 404 }, 404);
    if (typeof route === "function") {
      const answer = await (route as Route)(url);
      return answer ?? json({ message: "Not Found" }, 404);
    }
    return json(route);
  }) as typeof fetch;
  return { fetch: fetcher, calls };
}
