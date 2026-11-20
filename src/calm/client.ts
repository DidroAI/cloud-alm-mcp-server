import { CloudAlmError } from "./errors.js";
import {
  type AnalyticsProvider,
  type AnalyticsResult,
  type CoverageRow,
  type DocumentDetail,
  type DocumentSummary,
  type Feature,
  type FeatureDetail,
  type HierarchyNode,
  type LandscapeObject,
  LIBRARY_KINDS,
  type LibraryItem,
  type LibraryKind,
  type LinkedTestCase,
  type Page,
  type PageInput,
  type Project,
  type ProjectDetail,
  type Scope,
  type SolutionProcess,
  type StatusEvent,
  TASK_TYPES,
  type Task,
  type TaskComment,
  type TaskLinks,
  type TaskSummary,
  type TaskTypeCode,
  type TestCase,
  type TestCaseDetail,
  type TestCaseKind,
  type TestCoverage,
  type TestPlan,
  type TestPlanDetail,
} from "./model.js";
import {
  type CloudAlmOptions,
  type GrantSource,
  type Query,
  type Session,
  withSession,
} from "./transport.js";
import {
  bool,
  countOf,
  guid,
  num,
  plainText,
  type Row,
  rowOf,
  rowsOf,
  str,
  strings,
} from "./values.js";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
const MAX_OFFSET = 5_000;
/** Projects a cross-project task read will walk before asking for one. */
const MAX_PROJECTS_SCANNED = 10;
/** Tasks scanned per project when matching words in titles. */
const MAX_TASKS_SCANNED = 500;
const MAX_COMMENTS = 20;
/** Rows read per list in a coverage view (tasks per type, test cases per kind). */
const MAX_COVERAGE_ROWS = 500;

/** Service paths. Casing differs per service, as Cloud ALM serves them. */
export const PATHS = {
  projects: "calm-projects/v1/projects",
  tasks: "calm-tasks/v1/tasks",
  features: "calm-features/v1/Features",
  documents: "calm-documents/v1/Documents",
  manualTestCases: "calm-testmanagement/v1/ManualTestCases",
  automatedTestCases: "calm-testmanagement/v1/AutomatedTestCases",
  testPlans: "calm-testmanagement-testplans/v1/TestPlans",
  scopes: "calm-processmanagement/v1/scopes",
  solutionProcesses: "calm-processmanagement/v1/solutionProcesses",
  hierarchyNodes: "calm-processhierarchy/v1/HierarchyNodes",
  landscape: "calm-landscape/v1/landscapeObjects",
  analyticsProviders: "calm-analytics/v1/analytics/providers",
  analytics: "calm-analytics/v1/odata/v4/analytics",
  statusEvents: "bsm-service/v1/events",
} as const;

const LIBRARY: Record<LibraryKind, { path: string; prefix: string }> = {
  applications: {
    path: "calm-crosslibraryapplications/v1/Applications",
    prefix: "application",
  },
  developments: {
    path: "calm-crosslibrarydevelopments/v1/Developments",
    prefix: "development",
  },
  interfaces: {
    path: "calm-crosslibraryinterfaces/v1/Interfaces",
    prefix: "interface",
  },
  configurations: {
    path: "calm-crosslibraryconfigurations/v1/Configurations",
    prefix: "configuration",
  },
};

/** OData entity sets of the analytics service (one per data provider). */
export const ANALYTICS_DATASETS = [
  "Projects",
  "Tasks",
  "Requirements",
  "Defects",
  "Tests",
  "Features",
  "ConfigurationItems",
  "QualityGates",
  "StatusEvents",
  "Exceptions",
  "Jobs",
  "Metrics",
  "Requests",
  "ServiceLevels",
  "ScenarioExecutions",
  "MonitoringEvents",
  "Messages",
] as const;
export type AnalyticsDataset = (typeof ANALYTICS_DATASETS)[number];
const ANALYTICS_TECHNICAL = new Set([
  "firstWeekDay",
  "timeZone",
  "timestamp",
  "timestampFormat",
  "week",
  "dayOfWeek",
  "period",
  "resolution",
]);
const MAX_ANALYTICS_COLUMNS = 40;

function page(input: PageInput = {}) {
  const limit = Math.trunc(input.limit ?? DEFAULT_LIMIT);
  const offset = Math.trunc(input.offset ?? 0);
  if (!(limit >= 1 && limit <= MAX_LIMIT))
    throw new CloudAlmError("bad_request", `limit must be 1 to ${MAX_LIMIT}`);
  if (!(offset >= 0 && offset <= MAX_OFFSET))
    throw new CloudAlmError("bad_request", `offset must be 0 to ${MAX_OFFSET}`);
  return { limit, offset };
}

/** Build a page from rows fetched with one extra row to detect a next page. */
function toPage<T>(
  rows: T[],
  { limit, offset }: { limit: number; offset: number },
  total: number | null = null,
): Page<T> {
  return {
    items: rows.slice(0, limit),
    offset,
    limit,
    nextOffset: rows.length > limit ? offset + limit : null,
    total,
  };
}

/** `projectId eq <guid>`: GUIDs go unquoted, or Cloud ALM answers 400. */
function projectFilter(projectId?: string): Query {
  return projectId
    ? { $filter: `projectId eq ${guid(projectId, "projectId")}` }
    : {};
}

async function odataPage(
  session: Session,
  path: string,
  input: PageInput | undefined,
  query: Query = {},
): Promise<Page<Row>> {
  const paging = page(input);
  const body = await session.get(path, {
    ...query,
    $top: paging.limit + 1,
    $skip: paging.offset || undefined,
    $count: true,
  });
  return toPage(rowsOf(body), paging, countOf(body));
}

/** Map a type name ("defect", "user story") or code to the code. */
export function taskTypeCode(type: string): TaskTypeCode {
  const wanted = type.trim().toLowerCase().replace(/[_-]+/g, " ");
  for (const [code, name] of Object.entries(TASK_TYPES))
    if (code.toLowerCase() === wanted || name === wanted)
      return code as TaskTypeCode;
  if (wanted === "user stories" || wanted === "story") return "CALMUS";
  if (wanted === "requirements") return "CALMREQU";
  if (wanted === "defects" || wanted === "bug") return "CALMDEF";
  throw new CloudAlmError(
    "bad_request",
    `unknown task type ${type.slice(0, 40)}; use one of ${Object.keys(TASK_TYPES).join(", ")}`,
  );
}

// ---- Normalisers: Cloud ALM rows to this library's shapes ----

export const project = (row: Row): Project => ({
  id: str(row.id) ?? "",
  name: str(row.name),
  status: str(row.status),
  purpose: str(row.purpose),
  operationalStatus: str(row.operationalStatus),
  programId: str(row.programId),
  phaseId: str(row.phaseId),
});

export const taskSummary = (row: Row): TaskSummary => {
  const type = str(row.type);
  return {
    id: str(row.id) ?? "",
    displayId: str(row.displayId),
    projectId: str(row.projectId),
    title: str(row.title),
    type,
    typeName: type ? (TASK_TYPES[type as TaskTypeCode] ?? null) : null,
    status: str(row.status),
    subStatus: str(row.subStatus),
    classification: str(row.classificationId),
    approvalState: str(row.approvalState),
    priority: num(row.priorityId),
    assigneeName: str(row.assigneeName),
    scopeName: str(row.scopeName),
    scopeId: str(row.scopeId),
    dueDate: str(row.dueDate),
    tags: strings(row.tags),
    changedAt: str(row.lastChangedTimestamp),
    createdAt: str(row.createdTimestamp),
  };
};

/** Comment fields are taken from several names: no comment was seen live. */
const comment = (row: Row): TaskComment => ({
  author: str(row.createdByName ?? row.authorName ?? row.createdBy),
  createdAt: str(row.createdAt ?? row.createdTimestamp ?? row.timestamp),
  text: plainText(row.content ?? row.text ?? row.comment, 2000),
});

export const feature = (row: Row): Feature => ({
  id: str(row.uuid) ?? "",
  displayId: str(row.displayId),
  title: str(row.title),
  projectId: str(row.projectId),
  statusCode: str(row.statusCode),
  priorityCode: num(row.priorityCode),
  type: str(row.type),
  releaseId: str(row.releaseId),
  modifiedAt: str(row.modifiedAt),
  tags: strings(row.tags),
});

export const documentSummary = (row: Row): DocumentSummary => ({
  id: str(row.uuid) ?? "",
  displayId: str(row.displayId),
  title: str(row.title),
  projectId: str(row.projectId),
  documentTypeCode: str(row.documentTypeCode),
  statusCode: num(row.statusCode),
  isTemplate: bool(row.isTemplate),
  version: num(row.version),
  modifiedAt: str(row.modifiedAt),
});
const DOCUMENT_FIELDS =
  "uuid,displayId,title,projectId,documentTypeCode,statusCode,isTemplate,version,modifiedAt";

export const testCase = (row: Row, kind: TestCaseKind): TestCase => ({
  id: str(row.uuid) ?? "",
  displayId: str(row.displayId),
  title: str(row.title),
  kind,
  projectId: str(row.projectId),
  scopeId: str(row.scopeId),
  solutionProcessId: str(row.solutionProcessId),
  priorityCode: num(row.priorityCode),
  isPrepared: bool(row.isPrepared),
  modifiedAt: str(row.modifiedAt),
});

export const linkedTestCase = (row: Row, kind: TestCaseKind): LinkedTestCase => ({
  id: str(row.uuid) ?? "",
  displayId: str(row.displayId),
  title: str(row.title),
  kind,
});

export const typeName = (type: string | null) =>
  type ? (TASK_TYPES[type as TaskTypeCode] ?? null) : null;

/** OData filter for test cases linked to one task. */
const coversTask = (taskId: string) =>
  `toTaskAssignments/any(a:a/taskId eq ${taskId})`;

/**
 * Read the links of one task, each from the service that owns it. A link
 * the key has no scope for is named in `unavailable`; other errors throw.
 */
async function taskLinks(
  s: Session,
  taskId: string,
  projectId: string | null,
): Promise<TaskLinks> {
  const unavailable = new Set<string>();
  const soft = async (name: string, read: () => Promise<Row[]>) => {
    try {
      return await read();
    } catch (error) {
      if (error instanceof CloudAlmError && error.code === "forbidden") {
        unavailable.add(name);
        return [];
      }
      throw error;
    }
  };
  const testCases = (kind: TestCaseKind) =>
    soft("testCases", async () =>
      rowsOf(
        await s.get(
          kind === "manual" ? PATHS.manualTestCases : PATHS.automatedTestCases,
          {
            $filter: coversTask(taskId),
            $select: "uuid,displayId,title",
            $top: MAX_LIMIT,
          },
        ),
      ),
    );
  const [relations, features, processes, manual, automated] = await Promise.all(
    [
      soft("requirement", async () =>
        rowsOf(await s.get(`${PATHS.tasks}/${taskId}/relations`)),
      ),
      soft("features", async () =>
        rowsOf(await s.get(`${PATHS.tasks}/${taskId}/featureAssignments`)),
      ),
      projectId
        ? soft("solutionProcesses", async () =>
            rowsOf(
              await s.get(`${PATHS.tasks}/solutionProcessAssignments`, {
                projectId: guid(projectId, "projectId"),
                taskId,
              }),
            ),
          )
        : Promise.resolve([] as Row[]),
      testCases("manual"),
      testCases("automated"),
    ],
  );
  const ids = (rows: Row[], field: string) => [
    ...new Set(rows.map((r) => str(r[field])).filter((v): v is string => !!v)),
  ];
  return {
    requirementId:
      str(relations.find((r) => String(r.type) === "10")?.relationTaskId) ??
      null,
    testCases: [
      ...manual.map((r) => linkedTestCase(r, "manual")),
      ...automated.map((r) => linkedTestCase(r, "automated")),
    ].slice(0, MAX_LIMIT),
    featureIds: ids(features, "featureId").slice(0, MAX_LIMIT),
    solutionProcessIds: ids(processes, "solutionProcessId").slice(0, MAX_LIMIT),
    unavailable: [...unavailable],
  };
}

const bySequence = (a: Row, b: Row) =>
  (num(a.sequence) ?? Number.MAX_SAFE_INTEGER) -
  (num(b.sequence) ?? Number.MAX_SAFE_INTEGER);

export const testPlan = (row: Row): TestPlan => ({
  id: str(row.uuid) ?? "",
  displayId: str(row.displayId),
  title: str(row.title),
  projectId: str(row.projectId),
  statusCode: num(row.statusCode),
  startDate: str(row.startDate),
  endDate: str(row.endDate),
  modifiedAt: str(row.modifiedAt),
});

const scope = (row: Row): Scope => ({
  id: str(row.id) ?? "",
  projectId: str(row.projectId),
  name: str(row.name),
  description: plainText(row.description, 500),
});

export const solutionProcess = (row: Row): SolutionProcess => ({
  id: str(row.solutionProcessId) ?? "",
  versionId: str(row.solutionProcessVersionId),
  name: str(row.solutionProcessVersionName),
  scenarioId: str(row.solutionScenarioId),
  scopeId: str(row.scopeId),
  projectId: str(row.projectId),
  status: str(row.statusName),
  isScoped: bool(row.isScoped),
  countryCount: Array.isArray(row.countries) ? row.countries.length : 0,
});

const hierarchyNode = (row: Row): HierarchyNode => ({
  id: str(row.uuid) ?? "",
  displayId: str(row.displayId),
  title: str(row.title),
  description: plainText(row.description, 500),
  parentId: str(row.parentNodeUUID ?? row.parentNodeUuid ?? row.parent_uuid),
  sequence: num(row.sequence),
});

const landscapeObject = (row: Row): LandscapeObject => ({
  id: str(row.lmsId) ?? "",
  name: str(row.name),
  description: str(row.description, 500),
  objectType: str(row.objectType),
  systemNumber: str(row.systemNumber),
  systemType: str(row.systemType),
  role: str(row.role),
  serviceType: str(row.serviceTypeLabel) ?? str(row.serviceType),
  deploymentModel: str(row.deploymentModel),
  externalId: str(row.externalId),
  source: str(row.source),
});

const libraryItem = (row: Row, kind: LibraryKind): LibraryItem => {
  const p = LIBRARY[kind].prefix;
  const sender =
    str(row.sendingSolutionComponentName) ?? str(row.sendingSystemGroupName);
  const receiver =
    str(row.receivingSolutionComponentName) ??
    str(row.receivingSystemGroupName);
  return {
    kind,
    id: str(row.uuid) ?? "",
    displayId: str(row.displayId),
    title: str(row.title),
    description: plainText(row.description, 500),
    typeCode: str(row[`${p}TypeCode`]),
    objectId: str(row[`${p}Id`]) ?? str(row.packageName),
    systemGroupName: str(row.systemGroupName),
    solutionComponentName: str(row.solutionComponentName),
    readinessCode: str(row[`${p}ReadinessCode`]),
    priorityCode: str(row[`${p}PriorityCode`]),
    modifiedAt: str(row.modifiedAt),
    sender,
    receiver,
  };
};

const statusEvent = (row: Row): StatusEvent => ({
  id: str(row.eventId) ?? "",
  name: str(row.eventName),
  description: str(row.eventDescription, 500),
  type: str(row.eventType),
  status: str(row.eventStatus),
  source: str(row.eventSource),
  startTime: str(row.eventStartTime),
  endTime: str(row.eventEndTime),
  serviceName: str(row.serviceDescription) ?? str(row.serviceName),
  serviceType: str(row.serviceType),
  systemNumber: str(row.systemNumber),
});

export type TaskSearch = PageInput & {
  /** Omitted: every project, up to 10 of them. */
  projectId?: string;
  /** A code (`CALMREQU`) or a name ("requirement", "user story", "defect"). */
  type?: string;
  /** Cloud ALM status code, e.g. `CIPDFCTOPEN`. */
  status?: string;
  /** Words that must all appear in the title (matched here, not by Cloud ALM). */
  query?: string;
};

/**
 * Read-only access to one SAP Cloud ALM tenant. Every method resolves the
 * grant once, makes a bounded number of GET requests and returns plain,
 * bounded data, or throws a `CloudAlmError`.
 */
export class CloudAlm {
  constructor(
    private readonly grant: GrantSource,
    private readonly options: CloudAlmOptions = {},
  ) {}

  private run<T>(operation: (session: Session) => Promise<T>): Promise<T> {
    return withSession(this.grant, this.options, operation);
  }

  /**
   * Several GETs in one operation (one request budget, one deadline), for
   * views built on this client (`views.ts`). Paths come from `PATHS`.
   * @internal
   */
  operation<T>(read: (session: Session) => Promise<T>): Promise<T> {
    return this.run(read);
  }

  // ---- Projects ----

  async listProjects(): Promise<Project[]> {
    return this.run(async (s) =>
      rowsOf(await s.get(PATHS.projects)).map(project),
    );
  }

  async getProject(id: string): Promise<ProjectDetail> {
    const projectId = guid(id, "project id");
    return this.run(async (s) => {
      const base = `${PATHS.projects}/${projectId}`;
      const [main, timeboxes, teams] = await Promise.all([
        s.get(base),
        s.get(`${base}/timeboxes`),
        s.get(`${base}/teams`),
      ]);
      return {
        ...project(rowOf(main)),
        timeboxes: rowsOf(timeboxes)
          .slice(0, MAX_LIMIT)
          .map((row) => ({
            id: str(row.id) ?? "",
            name: str(row.name),
            startDate: str(row.startDate),
            endDate: str(row.endDate),
            closed: bool(row.closed),
          })),
        teams: rowsOf(teams)
          .slice(0, MAX_LIMIT)
          .map((row) => ({
            id: str(row.id) ?? "",
            name: str(row.name),
            description: str(row.description, 500),
          })),
      };
    });
  }

  // ---- Tasks (requirements, user stories, defects, …) ----

  /**
   * Tasks of a project. Cloud ALM requires a project; without one, this
   * reads every project (up to 10) and merges the results.
   */
  async listTasks(search: TaskSearch = {}): Promise<Page<TaskSummary>> {
    const paging = page(search);
    const type = search.type ? taskTypeCode(search.type) : undefined;
    const status = search.status?.trim();
    if (status && !/^[A-Za-z0-9_]{1,40}$/.test(status))
      throw new CloudAlmError("bad_request", "status must be a status code");
    const words = (search.query ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 10);
    return this.run(async (s) => {
      let projectIds: string[];
      if (search.projectId) projectIds = [guid(search.projectId, "projectId")];
      else {
        const all = rowsOf(await s.get(PATHS.projects)).map(project);
        if (all.length > MAX_PROJECTS_SCANNED)
          throw new CloudAlmError(
            "bad_request",
            `the tenant has ${all.length} projects; give a projectId`,
          );
        projectIds = all.map((p) => p.id).filter(Boolean);
      }
      // Over one project, Cloud ALM pages for us; otherwise each project is
      // read up to the end of the wanted page, and the merge is sliced here.
      const single = projectIds.length === 1 && !words.length;
      const fetchLimit = words.length
        ? MAX_TASKS_SCANNED
        : single
          ? paging.limit + 1
          : Math.min(paging.offset + paging.limit + 1, MAX_TASKS_SCANNED);
      const rows: Row[] = [];
      for (const projectId of projectIds) {
        rows.push(
          ...rowsOf(
            await s.get(PATHS.tasks, {
              projectId,
              type,
              status,
              limit: fetchLimit,
              offset: single ? paging.offset || undefined : undefined,
            }),
          ),
        );
      }
      let tasks = rows.map(taskSummary);
      if (words.length)
        tasks = tasks.filter((task) => {
          const title = (task.title ?? "").toLowerCase();
          return words.every((word) => title.includes(word));
        });
      if (single) return toPage(tasks, paging);
      return toPage(tasks.slice(paging.offset), paging);
    });
  }

  /**
   * One task with its description, external references, comments and links
   * (requirement, test cases, features, solution processes).
   */
  async getTask(
    id: string,
    options: { comments?: boolean; links?: boolean } = {},
  ): Promise<Task> {
    const taskId = guid(id, "task id");
    return this.run(async (s) => {
      // The task and its comments are independent: read them at once.
      const [body, comments] = await Promise.all([
        s.get(`${PATHS.tasks}/${taskId}`),
        options.comments === false
          ? Promise.resolve([] as TaskComment[])
          : s
              .get(`${PATHS.tasks}/${taskId}/comments`)
              .then((c) => rowsOf(c).slice(-MAX_COMMENTS).map(comment))
              .catch((error: unknown) => {
                // A token without the comments' scope still gets the task.
                if (!(error instanceof CloudAlmError) || error.code !== "forbidden")
                  throw error;
                return [] as TaskComment[];
              }),
      ]);
      const row = rowOf(body);
      const links =
        options.links === false
          ? null
          : await taskLinks(s, taskId, str(row.projectId));
      const references = Array.isArray(row.externalReferences)
        ? (row.externalReferences as unknown[])
        : [];
      return {
        ...taskSummary(row),
        description: plainText(row.description),
        parentId: str(row.parentId),
        timeboxName: str(row.timeboxName),
        createdAt: str(row.createdTimestamp),
        externalReferences: references
          .filter((r): r is Row => !!r && typeof r === "object")
          .slice(0, 20)
          .map((r) => ({ name: str(r.name), url: str(r.url, 1000) })),
        comments,
        links,
      };
    });
  }

  // ---- Features ----

  async listFeatures(
    input: PageInput & { projectId?: string } = {},
  ): Promise<Page<Feature>> {
    return this.run(async (s) => {
      const result = await odataPage(
        s,
        PATHS.features,
        input,
        projectFilter(input.projectId),
      );
      return { ...result, items: result.items.map(feature) };
    });
  }

  async getFeature(id: string): Promise<FeatureDetail> {
    const featureId = guid(id, "feature id");
    return this.run(async (s) => {
      const row = rowOf(
        await s.get(`${PATHS.features}/${featureId}`, {
          $expand: "toTransports",
        }),
      );
      const transports = Array.isArray(row.toTransports)
        ? (row.toTransports as Row[])
        : [];
      return {
        ...feature(row),
        description: plainText(row.description),
        transports: transports
          .map((t) => str(t?.id))
          .filter((t): t is string => !!t)
          .slice(0, 100),
      };
    });
  }

  // ---- Documents ----

  async listDocuments(
    input: PageInput & { projectId?: string } = {},
  ): Promise<Page<DocumentSummary>> {
    return this.run(async (s) => {
      const result = await odataPage(s, PATHS.documents, input, {
        ...projectFilter(input.projectId),
        $select: DOCUMENT_FIELDS,
      });
      return { ...result, items: result.items.map(documentSummary) };
    });
  }

  async getDocument(id: string): Promise<DocumentDetail> {
    const documentId = guid(id, "document id");
    return this.run(async (s) => {
      const row = rowOf(
        await s.get(`${PATHS.documents}/${documentId}`, {
          $select: `${DOCUMENT_FIELDS},content`,
        }),
      );
      return { ...documentSummary(row), content: plainText(row.content, 8000) };
    });
  }

  // ---- Tests ----

  async listTestCases(
    input: PageInput & { projectId?: string; kind?: TestCaseKind } = {},
  ): Promise<Page<TestCase>> {
    const kind = input.kind ?? "manual";
    return this.run(async (s) => {
      const result = await odataPage(
        s,
        kind === "manual" ? PATHS.manualTestCases : PATHS.automatedTestCases,
        input,
        projectFilter(input.projectId),
      );
      return { ...result, items: result.items.map((r) => testCase(r, kind)) };
    });
  }

  /**
   * A manual test case with its activities and their actions (steps), the
   * tasks it covers and its tags.
   */
  async getTestCase(id: string): Promise<TestCaseDetail> {
    const testCaseId = guid(id, "test case id");
    return this.run(async (s) => {
      const row = rowOf(
        await s.get(`${PATHS.manualTestCases}/${testCaseId}`, {
          $expand:
            "toActivities($expand=toActions),toTaskAssignments,toTagAssignments",
        }),
      );
      const rowList = (value: unknown) =>
        Array.isArray(value)
          ? (value as unknown[]).filter(
              (r): r is Row => !!r && typeof r === "object",
            )
          : [];
      const activities = Array.isArray(row.toActivities)
        ? (row.toActivities as Row[])
        : [];
      return {
        ...testCase(row, "manual"),
        activities: [...activities]
          .sort(bySequence)
          .slice(0, 100)
          .map((activity) => ({
            title: str(activity.title),
            inScope: bool(activity.isInScope),
            actions: (Array.isArray(activity.toActions)
              ? [...(activity.toActions as Row[])]
              : []
            )
              .sort(bySequence)
              .slice(0, 100)
              .map((action) => ({
                title: str(action.title),
                description: plainText(action.description, 1000),
                expectedResult: plainText(action.expectedResult, 1000),
                evidenceRequired: bool(action.isEvidenceRequired),
              })),
          })),
        tasks: rowList(row.toTaskAssignments)
          .slice(0, MAX_LIMIT)
          .map((a) => ({
            taskId: str(a.taskId) ?? "",
            displayId: str(a.taskDisplayId),
            type: str(a.type),
            typeName: typeName(str(a.type)),
          })),
        tags: rowList(row.toTagAssignments)
          .slice(0, MAX_LIMIT)
          .map((t) => ({ label: str(t.label) ?? "", group: str(t.groupLabel) }))
          .filter((t) => t.label),
      };
    });
  }

  /**
   * Which tasks of a project (requirements and user stories by default) have
   * a test case linked to them, which have none, and which test cases are
   * linked to no task. Direct links only: a requirement whose user stories
   * are tested but which has no test case itself counts as uncovered.
   */
  async testCoverage(input: {
    projectId: string;
    types?: string[];
  }): Promise<TestCoverage> {
    const projectId = guid(input.projectId, "projectId");
    const types = [
      ...new Set(
        (input.types?.length ? input.types : ["CALMREQU", "CALMUS"]).map(
          taskTypeCode,
        ),
      ),
    ].slice(0, 9);
    return this.run(async (s) => {
      let truncated = false;
      const tasks: TaskSummary[] = [];
      for (const type of types) {
        const rows = rowsOf(
          await s.get(PATHS.tasks, {
            projectId,
            type,
            limit: MAX_COVERAGE_ROWS,
          }),
        );
        if (rows.length >= MAX_COVERAGE_ROWS) truncated = true;
        tasks.push(...rows.map(taskSummary));
      }
      const byTask = new Map<string, LinkedTestCase[]>();
      const unlinked: LinkedTestCase[] = [];
      let testCaseCount = 0;
      for (const kind of ["manual", "automated"] as const) {
        const rows = rowsOf(
          await s.get(
            kind === "manual"
              ? PATHS.manualTestCases
              : PATHS.automatedTestCases,
            {
              ...projectFilter(projectId),
              $select: "uuid,displayId,title",
              $expand: "toTaskAssignments",
              $top: MAX_COVERAGE_ROWS,
            },
          ),
        );
        if (rows.length >= MAX_COVERAGE_ROWS) truncated = true;
        testCaseCount += rows.length;
        for (const row of rows) {
          const linked = linkedTestCase(row, kind);
          const assignments = Array.isArray(row.toTaskAssignments)
            ? (row.toTaskAssignments as Row[])
            : [];
          const taskIds = assignments
            .map((a) => str(a?.taskId))
            .filter((t): t is string => !!t);
          if (!taskIds.length) unlinked.push(linked);
          for (const taskId of taskIds) {
            const list = byTask.get(taskId) ?? [];
            list.push(linked);
            byTask.set(taskId, list);
          }
        }
      }
      const rows: CoverageRow[] = tasks.map((task) => ({
        task,
        testCases: byTask.get(task.id) ?? [],
      }));
      const covered = rows.filter((r) => r.testCases.length).length;
      return {
        projectId,
        types,
        rows,
        covered,
        uncovered: rows.length - covered,
        testCaseCount,
        unlinkedTestCases: unlinked,
        truncated,
      };
    });
  }

  async listTestPlans(
    input: PageInput & { projectId?: string } = {},
  ): Promise<Page<TestPlan>> {
    return this.run(async (s) => {
      const result = await odataPage(
        s,
        PATHS.testPlans,
        input,
        projectFilter(input.projectId),
      );
      return { ...result, items: result.items.map(testPlan) };
    });
  }

  async getTestPlan(id: string): Promise<TestPlanDetail> {
    const planId = guid(id, "test plan id");
    return this.run(async (s) => {
      const row = rowOf(
        await s.get(`${PATHS.testPlans}/${planId}`, {
          $expand: "toTestCaseAssignments",
        }),
      );
      const assignments = Array.isArray(row.toTestCaseAssignments)
        ? [...(row.toTestCaseAssignments as Row[])]
        : [];
      return {
        ...testPlan(row),
        description: plainText(row.description, 2000),
        testCases: assignments
          .sort(bySequence)
          .slice(0, MAX_LIMIT)
          .map((a) => ({
            testCaseId: str(a.testCaseId),
            displayId: str(a.testCaseDisplayId),
            title: str(a.testCaseTitle),
            type: str(a.testCaseType),
          })),
      };
    });
  }

  // ---- Processes ----

  async listScopes(input: { projectId?: string } = {}): Promise<Scope[]> {
    const projectId = input.projectId
      ? guid(input.projectId, "projectId")
      : undefined;
    return this.run(async (s) =>
      rowsOf(await s.get(PATHS.scopes, { projectId }))
        .slice(0, MAX_LIMIT)
        .map(scope),
    );
  }

  /** Solution processes (SAP Best Practices or custom) in project scopes. */
  async listSolutionProcesses(
    input: PageInput & { projectId?: string; scopeId?: string } = {},
  ): Promise<Page<SolutionProcess>> {
    const paging = page(input);
    const projectId = input.projectId
      ? guid(input.projectId, "projectId")
      : undefined;
    const scopeId = input.scopeId ? guid(input.scopeId, "scopeId") : undefined;
    return this.run(async (s) => {
      const rows = rowsOf(
        await s.get(PATHS.solutionProcesses, {
          projectId,
          scopeId,
          $top: paging.limit + 1,
          $skip: paging.offset || undefined,
        }),
      );
      return toPage(rows.map(solutionProcess), paging);
    });
  }

  async listProcessHierarchy(
    input: PageInput = {},
  ): Promise<Page<HierarchyNode>> {
    return this.run(async (s) => {
      const result = await odataPage(s, PATHS.hierarchyNodes, input);
      return { ...result, items: result.items.map(hierarchyNode) };
    });
  }

  // ---- Landscape ----

  async listLandscapeObjects(
    input: PageInput & { objectType?: string } = {},
  ): Promise<Page<LandscapeObject>> {
    const paging = page(input);
    const objectType = input.objectType?.trim();
    if (objectType && !/^[A-Za-z]{1,40}$/.test(objectType))
      throw new CloudAlmError("bad_request", "objectType must be a word");
    return this.run(async (s) => {
      const rows = rowsOf(
        await s.get(PATHS.landscape, {
          objectType: objectType || undefined,
          limit: paging.limit + 1,
          offset: paging.offset || undefined,
        }),
      );
      return toPage(rows.map(landscapeObject), paging);
    });
  }

  // ---- Cross-library: applications, developments, interfaces, configurations ----

  async listLibraryItems(
    kind: LibraryKind,
    input: PageInput = {},
  ): Promise<Page<LibraryItem>> {
    if (!LIBRARY_KINDS.includes(kind))
      throw new CloudAlmError(
        "bad_request",
        `kind must be one of ${LIBRARY_KINDS.join(", ")}`,
      );
    return this.run(async (s) => {
      const result = await odataPage(s, LIBRARY[kind].path, input);
      return {
        ...result,
        items: result.items.map((r) => libraryItem(r, kind)),
      };
    });
  }

  // ---- Analytics and operations ----

  /** The analytics data providers the tenant offers, with their scopes. */
  async listAnalyticsProviders(): Promise<AnalyticsProvider[]> {
    return this.run(async (s) =>
      rowsOf(await s.get(PATHS.analyticsProviders))
        .slice(0, MAX_LIMIT)
        .map((row) => ({
          name: str(row.name) ?? "",
          description: str(row.description, 300),
          domain: str(row.domain),
          scopes: strings(row.scope),
        })),
    );
  }

  /**
   * Rows of one analytics dataset. Rows are aggregates (one per
   * combination of dimension values), not records. `period` is a Cloud ALM
   * period code such as `C1D`, `C7D` or `C30D`; `filters` are dimension
   * equalities. Cloud ALM ignores filters on dimensions it cannot filter.
   */
  async queryAnalytics(input: {
    dataset: AnalyticsDataset;
    period?: string;
    resolution?: string;
    filters?: Record<string, string>;
    limit?: number;
    offset?: number;
  }): Promise<AnalyticsResult> {
    const { dataset } = input;
    if (!ANALYTICS_DATASETS.includes(dataset))
      throw new CloudAlmError(
        "bad_request",
        `dataset must be one of ${ANALYTICS_DATASETS.join(", ")}`,
      );
    const { limit, offset } = page({ limit: input.limit ?? DEFAULT_LIMIT, offset: input.offset ?? 0 });
    const clauses: string[] = [];
    const code = (value: string, what: string) => {
      if (!/^[A-Za-z0-9]{1,10}$/.test(value))
        throw new CloudAlmError("bad_request", `${what} must be a short code`);
      return value;
    };
    if (input.period)
      clauses.push(`period eq '${code(input.period, "period")}'`);
    if (input.resolution)
      clauses.push(`resolution eq '${code(input.resolution, "resolution")}'`);
    for (const [key, value] of Object.entries(input.filters ?? {}).slice(
      0,
      10,
    )) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key) || value.length > 200)
        throw new CloudAlmError("bad_request", "bad analytics filter");
      clauses.push(`${key} eq '${value.replaceAll("'", "''")}'`);
    }
    return this.run(async (s) => {
      const body = await s.get(`${PATHS.analytics}/${dataset}`, {
        $filter: clauses.length ? clauses.join(" and ") : undefined,
        $top: limit + 1,
        ...(offset ? { $skip: offset } : {}),
      });
      const all = rowsOf(body);
      const columns = [...new Set(all.flatMap((row) => Object.keys(row)))]
        .filter(
          (c) =>
            !ANALYTICS_TECHNICAL.has(c) &&
            !c.startsWith("@") &&
            // Columns empty in every row only cost the reader space.
            all.some(
              (row) => row[c] !== null && row[c] !== undefined && row[c] !== "",
            ),
        )
        .slice(0, MAX_ANALYTICS_COLUMNS);
      const rows = all.slice(0, limit).map((row) =>
        Object.fromEntries(
          columns.map((c) => {
            const v = row[c];
            return [
              c,
              typeof v === "string"
                ? str(v, 200)
                : typeof v === "number" || typeof v === "boolean"
                  ? v
                  : null,
            ];
          }),
        ),
      );
      return {
        provider: dataset,
        rows,
        columns,
        total: countOf(body),
        truncated: all.length > limit,
      };
    });
  }

  /** Business service status events (outages, maintenance, communications). */
  async listStatusEvents(input: PageInput = {}): Promise<Page<StatusEvent>> {
    const paging = page(input);
    return this.run(async (s) => {
      const rows = rowsOf(
        await s.get(PATHS.statusEvents, {
          limit: paging.limit + 1,
          offset: paging.offset || undefined,
        }),
      );
      return toPage(rows.map(statusEvent), paging);
    });
  }
}
