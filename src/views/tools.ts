/**
 * The opinionated reads behind the MCP tools: each answers a question an
 * agent asks (what is there, find, get, trace, what is missing) in one call,
 * as compact text with short display ids (`3-17`, `6-1`, `8-1-17`) that the
 * other tools accept.
 */
import {
  type AnalyticsDataset,
  type CloudAlm,
  CloudAlmError,
  LIBRARY_KINDS,
  type LibraryKind,
  type Project,
  type TaskSummary,
} from "../calm/index.js";
import {
  listProjects,
  type Part,
  pool,
  resolveProject,
  type SnapDocument,
  type SnapFeature,
  type Snapshot,
  snapshotOf,
  type SnapTestCase,
  type TestResult,
} from "./snapshot.js";
import {
  byDisplayId,
  capped,
  counts,
  documentLine,
  documentType,
  featureLine,
  featureStatus,
  isOpen,
  priorityLabel,
  resultText,
  resultWords,
  short,
  statusLabel,
  taskLine,
  taskStatus,
  testCaseLine,
  typeLabel,
} from "./text.js";
import { plainText } from "../calm/values.js";
import { byTitleCode, TITLE_CODE } from "./items.js";

export type ViewOptions = {
  /** Project used when a call names none (else: the tenant's only project). */
  defaultProject?: string;
  /** Today, for "current" phase; tests pass a fixed date. */
  today?: () => string;
  /** Clock for the snapshot cache (milliseconds); tests pass their own. */
  now?: () => number;
};

/** Independent reads run at most this many at a time. */
const PARALLEL = 6;

const clock = (o: ViewOptions) => (o.now ?? Date.now)();

async function snapshotFor(calm: CloudAlm, projectId: string | undefined, o: ViewOptions) {
  const { project } = await resolveProject(calm, projectId, o.defaultProject, clock(o));
  return snapshotOf(calm, project, clock(o));
}

function footer(snap: Snapshot, parts: Part[]): string[] {
  const out: string[] = [];
  const missing = parts.filter((p) => snap.unavailable.has(p));
  if (missing.length)
    out.push(`Not readable with this key (missing scope): ${missing.join(", ")}.`);
  const failed = parts.filter((p) => snap.failed.has(p));
  if (failed.length) out.push(`Could not read now (SAP Cloud ALM error): ${failed.join(", ")}.`);
  if (snap.truncated) out.push(`Some lists were cut at 1000 rows; counts are lower bounds.`);
  return out;
}

const projectLabel = (p: Project) => `${p.name ?? "?"} [${p.id}]`;

/** Where agents should look for what the project tools do not show. */
const ELSEWHERE =
  "SAP service status and outages: calm_landscape · tenant-wide counts by status, priority, day: calm_analytics.";

// ---------------------------------------------------------------------------
// calm_overview
// ---------------------------------------------------------------------------

export async function overview(calm: CloudAlm, input: { projectId?: string }, o: ViewOptions = {}) {
  const projects = await listProjects(calm, clock(o));
  const lines: string[] = [];
  const wanted = input.projectId ?? o.defaultProject;
  if (!wanted && projects.length !== 1) {
    lines.push(`${projects.length} projects. Pass projectId for one project's overview:`);
    for (const p of projects.slice(0, 50))
      lines.push(`- ${projectLabel(p)} · ${(p.purpose ?? "").toLowerCase()} · status ${p.status ?? "?"}`);
    return lines.join("\n");
  }
  // The project list is already read: no second read for the project.
  const listed = projects.find((p) => p.id.toLowerCase() === (wanted ?? projects[0]?.id ?? "").toLowerCase());
  const snap = listed ? snapshotOf(calm, listed, clock(o)) : await snapshotFor(calm, input.projectId, o);
  const p = snap.project;
  const [tasks, features, documents, testCases, testPlans, processes, processLinks, timeboxes, results] =
    await Promise.all([
      snap.tasks(),
      snap.features(),
      snap.documents(),
      snap.testCases(),
      snap.testPlans(),
      snap.processes(),
      snap.processLinks(),
      snap.timeboxes(),
      snap.testResults(),
    ]);
  const phases = timeboxes.filter((t) => t.type === 1);
  const milestones = timeboxes.filter((t) => t.type === 0);
  const current = timeboxes.find((t) => t.id === p.phaseId);
  lines.push(
    `Project ${projectLabel(p)} · ${(p.purpose ?? "?").toLowerCase()} · ${p.operationalStatus === "ONTRK" ? "on track" : (p.operationalStatus ?? "?")}${projects.length > 1 ? ` · ${projects.length - 1} other projects in the tenant` : ""}`,
  );
  if (timeboxes.length)
    lines.push(
      `Phases: ${phases.map((t) => `${t.name}${t.id === p.phaseId ? " (current)" : ""}${t.startDate ? ` ${t.startDate}–${t.endDate ?? ""}` : ""}`).join(", ")}${milestones.length ? ` · milestones: ${milestones.map((t) => `${t.name}${t.startDate ? ` ${t.startDate}` : ""}`).join(", ")}` : ""}${!current ? " · current phase not set" : ""}`,
    );
  const scoped = processes.filter((x) => x.isScoped);
  if (processes.length)
    lines.push(`Solution processes: ${scoped.length} in scope of ${processes.length}${scoped.length ? ` (${scoped.slice(0, 6).map((x) => x.name).join("; ")}${scoped.length > 6 ? "; …" : ""})` : ""}`);
  const byType = new Map<string, TaskSummary[]>();
  for (const t of tasks) byType.set(typeLabel(t.type), [...(byType.get(typeLabel(t.type)) ?? []), t]);
  lines.push(
    `Tasks: ${[...byType.entries()].map(([type, list]) => `${list.length} ${list.length === 1 ? type : type.replace(/y$/, "ie").replace(/s?$/, "s")} (${counts(list.map((t) => statusLabel(t.status)))})`).join("; ") || "none"}`,
  );
  const defects = tasks.filter((t) => t.type === "CALMDEF");
  if (defects.length)
    lines.push(
      `Defects: ${counts(defects.map(taskStatus))} · priority: ${counts(defects.map((t) => priorityLabel(t.priority) ?? "none"))}`,
    );
  if (features.length) lines.push(`Features: ${features.length} (${counts(features.map((f) => featureStatus(f.statusCode)))})`);
  const manual = testCases.filter((t) => t.kind === "manual");
  const automated = testCases.filter((t) => t.kind === "automated");
  lines.push(
    `Test cases: ${manual.length} manual (${manual.filter((t) => t.prepared).length} prepared), ${automated.length} automated · test plans: ${testPlans.length}${testPlans.length ? ` (${testPlans.slice(0, 3).map((t) => `${t.displayId} "${short(t.title, 50)}"`).join(", ")})` : ""}`,
  );
  const latest = [...results.values()].flat();
  if (latest.length)
    lines.push(`Test results (latest per test case and plan): ${counts(latest.map((r) => (r.status.toLowerCase() === "initial" ? "not run yet" : r.status.toLowerCase())))}`);
  lines.push(`Documents: ${documents.length}${documents.length ? ` (${counts(documents.map((d) => documentType(d.documentTypeCode)))})` : ""}`);
  const tags = counts(tasks.flatMap((t) => t.tags));
  if (tags) lines.push(`Tags: ${tags}`);
  // Gaps in one line; calm_gaps lists them.
  const tested = new Set(testCases.flatMap((t) => t.taskIds));
  // Open items only, as calm_gaps counts them.
  const reqs = tasks.filter((t) => (t.type === "CALMREQU" || t.type === "CALMUS") && isOpen(t.status));
  const untested = reqs.filter((t) => !tested.has(t.id)).length;
  const noProcess = reqs.filter((t) => t.type === "CALMREQU" && !processLinks.get(t.id)?.length).length;
  const orphans = testCases.filter((t) => !t.taskIds.length).length;
  lines.push(
    `Gaps: ${untested} of ${reqs.length} open requirements/user stories without a test case · ${noProcess} open requirements without a solution process · ${orphans} test cases linked to no task (calm_gaps lists them)`,
  );
  lines.push(ELSEWHERE);
  lines.push(...footer(snap, ["tasks", "features", "documents", "testCases", "testPlans", "processes", "processLinks", "timeboxes", "testResults"]));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// calm_find
// ---------------------------------------------------------------------------

export const FIND_TYPES = [
  "requirement",
  "user_story",
  "defect",
  "task",
  "feature",
  "document",
  "test_case",
  "test_plan",
  "process",
  ...LIBRARY_KINDS.map((k) => k.replace(/s$/, "")),
] as const;
export type FindType = (typeof FIND_TYPES)[number];

const TASK_FIND: Record<string, string[] | null> = {
  requirement: ["CALMREQU"],
  user_story: ["CALMUS"],
  defect: ["CALMDEF"],
  task: null, // any other task type
};

/** Status words that filter test cases by their latest result. */
const RESULT_STATUS: Record<string, string> = {
  passed: "passed",
  failed: "failed",
  "in progress": "in progress",
  initial: "initial",
  "not run": "initial",
  "not run yet": "initial",
  "not executed": "initial",
  blocked: "blocked",
};

type Hit = { sort: string; displayId: string | null; line: string };

/** `a b | c` → [[a,b],[c]]: all words of one alternative must match. */
function matcher(query: string | undefined) {
  const alternatives = (query ?? "")
    .toLowerCase()
    .split(/\s*\|\s*|\s+or\s+/)
    .map((a) => a.split(/\s+/).filter(Boolean))
    .filter((a) => a.length);
  return (...texts: (string | null | undefined)[]) => {
    if (!alternatives.length) return true;
    const hay = texts.filter(Boolean).join(" ").toLowerCase();
    return alternatives.some((words) => words.every((w) => hay.includes(w)));
  };
}

const LIBRARY_TYPE = /application|development|interface|configuration/;

export async function find(
  calm: CloudAlm,
  input: {
    query?: string;
    types?: FindType[];
    status?: string;
    tag?: string;
    projectId?: string;
    limit?: number;
    offset?: number;
  },
  o: ViewOptions = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const query = input.query?.trim();
  // Without types: project items; processes only when words are given
  // (a project has many, and their names rarely answer "list everything").
  const types = new Set<FindType>(
    input.types?.length
      ? input.types
      : FIND_TYPES.filter((t) => !LIBRARY_TYPE.test(t) && (t !== "process" || !!query)),
  );
  const match = matcher(query);
  const status = input.status?.toLowerCase().trim().replace(/\s+/g, " ");
  const resultStatus = status ? RESULT_STATUS[status] : undefined;
  const tag = input.tag?.toLowerCase().trim();
  const statusOk = (label: string, done: string[]) =>
    !status || (status === "open" ? !done.some((d) => label.startsWith(d)) : label.includes(status));
  const tagOk = (tags: string[]) => !tag || tags.some((x) => x.toLowerCase() === tag);
  const snap = await snapshotFor(calm, input.projectId, o);
  const taskTypes = [...types].filter((t) => t in TASK_FIND);
  const want = {
    tasks: taskTypes.length > 0,
    features: types.has("feature"),
    documents: types.has("document") && !status && !tag,
    testCases: types.has("test_case") && (!status || !!resultStatus),
    testPlans: types.has("test_plan") && !status && !tag,
    processes: types.has("process") && !status && !tag,
  };
  const libraryKinds = status || tag ? [] : LIBRARY_KINDS.filter((k) => types.has(k.replace(/s$/, "") as FindType));
  const none = <T>(v: T) => Promise.resolve(v);
  // Every list is its own operation: read them all at once.
  const [tasks, features, documents, testCases, results, testPlans, processes, library] = await Promise.all([
    want.tasks ? snap.tasks() : none([]),
    want.features ? snap.features() : none([]),
    want.documents ? snap.documents() : none([]),
    want.testCases ? snap.testCases() : none([]),
    want.testCases ? snap.testResults() : none(new Map<string, TestResult[]>()),
    want.testPlans ? snap.testPlans() : none([]),
    want.processes ? snap.processes() : none([]),
    Promise.all(
      libraryKinds.map((kind) =>
        calm.listLibraryItems(kind as LibraryKind, { limit: 200 }).catch((e) => {
          if (e instanceof CloudAlmError && e.code === "forbidden") return null;
          throw e;
        }),
      ),
    ),
  ]);
  const parts: Part[] = [];
  const hits: Hit[] = [];
  if (want.tasks) {
    parts.push("tasks");
    const named = new Set(Object.values(TASK_FIND).flatMap((v) => v ?? []));
    for (const t of tasks) {
      const wanted = taskTypes.some((k) => {
        const codes = TASK_FIND[k];
        return codes ? codes.includes(t.type ?? "") : !named.has(t.type ?? "");
      });
      if (!wanted || !match(t.title, ...t.tags) || !tagOk(t.tags)) continue;
      if (status && !(status === "open" ? isOpen(t.status) : taskStatus(t).includes(status))) continue;
      hits.push({ sort: `1${t.type}`, displayId: t.displayId, line: taskLine(t) });
    }
  }
  if (want.features) {
    parts.push("features");
    for (const f of features)
      if (match(f.title, ...f.tags) && tagOk(f.tags) && statusOk(featureStatus(f.statusCode), ["tested", "approved", "deployed", "confirmed", "not planned"]))
        hits.push({ sort: "2", displayId: f.displayId, line: featureLine(f) });
  }
  if (want.documents) {
    parts.push("documents");
    for (const d of documents)
      if (match(d.title)) hits.push({ sort: "3", displayId: d.displayId, line: documentLine(d) });
  }
  if (want.testCases) {
    parts.push("testCases", "testResults");
    for (const t of testCases) {
      if (!match(t.title, ...t.tags) || !tagOk(t.tags)) continue;
      if (resultStatus && !results.get(t.id)?.some((r) => r.status.toLowerCase() === resultStatus)) continue;
      hits.push({ sort: "4", displayId: t.displayId, line: testCaseLine(t, results.get(t.id)) });
    }
  }
  if (want.testPlans) {
    parts.push("testPlans");
    for (const t of testPlans)
      if (match(t.title))
        hits.push({ sort: "5", displayId: t.displayId, line: `${t.displayId} · test plan · "${short(t.title)}"${t.startDate ? ` · ${t.startDate}–${t.endDate ?? ""}` : ""}` });
  }
  if (want.processes) {
    parts.push("processes");
    for (const p of processes)
      if (match(p.name)) hits.push({ sort: "6", displayId: null, line: `${p.id} · solution process · ${p.isScoped ? "in scope" : "not in scope"} · "${short(p.name)}"` });
  }
  libraryKinds.forEach((kind, i) => {
    for (const item of library[i]?.items ?? [])
      if (match(item.title, item.objectId, item.description))
        hits.push({ sort: `7${kind}`, displayId: item.displayId, line: `${item.displayId ?? item.id} · ${kind.replace(/s$/, "")} · "${short(item.title)}"${item.objectId ? ` · ${item.objectId}` : ""}` });
  });
  hits.sort((a, b) => a.sort.localeCompare(b.sort) || byDisplayId(a, b));
  const shown = hits.slice(offset, offset + limit);
  const more = offset + shown.length < hits.length;
  const range = shown.length
    ? `showing ${offset + 1}–${offset + shown.length}${more ? `; more with offset ${offset + shown.length}` : ""}`
    : `offset ${offset} is past the end of the results`;
  const notes: string[] = [];
  const asked = new Set(input.types ?? []);
  if (tag && ["document", "test_plan", "process"].some((t) => asked.has(t as FindType)))
    notes.push("tags exist on tasks, features and test cases only");
  if (status && ["document", "test_plan", "process"].some((t) => asked.has(t as FindType)))
    notes.push("status filters tasks, features and test cases only");
  if (status && asked.has("test_case") && !resultStatus)
    notes.push(`test cases filter by latest result: ${Object.keys(RESULT_STATUS).slice(0, 4).join(", ")}`);
  const lines = [
    `${hits.length} match${hits.length === 1 ? "" : "es"} in ${snap.project.name ?? "the project"}${hits.length && (offset > 0 || more) ? ` (${range})` : ""}${notes.length ? ` (${notes.join("; ")})` : ""}`,
    ...shown.map((h) => `- ${h.line}`),
  ];
  if (shown.length) lines.push("calm_get takes these ids (several at once); calm_trace shows an item's links.");
  if (!input.types?.length && !query && !status && !tag) lines.push('Solution processes are listed with types ["process"].');
  lines.push(...footer(snap, parts));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Resolving ids
// ---------------------------------------------------------------------------

type Ref =
  | { kind: "task"; task: TaskSummary }
  | { kind: "feature"; feature: SnapFeature }
  | { kind: "document"; document: SnapDocument }
  | { kind: "test case"; testCase: SnapTestCase }
  | { kind: "test plan"; id: string; displayId: string | null; title: string | null }
  | { kind: "process"; id: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Items whose title carries `code` as a word: "[seed] REQ-03 Credit…". */
async function resolveCode(snap: Snapshot, code: string): Promise<Ref> {
  const [tasks, features, documents, testCases] = await Promise.all([snap.tasks(), snap.features(), snap.documents(), snap.testCases()]);
  const all = [
    ...tasks.map((task) => ({ ref: { kind: "task", task } as Ref, id: task.id, title: task.title, displayId: task.displayId })),
    ...features.map((feature) => ({ ref: { kind: "feature", feature } as Ref, id: feature.id, title: feature.title, displayId: feature.displayId })),
    ...documents.map((document) => ({ ref: { kind: "document", document } as Ref, id: document.id, title: document.title, displayId: document.displayId })),
    ...testCases.map((testCase) => ({ ref: { kind: "test case", testCase } as Ref, id: testCase.id, title: testCase.title, displayId: testCase.displayId })),
  ];
  return byTitleCode(code, all).ref;
}

async function resolve(snap: Snapshot, raw: string): Promise<Ref> {
  const ref = raw.trim().replace(/^\[|\]$/g, "");
  const byId = (x: { id: string; displayId: string | null }) =>
    GUID.test(ref) ? x.id.toLowerCase() === ref.toLowerCase() : x.displayId === ref;
  if (/^ERL-|^[A-Z]{2,}-[0-9a-f]{20,}$/i.test(ref)) {
    const process = (await snap.processes()).find((p) => p.id.toLowerCase() === ref.toLowerCase());
    if (!process) throw new CloudAlmError("not_found", `solution process ${ref} is not in project ${snap.project.name ?? snap.project.id}`);
    return { kind: "process", id: process.id };
  }
  if (TITLE_CODE.test(ref) && !/^\d/.test(ref)) return resolveCode(snap, ref);
  if (!GUID.test(ref) && !/^\d+(-\d+)+$/.test(ref))
    throw new CloudAlmError("bad_request", `"${ref.slice(0, 40)}" is not an id; use a display id like 3-17 or 8-1-2, a GUID, or a code from a title like REQ-03`);
  const prefix = ref.split("-")[0];
  const guidRef = GUID.test(ref);
  const none = <T>(v: T) => Promise.resolve(v);
  // A GUID can be anything: read the lists at once. A display id names its list.
  const [tasks, features, documents, testCases, testPlans] = await Promise.all([
    guidRef || prefix === "3" ? snap.tasks() : none([]),
    guidRef || prefix === "6" ? snap.features() : none([]),
    guidRef || prefix === "7" ? snap.documents() : none([]),
    guidRef || prefix === "8" ? snap.testCases() : none([]),
    guidRef || prefix === "8" ? snap.testPlans() : none([]),
  ]);
  const t = tasks.find(byId);
  if (t) return { kind: "task", task: t };
  const f = features.find(byId);
  if (f) return { kind: "feature", feature: f };
  const d = documents.find(byId);
  if (d) return { kind: "document", document: d };
  const tc = testCases.find(byId);
  if (tc) return { kind: "test case", testCase: tc };
  const p = testPlans.find(byId);
  if (p) return { kind: "test plan", id: p.id, displayId: p.displayId, title: p.title };
  throw new CloudAlmError("not_found", `${ref} not found in project ${snap.project.name ?? snap.project.id}`);
}

const ALL_PARTS: Part[] = ["tasks", "features", "documents", "testCases", "processes", "processLinks", "testResults", "defects"];

/** The snapshot parts each kind of item needs to name its links. */
const NEEDS: Record<Ref["kind"], Part[]> = {
  task: ALL_PARTS,
  feature: ["tasks", "testCases", "testResults", "defects"],
  document: ["tasks", "testCases", "processes", "testResults", "defects"],
  "test case": ["tasks", "testCases", "testResults", "defects"],
  "test plan": ["tasks", "testCases", "testResults", "defects"],
  process: ["tasks", "processLinks", "processes", "documents"],
};

/** Names for linked ids, from the parts of the snapshot asked for. */
async function namer(snap: Snapshot, parts: readonly Part[] = ALL_PARTS) {
  const want = new Set(parts);
  const none = <T>(v: T) => Promise.resolve(v);
  const [tasks, features, documents, testCases, processes, processLinks, results, defects] = await Promise.all([
    want.has("tasks") ? snap.tasks() : none([]),
    want.has("features") ? snap.features() : none([]),
    want.has("documents") ? snap.documents() : none([]),
    want.has("testCases") ? snap.testCases() : none([]),
    want.has("processes") ? snap.processes() : none([]),
    want.has("processLinks") ? snap.processLinks() : none(new Map<string, string[]>()),
    want.has("testResults") ? snap.testResults() : none(new Map<string, TestResult[]>()),
    want.has("defects") ? snap.defects() : none({ byTestCase: new Map<string, string[]>(), byDefect: new Map<string, string>() }),
  ]);
  const task = new Map(tasks.map((t) => [t.id.toLowerCase(), t]));
  const testCase = new Map(testCases.map((t) => [t.id.toLowerCase(), t]));
  const defectsKnown = want.has("defects") && !snap.unavailable.has("defects") && !snap.failed.has("defects");
  /** Defects raised from a test case, as tasks. */
  const defectsOf = (testCaseId: string) =>
    (defects.byTestCase.get(testCaseId.toLowerCase()) ?? [])
      .map((id) => task.get(id))
      .filter((t): t is TaskSummary => !!t)
      .sort(byDisplayId);
  const names = {
    tasks,
    features,
    documents,
    testCases,
    processLinks,
    results,
    defectsKnown,
    defectsOf,
    /** The test case a defect was raised from. */
    raisedFrom: (defectId: string) => {
      const id = defects.byDefect.get(defectId.toLowerCase());
      return id ? testCase.get(id) : undefined;
    },
    taskOf: (id: string) => task.get(id.toLowerCase()),
    task: (id: string) => {
      const t = task.get(id.toLowerCase());
      return t ? `${t.displayId} ${typeLabel(t.type)} "${short(t.title, 70)}" (${taskStatus(t)})` : `[${id}]`;
    },
    defect: (t: TaskSummary) =>
      `defect ${t.displayId} "${short(t.title, 60)}" (${taskStatus(t)}${t.priority !== null ? `, priority ${priorityLabel(t.priority)}` : ""})`,
    feature: (f: SnapFeature) => `${f.displayId} "${short(f.title, 70)}" (${featureStatus(f.statusCode)})`,
    testCase: (t: SnapTestCase) => {
      const r = resultText(results.get(t.id));
      const raised = defectsOf(t.id).map((d) => d.displayId);
      return `${t.displayId} "${short(t.title, 70)}"${t.kind === "automated" ? " (automated)" : ""}${r ? ` (${r})` : ""}${raised.length ? ` · defect ${raised.join(", ")}` : ""}`;
    },
    document: (d: SnapDocument) => `${d.displayId} "${short(d.title, 70)}" (${documentType(d.documentTypeCode)})`,
    process: (id: string) => processes.find((p) => p.id === id)?.name ?? id,
  };
  return names;
}
type Names = Awaited<ReturnType<typeof namer>>;

// ---------------------------------------------------------------------------
// calm_get
// ---------------------------------------------------------------------------

export async function get(calm: CloudAlm, input: { ids: string[]; projectId?: string }, o: ViewOptions = {}) {
  const snap = await snapshotFor(calm, input.projectId, o);
  const ids = input.ids.slice(0, 10);
  const failed = (raw: string, error: unknown) => {
    if (!(error instanceof CloudAlmError)) throw error;
    return `${raw}: ${error.code} — ${error.reason}`;
  };
  // Resolve every id first, so the snapshot parts they need are read once, together.
  const refs = await Promise.all(
    ids.map((raw) =>
      resolve(snap, raw).then(
        (ref) => ({ raw, ref, error: null as string | null }),
        (error: unknown) => ({ raw, ref: null, error: failed(raw, error) }),
      ),
    ),
  );
  const parts = new Set<Part>(refs.flatMap((r) => (r.ref ? NEEDS[r.ref.kind] : [])));
  const n = await namer(snap, [...parts]);
  // At most 10 ids, each 1–3 requests: all at once stays well inside the API limits.
  const out = await pool(refs, 10, (r) =>
    r.ref ? getOne(calm, snap, n, r.ref).catch((error: unknown) => failed(r.raw, error)) : Promise.resolve(r.error as string),
  );
  return out.join("\n\n---\n\n");
}

async function getOne(calm: CloudAlm, snap: Snapshot, n: Names, ref: Ref): Promise<string> {
  const lines: string[] = [];
  const list = (label: string, items: string[]) => {
    if (items.length) lines.push(`${label}: ${items.join("; ")}`);
  };
  const defectsLine = (testCaseId: string) => {
    if (!n.defectsKnown) return;
    const raised = n.defectsOf(testCaseId);
    lines.push(`Defects raised from it: ${raised.length ? raised.map(n.defect).join("; ") : "none"}`);
  };
  if (ref.kind === "task") {
    const [t, relations] = await Promise.all([calm.getTask(ref.task.id, { links: false }), snap.relations(ref.task.id)]);
    lines.push(
      `${t.displayId} ${typeLabel(t.type)} · ${taskStatus(t)}${t.priority !== null ? ` · priority ${priorityLabel(t.priority)}` : ""} · "${t.title}" [${t.id}]`,
      [t.scopeName && `scope ${t.scopeName}`, t.timeboxName && `phase ${t.timeboxName}`, t.assigneeName && `assignee ${t.assigneeName}`, t.dueDate && `due ${t.dueDate}`, t.tags.length && `tags ${t.tags.join(", ")}`, t.createdAt && `created ${t.createdAt.slice(0, 10)}`]
        .filter(Boolean)
        .join(" · "),
    );
    if (t.description) lines.push("", t.description, "");
    list("Requirement", relations.filter((r) => r.type === "10").map((r) => n.task(r.taskId)));
    list("User stories / tasks under it", relations.filter((r) => r.type === "0").map((r) => n.task(r.taskId)));
    if (t.type === "CALMDEF" && n.defectsKnown) {
      const from = n.raisedFrom(t.id);
      lines.push(`Raised from test case: ${from ? n.testCase(from) : "not recorded"}`);
    }
    list("Test cases", n.testCases.filter((x) => x.taskIds.includes(t.id)).map(n.testCase));
    list("Features", n.features.filter((f) => f.taskIds.includes(t.id)).map(n.feature));
    list("Documents", n.documents.filter((d) => d.taskIds.includes(t.id)).map(n.document));
    list("Solution processes", (n.processLinks.get(t.id) ?? []).map(n.process));
    if (t.externalReferences.length) list("References", t.externalReferences.map((r) => `${r.name ?? ""} ${r.url ?? ""}`.trim()));
    if (t.comments.length) lines.push(`Comments:`, ...t.comments.map((c) => `- ${c.createdAt?.slice(0, 10) ?? ""} ${c.author ?? ""}: ${c.text ?? ""}`));
  } else if (ref.kind === "feature") {
    const f = await calm.getFeature(ref.feature.id);
    lines.push(`${f.displayId} feature · ${featureStatus(f.statusCode)}${f.priorityCode !== null ? ` · priority ${priorityLabel(f.priorityCode)}` : ""} · "${f.title}" [${f.id}]`);
    if (ref.feature.tags.length) lines.push(`tags ${ref.feature.tags.join(", ")}`);
    if (f.description) lines.push("", f.description, "");
    lines.push(`Transports: ${f.transports.length ? f.transports.join(", ") : "none"}`);
    list("Delivers", ref.feature.taskIds.map(n.task));
    list("Test cases of those tasks", n.testCases.filter((x) => x.taskIds.some((id) => ref.feature.taskIds.includes(id))).map(n.testCase));
  } else if (ref.kind === "document") {
    const d = await calm.getDocument(ref.document.id);
    lines.push(`${d.displayId} ${documentType(d.documentTypeCode)} · "${d.title}" [${d.id}]`);
    list("Tasks", ref.document.taskIds.map(n.task));
    list("Test cases", n.testCases.filter((x) => ref.document.testCaseIds.includes(x.id)).map(n.testCase));
    list("Solution processes", ref.document.processIds.map(n.process));
    if (d.content) lines.push("", d.content);
  } else if (ref.kind === "test case") {
    const tc = ref.testCase;
    const result = resultText(n.results.get(tc.id));
    if (tc.kind === "manual") {
      const t = await calm.getTestCase(tc.id);
      lines.push(`${t.displayId} manual test case · ${t.isPrepared ? "prepared" : "not prepared"}${t.priorityCode !== null ? ` · priority ${priorityLabel(t.priorityCode)}` : ""} · "${t.title}" [${t.id}]`);
      lines.push(tc.taskIds.length ? `Covers: ${tc.taskIds.map(n.task).join("; ")}` : "Covers: no task (linked to nothing)");
      lines.push(`Latest result: ${result || "none recorded"}`);
      defectsLine(tc.id);
      if (t.tags.length) list("Tags", t.tags.map((g) => (g.group ? `${g.group}: ${g.label}` : g.label)));
      t.activities.forEach((a, i) => {
        lines.push(`${i + 1}. ${a.title ?? ""}${a.inScope === false ? " (out of scope)" : ""}`);
        a.actions.forEach((s, j) => {
          lines.push(`   ${i + 1}.${j + 1} ${s.title ?? ""}${s.evidenceRequired ? " [evidence]" : ""}`);
          if (s.description) lines.push(`      do: ${s.description.replace(/\n+/g, " ")}`);
          if (s.expectedResult) lines.push(`      expect: ${s.expectedResult.replace(/\n+/g, " ")}`);
        });
      });
      if (!t.activities.length) lines.push("No steps.");
    } else {
      lines.push(`${tc.displayId} automated test case · ${tc.prepared ? "prepared" : "not prepared"}${tc.priority !== null ? ` · priority ${priorityLabel(tc.priority)}` : ""} · "${tc.title}" [${tc.id}]`);
      lines.push(tc.taskIds.length ? `Covers: ${tc.taskIds.map(n.task).join("; ")}` : "Covers: no task (linked to nothing)");
      lines.push(`Latest result: ${result || "none recorded"}`);
      defectsLine(tc.id);
      lines.push("Steps: run by the test automation tool; Cloud ALM keeps no steps for automated test cases.");
    }
  } else if (ref.kind === "test plan") {
    const p = await calm.getTestPlan(ref.id);
    lines.push(`${p.displayId} test plan · "${p.title}" [${p.id}]${p.startDate ? ` · ${p.startDate}–${p.endDate ?? ""}` : ""}`);
    if (p.description) lines.push(p.description);
    const inPlan = (id: string | null) => {
      const all = id ? (n.results.get(id) ?? n.results.get(id.toLowerCase()) ?? []) : [];
      return all.find((r) => r.plan === p.title) ?? null;
    };
    const rows = [...p.testCases].sort(byDisplayId).map((t) => {
      const r = inPlan(t.testCaseId);
      const raised = t.testCaseId ? n.defectsOf(t.testCaseId).map((d) => d.displayId) : [];
      return { t, r, line: `- ${t.displayId} "${short(t.title, 80)}" · ${r ? resultWords(r) : "no result"}${raised.length ? ` · defect ${raised.join(", ")}` : ""}` };
    });
    lines.push(
      `Test cases (${rows.length})${rows.length ? `: ${counts(rows.map((x) => (x.r ? (x.r.status.toLowerCase() === "initial" ? "not run yet" : x.r.status.toLowerCase()) : "no result")))}` : ""}`,
      ...rows.map((x) => x.line),
    );
  } else {
    const tasks = [...n.processLinks.entries()].filter(([, ps]) => ps.includes(ref.id)).map(([id]) => id);
    lines.push(`${ref.id} solution process "${n.process(ref.id)}"`);
    list("Tasks", tasks.map(n.task));
    list("Documents", n.documents.filter((d) => d.processIds.includes(ref.id)).map(n.document));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// calm_trace
// ---------------------------------------------------------------------------

export async function trace(calm: CloudAlm, input: { id: string; projectId?: string }, o: ViewOptions = {}) {
  const snap = await snapshotFor(calm, input.projectId, o);
  const [n, ref] = await Promise.all([namer(snap), resolve(snap, input.id)]);
  const processLinks = n.processLinks;
  // The tasks at the centre of the trace.
  let start: string[] = [];
  let head = "";
  if (ref.kind === "task") {
    start = [ref.task.id];
    head = n.task(ref.task.id);
  } else if (ref.kind === "feature") {
    start = ref.feature.taskIds;
    head = `${n.feature(ref.feature)} feature`;
  } else if (ref.kind === "test case") {
    start = ref.testCase.taskIds;
    head = `${n.testCase(ref.testCase)} test case`;
  } else if (ref.kind === "document") {
    start = ref.document.taskIds;
    head = n.document(ref.document);
  } else if (ref.kind === "process") {
    start = [...processLinks.entries()].filter(([, ps]) => ps.includes(ref.id)).map(([id]) => id);
    head = `solution process "${n.process(ref.id)}"`;
  } else throw new CloudAlmError("bad_request", "calm_trace takes a task, feature, test case, document or process; use calm_get for a test plan");
  // Group around requirements: a requirement with its children, or a lone task.
  const ids = start.slice(0, 30);
  const relations = await pool(ids, PARALLEL, (id) => snap.relations(id));
  const groups = new Map<string, Set<string>>();
  ids.forEach((id, i) => {
    const rel = relations[i] ?? [];
    const parent = rel.find((r) => r.type === "10")?.taskId;
    const reqId = n.taskOf(id)?.type === "CALMREQU" ? id : (parent ?? id);
    const group = groups.get(reqId) ?? new Set<string>();
    groups.set(reqId, group);
    if (reqId === id) for (const r of rel.filter((r) => r.type === "0")) group.add(r.taskId);
    else group.add(id);
  });
  const featureOf = (taskId: string) => n.features.filter((f) => f.taskIds.includes(taskId));
  const featured = [...new Set([...groups].flatMap(([r, kids]) => [r, ...kids]).flatMap(featureOf))].slice(0, 10);
  const transports = new Map(
    (await pool(featured, PARALLEL, async (f) => [f.id, (await calm.getFeature(f.id)).transports] as const)),
  );
  const lines = [`Trace of ${head}`];
  const describe = (taskId: string, indent: string) => {
    const t = n.taskOf(taskId);
    const out = [`${indent}${n.task(taskId)}${t?.tags.length ? ` #${t.tags.join(" #")}` : ""}`];
    const sub = `${" ".repeat(indent.length)}  `;
    // From a process, every task has that process: name only the others.
    const ps = (processLinks.get(taskId) ?? []).filter((p) => ref.kind !== "process" || p !== ref.id);
    if (ps.length) out.push(`${sub}${ref.kind === "process" ? "also in process" : "process"}: ${ps.map(n.process).join("; ")}`);
    for (const f of featureOf(taskId)) {
      const tr = transports.get(f.id);
      out.push(`${sub}feature: ${n.feature(f)} · transports: ${tr ? (tr.length ? tr.join(", ") : "none") : "not read"}`);
    }
    if (t?.type === "CALMDEF") {
      const from = n.raisedFrom(taskId);
      out.push(`${sub}raised from test case: ${from ? n.testCase(from) : n.defectsKnown ? "not recorded" : "unknown (no analytics scope)"}`);
    } else {
      const tcs = n.testCases.filter((x) => x.taskIds.includes(taskId));
      out.push(`${sub}test cases: ${tcs.length ? tcs.map(n.testCase).join("; ") : "NONE"}`);
    }
    const docs = n.documents.filter((d) => d.taskIds.includes(taskId));
    if (docs.length) out.push(`${sub}documents: ${docs.map(n.document).join("; ")}`);
    return out;
  };
  for (const [reqId, kids] of groups) {
    lines.push(...describe(reqId, "- "));
    for (const kid of kids) lines.push(...describe(kid, "    - "));
  }
  if (!groups.size) lines.push("No linked tasks.");
  if (ref.kind === "test case" && n.defectsKnown) {
    const raised = n.defectsOf(ref.testCase.id);
    if (raised.length) lines.push(`Defects raised from this test case: ${raised.map(n.defect).join("; ")}`);
  }
  if (ref.kind === "document") {
    const tcs = n.testCases.filter((x) => ref.document.testCaseIds.includes(x.id));
    if (tcs.length) lines.push(`Document's own test cases: ${tcs.map(n.testCase).join("; ")}`);
    if (ref.document.processIds.length) lines.push(`Document's processes: ${ref.document.processIds.map(n.process).join("; ")}`);
  }
  lines.push(...footer(snap, ["tasks", "features", "documents", "testCases", "processLinks"]));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// calm_gaps
// ---------------------------------------------------------------------------

export const GAP_CHECKS = ["untested", "failed_tests", "no_process", "no_feature", "features", "orphan_tests", "unprepared_tests"] as const;
export type GapCheck = (typeof GAP_CHECKS)[number];

export async function gaps(
  calm: CloudAlm,
  input: { projectId?: string; checks?: GapCheck[]; max?: number },
  o: ViewOptions = {},
) {
  const checks = new Set(input.checks?.length ? input.checks : GAP_CHECKS);
  const max = Math.min(Math.max(input.max ?? 20, 1), 200);
  const snap = await snapshotFor(calm, input.projectId, o);
  const n = await namer(snap, [
    "tasks",
    "features",
    "testCases",
    "processLinks",
    ...(checks.has("failed_tests") ? (["testResults", "defects"] as const) : []),
  ]);
  const { tasks, features, testCases, processLinks, results } = n;
  const open = tasks.filter((t) => isOpen(t.status));
  const reqs = open.filter((t) => t.type === "CALMREQU" || t.type === "CALMUS");
  const tested = new Set(testCases.flatMap((t) => t.taskIds));
  const featured = new Set(features.flatMap((f) => f.taskIds));
  const lines = [`Gaps in ${snap.project.name ?? "the project"} (open requirements and user stories only):`];
  const section = (title: string, items: string[], hint?: string) => {
    lines.push("", `${title}: ${items.length}${items.length && hint ? ` — ${hint}` : ""}`);
    lines.push(...capped(items, (x) => x, max));
  };
  if (checks.has("untested")) {
    const missing = reqs.filter((t) => !tested.has(t.id));
    // The user stories under a requirement need one call each: cap them, run them together.
    const lookups = missing.filter((t) => t.type === "CALMREQU").slice(0, 30);
    const kidsOf = new Map(
      await pool(lookups, PARALLEL, async (t) => [t.id, (await snap.relations(t.id)).filter((r) => r.type === "0").map((r) => r.taskId)] as const),
    );
    const items = missing.map((t) => {
      const kids = kidsOf.get(t.id) ?? [];
      const covered = kids.filter((k) => tested.has(k)).length;
      return `${taskLine(t)}${kids.length ? ` (user stories under it with a test case: ${covered} of ${kids.length})` : ""}`;
    });
    section("Without a test case", items, "calm_get shows a task's description to draft one");
  }
  if (checks.has("failed_tests")) {
    const failed = testCases.filter((t) => results.get(t.id)?.some((r) => /fail/i.test(r.status)));
    const defectNote = (t: SnapTestCase) => {
      if (!n.defectsKnown) return "";
      const raised = n.defectsOf(t.id);
      return raised.length ? ` — ${raised.map(n.defect).join("; ")}` : " — no defect raised";
    };
    if (snap.unavailable.has("testResults") || snap.failed.has("testResults"))
      lines.push("", "Test cases whose latest run failed: unknown — test results need the key's analytics and test scopes (calm-api.analytics.read, calm-api.tests.read).");
    else section(
      "Test cases whose latest run failed",
      failed.sort(byDisplayId).map((t) => `${testCaseLine(t, results.get(t.id))}${t.taskIds.length ? ` — covers ${t.taskIds.map((id) => { const k = n.taskOf(id); return k ? `${k.displayId} "${short(k.title, 60)}"` : id; }).join(", ")}` : ""}${defectNote(t)}`),
    );
  }
  if (checks.has("no_process"))
    section("Requirements without a solution process", reqs.filter((t) => t.type === "CALMREQU" && !processLinks.get(t.id)?.length).map(taskLine));
  if (checks.has("no_feature"))
    section("Without a feature (not planned for delivery)", reqs.filter((t) => !featured.has(t.id)).map(taskLine));
  if (checks.has("features")) {
    const items: string[] = [];
    for (const f of features) {
      if (!f.taskIds.length) items.push(`${featureLine(f)} — delivers no requirement or user story`);
      else {
        const untested = f.taskIds.filter((id) => !tested.has(id));
        if (untested.length && ["IN_TESTING", "IN_REALIZATION", "SUCCESSFULLY_TESTED"].includes(f.statusCode ?? ""))
          items.push(`${featureLine(f)} — ${untested.length} of ${f.taskIds.length} tasks it delivers have no test case: ${untested.map((id) => n.taskOf(id)?.displayId ?? id).join(", ")}`);
      }
    }
    section("Features with a gap", items);
  }
  if (checks.has("orphan_tests"))
    section("Test cases linked to no task", testCases.filter((t) => !t.taskIds.length).sort(byDisplayId).map((t) => testCaseLine(t)));
  if (checks.has("unprepared_tests"))
    section("Test cases not prepared", testCases.filter((t) => t.kind === "manual" && t.prepared === false).sort(byDisplayId).map((t) => testCaseLine(t)));
  lines.push("", "Links counted: test case → task (Test Management), feature → task, task → solution process. Direct links only.");
  lines.push(...footer(snap, ["tasks", "features", "testCases", "processLinks", "testResults", "defects"]));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// calm_analytics
// ---------------------------------------------------------------------------

type DatasetInfo = {
  about: string;
  /** Main columns to group by (seen on live tenants). */
  columns?: string[];
  /** The column `status` stands for. */
  status?: string;
};

export const DATASETS: Record<AnalyticsDataset, DatasetInfo> = {
  Projects: { about: "projects and their status", columns: ["status", "state"], status: "status" },
  Tasks: {
    about: "tasks of every type, one row per task (status, phase, role, overdue)",
    columns: ["type", "statusText", "priority", "phase", "role", "workstream", "overdue", "scopeName"],
    status: "statusText",
  },
  Requirements: {
    about: "requirements (try period C30D)",
    columns: ["statusText", "priority", "approval", "workstream", "assignee", "tag", "scopeName"],
    status: "statusText",
  },
  Defects: {
    about: "defects, with the test case and test plan they came from",
    columns: ["statusText", "priority", "testPlan", "testcaseName", "scopeName"],
    status: "statusText",
  },
  Tests: {
    about: "latest result per test case and test plan, one row per day",
    columns: ["status", "testPlan", "priority", "type", "testPlanStatus", "scopeName"],
    status: "status",
  },
  Features: {
    about: "features, one row per feature and requirement",
    columns: ["statusText", "priority", "workstream", "release", "scopeName"],
    status: "statusText",
  },
  ConfigurationItems: { about: "configuration and security analysis items" },
  QualityGates: { about: "quality gates" },
  StatusEvents: {
    about: "SAP service status events (try period C30D)",
    columns: ["eventType", "eventStatus", "serviceType"],
    status: "eventStatus",
  },
  Exceptions: { about: "exceptions from monitored systems" },
  Jobs: { about: "job runs from monitored systems" },
  Metrics: { about: "health metrics" },
  Requests: { about: "real user monitoring requests" },
  ServiceLevels: { about: "service levels (needs filters: a business service)" },
  ScenarioExecutions: { about: "synthetic user monitoring runs" },
  MonitoringEvents: { about: "monitoring events (needs filters: a business service)" },
  Messages: { about: "integration messages (IDoc, web service, Integration Suite…)" },
};

/** Averages, ratios and ids are not summed when grouping. */
const NOT_SUMMED = /avg|average|progress|percent|ratio|rate$|id$/i;
const FRESHNESS = "Analytics is refreshed daily and tenant-wide; calm_overview and calm_find give one project's live state.";

export async function analytics(
  calm: CloudAlm,
  input: { dataset?: AnalyticsDataset; groupBy?: string[]; filters?: Record<string, string>; period?: string; limit?: number },
) {
  if (!input.dataset)
    return [
      "Datasets (pass one as dataset; groupBy counts by columns, on the latest day; `status` means the dataset's status column; rows are tenant-wide):",
      ...Object.entries(DATASETS).map(([k, v]) => `- ${k}: ${v.about}${v.columns ? ` · group by: ${v.columns.join(", ")}` : ""}`),
    ].join("\n");
  const dataset = input.dataset;
  const info = DATASETS[dataset];
  // `status` (any case) stands for the dataset's status column; it is matched
  // here, case-insensitively, since Cloud ALM compares values exactly.
  const local: Record<string, string> = {};
  const remote: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.filters ?? {})) {
    if (key.toLowerCase() === "status" && info.status) local[info.status] = value;
    else remote[key] = value;
  }
  let result: Awaited<ReturnType<CloudAlm["queryAnalytics"]>>;
  try {
    result = await calm.queryAnalytics({
      dataset,
      ...(Object.keys(remote).length ? { filters: remote } : {}),
      ...(input.period ? { period: input.period } : {}),
      limit: 200,
    });
  } catch (error) {
    if (error instanceof CloudAlmError && error.code === "unavailable" && (error.status ?? 0) >= 500)
      return `${dataset}: not available on this tenant (SAP Cloud ALM answered ${error.status}). Other datasets may work; calm_analytics without dataset lists them.`;
    throw error;
  }
  const columnOf = (name: string) =>
    result.columns.find((c) => c === name) ??
    result.columns.find((c) => c.toLowerCase() === name.toLowerCase()) ??
    (name.toLowerCase() === "status" && info.status && result.columns.includes(info.status) ? info.status : undefined);
  const notes: string[] = [];
  let rows = result.rows;
  // Cloud ALM ignores filters on columns it does not have: say so.
  if (rows.length) {
    const ignored = Object.keys(remote).filter((k) => !result.columns.includes(k));
    if (ignored.length)
      notes.push(`Filter ${ignored.join(", ")} ignored: not a column of ${dataset} (columns: ${result.columns.join(", ")}). Rows are unfiltered by it.`);
  }
  for (const [column, value] of Object.entries(local)) {
    const v = value.trim().toLowerCase();
    rows = rows.filter((r) => String(r[column] ?? "").toLowerCase() === v);
  }
  if (!rows.length)
    return [
      `${dataset}: no rows${input.period ? "" : " (default period; try period C30D)"}${Object.keys(local).length ? ` with ${Object.entries(local).map(([c, v]) => `${c}=${v}`).join(", ")}` : ""}.`,
      ...notes,
    ].join("\n");
  const dates = [...new Set(rows.map((r) => r.date).filter((d): d is string => typeof d === "string" && !!d))].sort();
  const latest = dates.at(-1);
  const numeric = result.columns.filter((c) => rows.every((r) => r[c] === null || typeof r[c] === "number"));
  if (input.groupBy?.length) {
    const groupBy = input.groupBy.map((g) => columnOf(g) ?? g);
    const unknown = groupBy.filter((g) => !result.columns.includes(g));
    if (unknown.length)
      return `Unknown columns ${unknown.join(", ")}.${info.columns ? ` Group by: ${info.columns.join(", ")}.` : ""} All columns: ${result.columns.join(", ")}`;
    // Rows are daily snapshots: count the latest day only, never sum days.
    const day = dates.length > 1 && !groupBy.includes("date") ? rows.filter((r) => r.date === latest) : rows;
    const groups = new Map<string, Record<string, number>>();
    for (const r of day) {
      const key = groupBy.map((g) => String(r[g] ?? "—")).join(" · ");
      const acc = groups.get(key) ?? {};
      for (const c of numeric.filter((c) => !groupBy.includes(c) && !NOT_SUMMED.test(c))) acc[c] = (acc[c] ?? 0) + Number(r[c] ?? 0);
      groups.set(key, acc);
    }
    return [
      `${dataset} by ${groupBy.join(", ")}${latest && !groupBy.includes("date") ? `, as of ${latest}` : ""} (${day.length} rows${dates.length > 1 && !groupBy.includes("date") ? `, the latest of ${dates.length} daily snapshots` : ""}${result.truncated ? "; cut at 200 rows" : ""}):`,
      ...notes,
      ...[...groups.entries()].slice(0, input.limit ?? 50).map(([k, v]) => `- ${k}: ${Object.entries(v).filter(([, x]) => x).map(([c, x]) => `${c} ${Math.round(x * 100) / 100}`).join(", ") || "0"}`),
      FRESHNESS,
    ].join("\n");
  }
  const cols = result.columns.filter((c) => rows.some((r) => r[c] !== null && r[c] !== ""));
  // Columns equal on every row are printed once, not per row.
  const same = cols.filter((c) => rows.every((r) => r[c] === rows[0]?.[c]));
  const varying = cols.filter((c) => !same.includes(c));
  const cell = (v: unknown) => short(String(v), 60);
  const when = latest ? (dates.length > 1 ? `, daily snapshots ${dates[0]} to ${latest}` : `, as of ${latest}`) : "";
  return [
    `${dataset}: ${rows.length} rows${when}${result.truncated ? " (cut)" : ""}. Use groupBy to count${info.columns ? ` (e.g. ${info.columns.slice(0, 3).join(", ")})` : ""}.`,
    ...notes,
    same.length ? `All rows: ${same.map((c) => `${c}=${cell(rows[0]?.[c])}`).join("; ")}` : "",
    ...(varying.length ? rows.slice(0, input.limit ?? 10).map((r) => `- ${varying.map((c) => `${c}=${cell(r[c])}`).join("; ")}`) : []),
    FRESHNESS,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// calm_landscape
// ---------------------------------------------------------------------------

/** An event's text: its description (tags stripped, shortened), else its name. */
const eventText = (e: { name: string | null; description: string | null }) => {
  const text = (plainText(e.description, 1000) ?? "").replace(/\s+/g, " ").trim();
  return text ? `${short(text, 200)}${e.name ? ` (${e.name})` : ""}` : (e.name ?? "?");
};

export async function landscape(calm: CloudAlm) {
  const [objects, events] = await Promise.all([
    calm.listLandscapeObjects({ limit: 200 }),
    calm.listStatusEvents({ limit: 100 }).catch((e) => {
      if (e instanceof CloudAlmError && e.code === "forbidden") return null;
      throw e;
    }),
  ]);
  const lines = [`Landscape: ${objects.items.length} objects (${counts(objects.items.map((o) => o.objectType ?? "?"))})`];
  const label = (o: (typeof objects.items)[number]) =>
    o.serviceType && o.objectType === "CloudService" ? o.serviceType : (o.name ?? o.id);
  for (const o of objects.items.slice(0, 60))
    lines.push(`- ${label(o)} · ${o.objectType ?? "?"}${o.systemNumber ? ` · ${o.systemNumber}` : ""}${o.role ? ` · ${o.role}` : ""}${o.name && o.name !== label(o) && !/^[0-9a-f-]{36}$/.test(o.name) ? ` · ${o.name}` : ""}`);
  const bySystem = new Map(objects.items.filter((o) => o.systemNumber).map((o) => [o.systemNumber as string, label(o)]));
  if (!events) lines.push("", "Service status events: not readable with this key.");
  else {
    const isOpenEvent = (s: string | null) => !/closed|resolved|completed/i.test(s ?? "");
    const openEvents = events.items.filter((e) => isOpenEvent(e.status));
    lines.push("", `Service status events: ${openEvents.length} open, ${events.items.length - openEvents.length} closed (${counts(events.items.map((e) => e.type ?? "?"))})`);
    const recent = [...events.items].sort((x, y) => (y.startTime ?? "").localeCompare(x.startTime ?? ""));
    for (const e of [...openEvents, ...recent.filter((e) => !isOpenEvent(e.status)).slice(0, Math.max(0, 10 - openEvents.length))])
      lines.push(`- ${e.status ?? "?"} · ${e.type ?? "?"} · ${(e.systemNumber && bySystem.get(e.systemNumber)) || e.serviceType || e.serviceName || "?"} · ${e.startTime?.slice(0, 10) ?? ""}${e.endTime ? `–${e.endTime.slice(0, 10)}` : ""} · ${eventText(e)}`);
  }
  return lines.join("\n");
}
