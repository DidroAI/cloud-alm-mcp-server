/**
 * The plain, bounded shapes this library returns. Field names are this
 * library's own; the Cloud ALM field each comes from is noted where it
 * differs.
 */

/** One page of a list. `nextOffset` is null on the last page. */
export type Page<T> = {
  items: T[];
  offset: number;
  limit: number;
  nextOffset: number | null;
  /** Total matching items when Cloud ALM says (OData `$count`), else null. */
  total: number | null;
};

export type PageInput = { limit?: number; offset?: number };

export type Project = {
  id: string;
  name: string | null;
  /** Cloud ALM status code, e.g. `O` (open). */
  status: string | null;
  /** e.g. `IMPLEMENTATION`. */
  purpose: string | null;
  /** e.g. `ONTRK` (on track). */
  operationalStatus: string | null;
  programId: string | null;
  /** The timebox (phase) the project is in. */
  phaseId: string | null;
};

export type Timebox = {
  id: string;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  closed: boolean | null;
};

export type Team = {
  id: string;
  name: string | null;
  description: string | null;
};

export type ProjectDetail = Project & { timeboxes: Timebox[]; teams: Team[] };

/** Task type codes, with the names this library also accepts. */
export const TASK_TYPES = {
  CALMTMPL: "roadmap task",
  CALMTASK: "project task",
  CALMUS: "user story",
  CALMST: "sub-task",
  CALMREQU: "requirement",
  CALMDEF: "defect",
  CALMQGATE: "quality gate",
  CALMCHKLI: "checklist item",
  CALMRISK: "risk",
} as const;
export type TaskTypeCode = keyof typeof TASK_TYPES;
export type TaskTypeName = (typeof TASK_TYPES)[TaskTypeCode];

export type TaskSummary = {
  id: string;
  /** Short id shown in the Cloud ALM UI, e.g. `3-12`. */
  displayId: string | null;
  projectId: string | null;
  title: string | null;
  type: string | null;
  /** Readable name of `type`, e.g. "defect". */
  typeName: string | null;
  status: string | null;
  subStatus: string | null;
  priority: number | null;
  assigneeName: string | null;
  scopeName: string | null;
  dueDate: string | null;
  tags: string[];
  /** `lastChangedTimestamp`. */
  changedAt: string | null;
};

export type TaskComment = {
  author: string | null;
  createdAt: string | null;
  text: string | null;
};

/** A test case as named from a link (a task's coverage, a coverage view). */
export type LinkedTestCase = {
  id: string;
  displayId: string | null;
  title: string | null;
  kind: TestCaseKind;
};

/**
 * What a task is linked to. Each list is read from the service that owns
 * the link; a link the key may not read is named in `unavailable` (e.g.
 * `testCases` without `testcases.read`) instead of failing the task.
 */
export type TaskLinks = {
  /** The requirement above a user story or project task (relation type 10). */
  requirementId: string | null;
  testCases: LinkedTestCase[];
  featureIds: string[];
  /** `solutionProcessId`s, the ids `listSolutionProcesses` returns. */
  solutionProcessIds: string[];
  unavailable: string[];
};

export type Task = TaskSummary & {
  description: string | null;
  parentId: string | null;
  timeboxName: string | null;
  createdAt: string | null;
  externalReferences: { name: string | null; url: string | null }[];
  comments: TaskComment[];
  /** Null when the caller asked for no links. */
  links: TaskLinks | null;
};

export type Feature = {
  id: string;
  displayId: string | null;
  title: string | null;
  projectId: string | null;
  statusCode: string | null;
  priorityCode: number | null;
  type: string | null;
  releaseId: string | null;
  modifiedAt: string | null;
  tags: string[];
};

export type FeatureDetail = Feature & {
  description: string | null;
  /** Transport request ids, e.g. `K900123` style `TRKORR` values. */
  transports: string[];
};

export type DocumentSummary = {
  id: string;
  displayId: string | null;
  title: string | null;
  projectId: string | null;
  documentTypeCode: string | null;
  statusCode: number | null;
  isTemplate: boolean | null;
  version: number | null;
  modifiedAt: string | null;
};

export type DocumentDetail = DocumentSummary & { content: string | null };

export type TestCaseKind = "manual" | "automated";

export type TestCase = {
  id: string;
  displayId: string | null;
  title: string | null;
  kind: TestCaseKind;
  projectId: string | null;
  scopeId: string | null;
  solutionProcessId: string | null;
  priorityCode: number | null;
  isPrepared: boolean | null;
  modifiedAt: string | null;
};

export type TestAction = {
  title: string | null;
  description: string | null;
  expectedResult: string | null;
  evidenceRequired: boolean | null;
};

export type TestActivity = {
  title: string | null;
  inScope: boolean | null;
  actions: TestAction[];
};

/** A task a test case covers (Test Management's task assignment). */
export type CoveredTask = {
  taskId: string;
  displayId: string | null;
  type: string | null;
  typeName: string | null;
};

export type TestCaseDetail = TestCase & {
  activities: TestActivity[];
  tasks: CoveredTask[];
  /** Tags with their group, if any. Cloud ALM's API cannot write these. */
  tags: { label: string; group: string | null }[];
};

export type CoverageRow = {
  task: TaskSummary;
  /** Test cases linked to the task itself (not through its user stories). */
  testCases: LinkedTestCase[];
};

/** Which tasks of a project have a test case, and which test cases cover nothing. */
export type TestCoverage = {
  projectId: string;
  /** Task type codes looked at, e.g. `CALMREQU`, `CALMUS`. */
  types: string[];
  rows: CoverageRow[];
  covered: number;
  uncovered: number;
  testCaseCount: number;
  /** Test cases of the project linked to no task. */
  unlinkedTestCases: LinkedTestCase[];
  /** True when a list reached the read cap and the view is incomplete. */
  truncated: boolean;
};

export type TestPlan = {
  id: string;
  displayId: string | null;
  title: string | null;
  projectId: string | null;
  statusCode: number | null;
  startDate: string | null;
  endDate: string | null;
  modifiedAt: string | null;
};

export type TestPlanDetail = TestPlan & {
  description: string | null;
  testCases: {
    testCaseId: string | null;
    displayId: string | null;
    title: string | null;
    type: string | null;
  }[];
};

export type Scope = {
  id: string;
  projectId: string | null;
  name: string | null;
  description: string | null;
};

export type SolutionProcess = {
  /** `solutionProcessId`, e.g. a Best Practices or SAP content id. */
  id: string;
  versionId: string | null;
  name: string | null;
  scenarioId: string | null;
  scopeId: string | null;
  projectId: string | null;
  status: string | null;
  isScoped: boolean | null;
  countryCount: number;
};

export type HierarchyNode = {
  id: string;
  displayId: string | null;
  title: string | null;
  description: string | null;
  parentId: string | null;
  sequence: number | null;
};

export type LandscapeObject = {
  /** `lmsId`. */
  id: string;
  name: string | null;
  description: string | null;
  /** e.g. `CloudService`, `BusinessService`, `TechnicalSystem`. */
  objectType: string | null;
  systemNumber: string | null;
  systemType: string | null;
  role: string | null;
  serviceType: string | null;
  deploymentModel: string | null;
  externalId: string | null;
  source: string | null;
};

export const LIBRARY_KINDS = [
  "applications",
  "developments",
  "interfaces",
  "configurations",
] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export type LibraryItem = {
  kind: LibraryKind;
  id: string;
  displayId: string | null;
  title: string | null;
  description: string | null;
  typeCode: string | null;
  /** Application id, development object name, … when the kind has one. */
  objectId: string | null;
  systemGroupName: string | null;
  solutionComponentName: string | null;
  readinessCode: string | null;
  priorityCode: string | null;
  modifiedAt: string | null;
  /** Interfaces only. */
  sender: string | null;
  receiver: string | null;
};

export type AnalyticsProvider = {
  name: string;
  description: string | null;
  domain: string | null;
  scopes: string[];
};

export type AnalyticsResult = {
  provider: string;
  rows: Record<string, string | number | boolean | null>[];
  columns: string[];
  total: number | null;
  truncated: boolean;
};

export type StatusEvent = {
  id: string;
  name: string | null;
  description: string | null;
  type: string | null;
  status: string | null;
  source: string | null;
  startTime: string | null;
  endTime: string | null;
  serviceName: string | null;
  serviceType: string | null;
  systemNumber: string | null;
};
