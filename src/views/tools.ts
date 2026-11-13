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
  type Part,
  resolveProject,
  type SnapDocument,
  type SnapFeature,
  Snapshot,
  type SnapTestCase,
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
  short,
  statusLabel,
  taskLine,
  resultText,
  testCaseLine,
  typeLabel,
} from "./text.js";

export type ViewOptions = {
  /** Project used when a call names none (else: the tenant's only project). */
  defaultProject?: string;
  /** Today, for "current" phase; tests pass a fixed date. */
  today?: () => string;
};

async function snapshotFor(calm: CloudAlm, projectId: string | undefined, o: ViewOptions) {
  const { project } = await resolveProject(calm, projectId, o.defaultProject);
  return new Snapshot(calm, project);
}

function footer(snap: Snapshot, parts: Part[]): string[] {
  const out: string[] = [];
  const missing = parts.filter((p) => snap.unavailable.has(p));
  if (missing.length)
    out.push(`Not readable with this key (missing scope): ${missing.join(", ")}.`);
  if (snap.truncated) out.push(`Some lists were cut at 1000 rows; counts are lower bounds.`);
  return out;
}

const projectLabel = (p: Project) => `${p.name ?? "?"} [${p.id}]`;

// ---------------------------------------------------------------------------
// calm_overview
// ---------------------------------------------------------------------------

export async function overview(calm: CloudAlm, input: { projectId?: string }, o: ViewOptions = {}) {
  const projects = await calm.listProjects();
  const lines: string[] = [];
  if (!input.projectId && !o.defaultProject && projects.length !== 1) {
    lines.push(`${projects.length} projects. Pass projectId for one project's overview:`);
    for (const p of projects.slice(0, 50))
      lines.push(`- ${projectLabel(p)} · ${(p.purpose ?? "").toLowerCase()} · status ${p.status ?? "?"}`);
    return lines.join("\n");
  }
  const snap = await snapshotFor(calm, input.projectId, o);
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
  if (features.length) lines.push(`Features: ${features.length} (${counts(features.map((f) => featureStatus(f.statusCode)))})`);
  const manual = testCases.filter((t) => t.kind === "manual");
  const automated = testCases.filter((t) => t.kind === "automated");
  lines.push(
    `Test cases: ${manual.length} manual (${manual.filter((t) => t.prepared).length} prepared), ${automated.length} automated · test plans: ${testPlans.length}${testPlans.length ? ` (${testPlans.slice(0, 3).map((t) => `${t.displayId} "${short(t.title, 50)}"`).join(", ")})` : ""}`,
  );
  const latest = [...results.values()].flat();
  if (latest.length)
    lines.push(`Test results (latest per test case and plan): ${counts(latest.map((r) => r.status.toLowerCase()))}`);
  lines.push(`Documents: ${documents.length}${documents.length ? ` (${counts(documents.map((d) => documentType(d.documentTypeCode)))})` : ""}`);
  const tags = counts(tasks.flatMap((t) => t.tags));
  if (tags) lines.push(`Tags: ${tags}`);
  // Gaps in one line; calm_gaps lists them.
  const tested = new Set(testCases.flatMap((t) => t.taskIds));
  const reqs = tasks.filter((t) => t.type === "CALMREQU" || t.type === "CALMUS");
  const untested = reqs.filter((t) => !tested.has(t.id)).length;
  const noProcess = tasks.filter((t) => t.type === "CALMREQU" && !processLinks.get(t.id)?.length).length;
  const orphans = testCases.filter((t) => !t.taskIds.length).length;
  lines.push(
    `Gaps: ${untested} of ${reqs.length} requirements/user stories without a test case · ${noProcess} requirements without a solution process · ${orphans} test cases linked to no task (calm_gaps lists them)`,
  );
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
  const types = new Set<FindType>(input.types?.length ? input.types : FIND_TYPES.filter((t) => !t.match(/application|development|interface|configuration/)));
  const match = matcher(input.query);
  const status = input.status?.toLowerCase().trim();
  const tag = input.tag?.toLowerCase().trim();
  const statusOk = (label: string) =>
    !status || (status === "open" ? !["done", "not relevant", "tested", "deployed", "confirmed"].includes(label) : label.includes(status));
  const snap = await snapshotFor(calm, input.projectId, o);
  const hits: Hit[] = [];
  const parts: Part[] = [];
  const taskTypes = [...types].filter((t) => t in TASK_FIND);
  if (taskTypes.length) {
    parts.push("tasks");
    const named = new Set(Object.values(TASK_FIND).flatMap((v) => v ?? []));
    for (const t of await snap.tasks()) {
      const wanted = taskTypes.some((k) => {
        const codes = TASK_FIND[k];
        return codes ? codes.includes(t.type ?? "") : !named.has(t.type ?? "");
      });
      if (!wanted || !match(t.title, ...t.tags) || !statusOk(statusLabel(t.status))) continue;
      if (tag && !t.tags.some((x) => x.toLowerCase() === tag)) continue;
      hits.push({ sort: `1${t.type}`, displayId: t.displayId, line: taskLine(t) });
    }
  }
  if (!tag) {
    if (types.has("feature")) {
      parts.push("features");
      for (const f of await snap.features())
        if (match(f.title, ...f.tags) && statusOk(featureStatus(f.statusCode)))
          hits.push({ sort: "2", displayId: f.displayId, line: featureLine(f) });
    }
    if (types.has("document") && !status) {
      parts.push("documents");
      for (const d of await snap.documents())
        if (match(d.title)) hits.push({ sort: "3", displayId: d.displayId, line: documentLine(d) });
    }
    if (types.has("test_case") && !status) {
      parts.push("testCases");
      const results = await snap.testResults();
      for (const t of await snap.testCases())
        if (match(t.title)) hits.push({ sort: "4", displayId: t.displayId, line: testCaseLine(t, results.get(t.id)) });
    }
    if (types.has("test_plan") && !status) {
      parts.push("testPlans");
      for (const t of await snap.testPlans())
        if (match(t.title))
          hits.push({ sort: "5", displayId: t.displayId, line: `${t.displayId} · test plan · "${short(t.title)}"${t.startDate ? ` · ${t.startDate}–${t.endDate ?? ""}` : ""}` });
    }
    if (types.has("process") && !status) {
      parts.push("processes");
      for (const p of await snap.processes())
        if (match(p.name)) hits.push({ sort: "6", displayId: null, line: `${p.id} · solution process · ${p.isScoped ? "in scope" : "not in scope"} · "${short(p.name)}"` });
    }
    for (const kind of LIBRARY_KINDS) {
      if (!types.has(kind.replace(/s$/, "") as FindType)) continue;
      const page = await calm.listLibraryItems(kind as LibraryKind, { limit: 200 }).catch((e) => {
        if (e instanceof CloudAlmError && e.code === "forbidden") return null;
        throw e;
      });
      for (const item of page?.items ?? [])
        if (match(item.title, item.objectId, item.description))
          hits.push({ sort: `7${kind}`, displayId: item.displayId, line: `${item.displayId ?? item.id} · ${kind.replace(/s$/, "")} · "${short(item.title)}"${item.objectId ? ` · ${item.objectId}` : ""}` });
    }
  }
  hits.sort((a, b) => a.sort.localeCompare(b.sort) || byDisplayId(a, b));
  const shown = hits.slice(offset, offset + limit);
  const lines = [
    `${hits.length} match${hits.length === 1 ? "" : "es"} in ${snap.project.name ?? "the project"}${hits.length > shown.length ? ` (showing ${offset + 1}–${offset + shown.length}; more with offset ${offset + shown.length})` : ""}${tag && types.size > taskTypes.length ? " (tags exist on tasks only)" : ""}${status && types.size > taskTypes.length + 1 ? " (status filters tasks and features only)" : ""}`,
    ...shown.map((h) => `- ${h.line}`),
  ];
  if (hits.length) lines.push("calm_get takes these ids (several at once); calm_trace shows an item's links.");
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
  | { kind: "test plan"; id: string; displayId: string | null }
  | { kind: "process"; id: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolve(snap: Snapshot, raw: string): Promise<Ref> {
  const ref = raw.trim().replace(/^\[|\]$/g, "");
  const byId = (x: { id: string; displayId: string | null }) =>
    GUID.test(ref) ? x.id.toLowerCase() === ref.toLowerCase() : x.displayId === ref;
  if (/^ERL-|^[A-Z]{2,}-[0-9a-f]{20,}$/i.test(ref)) return { kind: "process", id: ref };
  if (!GUID.test(ref) && !/^\d+(-\d+)+$/.test(ref))
    throw new CloudAlmError("bad_request", `"${ref.slice(0, 40)}" is not an id; use a display id like 3-17 or 8-1-2, or a GUID`);
  const prefix = ref.split("-")[0];
  const guidRef = GUID.test(ref);
  if (guidRef || prefix === "3") {
    const t = (await snap.tasks()).find(byId);
    if (t) return { kind: "task", task: t };
  }
  if (guidRef || prefix === "6") {
    const f = (await snap.features()).find(byId);
    if (f) return { kind: "feature", feature: f };
  }
  if (guidRef || prefix === "7") {
    const d = (await snap.documents()).find(byId);
    if (d) return { kind: "document", document: d };
  }
  if (guidRef || prefix === "8") {
    const t = (await snap.testCases()).find(byId);
    if (t) return { kind: "test case", testCase: t };
    const p = (await snap.testPlans()).find(byId);
    if (p) return { kind: "test plan", id: p.id, displayId: p.displayId };
  }
  throw new CloudAlmError("not_found", `${ref} not found in project ${snap.project.name ?? snap.project.id}`);
}

/** Names for linked ids, from the snapshot. */
async function namer(snap: Snapshot) {
  const [tasks, features, documents, testCases, processes, results] = await Promise.all([
    snap.tasks(),
    snap.features(),
    snap.documents(),
    snap.testCases(),
    snap.processes(),
    snap.testResults(),
  ]);
  const task = new Map(tasks.map((t) => [t.id, t]));
  return {
    tasks,
    features,
    documents,
    testCases,
    task: (id: string) => {
      const t = task.get(id);
      return t ? `${t.displayId} ${typeLabel(t.type)} "${short(t.title, 70)}" (${statusLabel(t.status)})` : `[${id}]`;
    },
    feature: (f: SnapFeature) => `${f.displayId} "${short(f.title, 70)}" (${featureStatus(f.statusCode)})`,
    results,
    testCase: (t: SnapTestCase) => {
      const r = resultText(results.get(t.id));
      return `${t.displayId} "${short(t.title, 70)}"${t.kind === "automated" ? " (automated)" : ""}${r ? ` (${r})` : ""}`;
    },
    document: (d: SnapDocument) => `${d.displayId} "${short(d.title, 70)}" (${documentType(d.documentTypeCode)})`,
    process: (id: string) => processes.find((p) => p.id === id)?.name ?? id,
  };
}

// ---------------------------------------------------------------------------
// calm_get
// ---------------------------------------------------------------------------

export async function get(calm: CloudAlm, input: { ids: string[]; projectId?: string }, o: ViewOptions = {}) {
  const snap = await snapshotFor(calm, input.projectId, o);
  const names = await namer(snap);
  const links = await snap.processLinks();
  const out: string[] = [];
  for (const raw of input.ids.slice(0, 10)) {
    try {
      out.push(await getOne(calm, snap, names, links, raw));
    } catch (error) {
      if (!(error instanceof CloudAlmError)) throw error;
      out.push(`${raw}: ${error.code} — ${error.reason}`);
    }
  }
  return out.join("\n\n---\n\n");
}

async function getOne(
  calm: CloudAlm,
  snap: Snapshot,
  n: Awaited<ReturnType<typeof namer>>,
  processLinks: Map<string, string[]>,
  raw: string,
): Promise<string> {
  const ref = await resolve(snap, raw);
  const lines: string[] = [];
  const list = (label: string, items: string[]) => {
    if (items.length) lines.push(`${label}: ${items.join("; ")}`);
  };
  if (ref.kind === "task") {
    const t = await calm.getTask(ref.task.id, { links: false });
    lines.push(
      `${t.displayId} ${typeLabel(t.type)} · ${statusLabel(t.status)}${t.subStatus ? ` (${t.subStatus})` : ""}${t.priority !== null ? ` · priority ${t.priority}` : ""} · "${t.title}" [${t.id}]`,
      [t.scopeName && `scope ${t.scopeName}`, t.timeboxName && `phase ${t.timeboxName}`, t.assigneeName && `assignee ${t.assigneeName}`, t.dueDate && `due ${t.dueDate}`, t.tags.length && `tags ${t.tags.join(", ")}`, t.createdAt && `created ${t.createdAt.slice(0, 10)}`]
        .filter(Boolean)
        .join(" · "),
    );
    if (t.description) lines.push("", t.description, "");
    const relations = await snap.relations(t.id);
    list("Requirement", relations.filter((r) => r.type === "10").map((r) => n.task(r.taskId)));
    list("User stories / tasks under it", relations.filter((r) => r.type === "0").map((r) => n.task(r.taskId)));
    list("Test cases", n.testCases.filter((x) => x.taskIds.includes(t.id)).map(n.testCase));
    list("Features", n.features.filter((f) => f.taskIds.includes(t.id)).map(n.feature));
    list("Documents", n.documents.filter((d) => d.taskIds.includes(t.id)).map(n.document));
    list("Solution processes", (processLinks.get(t.id) ?? []).map(n.process));
    if (t.externalReferences.length) list("References", t.externalReferences.map((r) => `${r.name ?? ""} ${r.url ?? ""}`.trim()));
    if (t.comments.length) lines.push(`Comments:`, ...t.comments.map((c) => `- ${c.createdAt?.slice(0, 10) ?? ""} ${c.author ?? ""}: ${c.text ?? ""}`));
  } else if (ref.kind === "feature") {
    const f = await calm.getFeature(ref.feature.id);
    lines.push(`${f.displayId} feature · ${featureStatus(f.statusCode)}${f.priorityCode !== null ? ` · priority ${f.priorityCode}` : ""} · "${f.title}" [${f.id}]`);
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
    if (tc.kind === "manual") {
      const t = await calm.getTestCase(tc.id);
      lines.push(`${t.displayId} manual test case · ${t.isPrepared ? "prepared" : "not prepared"}${t.priorityCode !== null ? ` · priority ${t.priorityCode}` : ""} · "${t.title}" [${t.id}]`);
      list("Covers", tc.taskIds.map(n.task));
      const result = resultText(n.results.get(tc.id));
      if (result) lines.push(`Latest result: ${result}`);
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
      lines.push(`${tc.displayId} automated test case · "${tc.title}" [${tc.id}]`);
      list("Covers", tc.taskIds.map(n.task));
    }
  } else if (ref.kind === "test plan") {
    const p = await calm.getTestPlan(ref.id);
    lines.push(`${p.displayId} test plan · "${p.title}" [${p.id}]${p.startDate ? ` · ${p.startDate}–${p.endDate ?? ""}` : ""}`);
    if (p.description) lines.push(p.description);
    lines.push(`Test cases (${p.testCases.length}):`, ...p.testCases.map((t) => `- ${t.displayId} "${short(t.title, 80)}"`));
  } else {
    const tasks = [...processLinks.entries()].filter(([, ps]) => ps.includes(ref.id)).map(([id]) => id);
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
  const n = await namer(snap);
  const processLinks = await snap.processLinks();
  const ref = await resolve(snap, input.id);
  const taskById = new Map(n.tasks.map((t) => [t.id, t]));
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
  const groups = new Map<string, Set<string>>();
  for (const id of start.slice(0, 30)) {
    const rel = await snap.relations(id);
    const parent = rel.find((r) => r.type === "10")?.taskId;
    const reqId = taskById.get(id)?.type === "CALMREQU" ? id : (parent ?? id);
    const group = groups.get(reqId) ?? new Set<string>();
    groups.set(reqId, group);
    if (reqId === id) for (const r of rel.filter((r) => r.type === "0")) group.add(r.taskId);
    else group.add(id);
  }
  const transports = new Map<string, string[]>();
  const featureOf = (taskId: string) => n.features.filter((f) => f.taskIds.includes(taskId));
  for (const f of new Set([...groups].flatMap(([r, kids]) => [r, ...kids]).flatMap(featureOf)))
    if (transports.size < 10) transports.set(f.id, (await calm.getFeature(f.id)).transports);
  const lines = [`Trace of ${head}`];
  const describe = (taskId: string, indent: string) => {
    const t = taskById.get(taskId);
    const out = [`${indent}${n.task(taskId)}${t?.tags.length ? ` #${t.tags.join(" #")}` : ""}`];
    const sub = `${" ".repeat(indent.length)}  `;
    const ps = processLinks.get(taskId) ?? [];
    if (ps.length) out.push(`${sub}process: ${ps.map(n.process).join("; ")}`);
    for (const f of featureOf(taskId)) {
      const tr = transports.get(f.id);
      out.push(`${sub}feature: ${n.feature(f)} · transports: ${tr ? (tr.length ? tr.join(", ") : "none") : "not read"}`);
    }
    const tcs = n.testCases.filter((x) => x.taskIds.includes(taskId));
    out.push(`${sub}test cases: ${tcs.length ? tcs.map(n.testCase).join("; ") : "NONE"}`);
    const docs = n.documents.filter((d) => d.taskIds.includes(taskId));
    if (docs.length) out.push(`${sub}documents: ${docs.map(n.document).join("; ")}`);
    return out;
  };
  for (const [reqId, kids] of groups) {
    lines.push(...describe(reqId, "- "));
    for (const kid of kids) lines.push(...describe(kid, "    - "));
  }
  if (!groups.size) lines.push("No linked tasks.");
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
  const [tasks, features, testCases, processLinks, results] = await Promise.all([
    snap.tasks(),
    snap.features(),
    snap.testCases(),
    snap.processLinks(),
    checks.has("failed_tests") ? snap.testResults() : Promise.resolve(new Map()),
  ]);
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
    const items: string[] = [];
    for (const t of missing) {
      let note = "";
      if (t.type === "CALMREQU") {
        const kids = (await snap.relations(t.id)).filter((r) => r.type === "0").map((r) => r.taskId);
        const covered = kids.filter((k) => tested.has(k)).length;
        if (kids.length) note = ` (user stories under it with a test case: ${covered} of ${kids.length})`;
      }
      items.push(`${taskLine(t)}${note}`);
    }
    section("Without a test case", items, "calm_get shows a task's description to draft one");
  }
  if (checks.has("failed_tests")) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const failed = testCases.filter((t) => results.get(t.id)?.some((r: { status: string }) => /fail/i.test(r.status)));
    section(
      "Test cases whose latest run failed",
      failed.sort(byDisplayId).map((t) => `${testCaseLine(t, results.get(t.id))}${t.taskIds.length ? ` — covers ${t.taskIds.map((id) => byId.get(id)?.displayId ?? id).join(", ")}` : ""}`),
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
          items.push(`${featureLine(f)} — ${untested.length} of ${f.taskIds.length} tasks it delivers have no test case: ${untested.map((id) => tasks.find((t) => t.id === id)?.displayId ?? id).join(", ")}`);
      }
    }
    section("Features with a gap", items);
  }
  if (checks.has("orphan_tests"))
    section("Test cases linked to no task", testCases.filter((t) => !t.taskIds.length).sort(byDisplayId).map((t) => testCaseLine(t)));
  if (checks.has("unprepared_tests"))
    section("Test cases not prepared", testCases.filter((t) => t.kind === "manual" && t.prepared === false).sort(byDisplayId).map((t) => testCaseLine(t)));
  lines.push("", "Links counted: test case → task (Test Management), feature → task, task → solution process. Direct links only.");
  lines.push(...footer(snap, ["tasks", "features", "testCases", "processLinks", "testResults"]));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// calm_analytics
// ---------------------------------------------------------------------------

const DATASETS: Record<AnalyticsDataset, string> = {
  Projects: "projects and their status",
  Tasks: "tasks of every type, one row per task (status, phase, processor, tag, overdue)",
  Requirements: "requirements",
  Defects: "defects",
  Tests: "test executions and results",
  Features: "features and their status",
  ConfigurationItems: "configuration and security analysis items",
  QualityGates: "quality gates",
  StatusEvents: "SAP service status events",
  Exceptions: "exceptions from monitored systems",
  Jobs: "job runs from monitored systems",
  Metrics: "health metrics",
  Requests: "real user monitoring requests",
  ServiceLevels: "service levels (needs filters: a business service)",
  ScenarioExecutions: "synthetic user monitoring runs",
  MonitoringEvents: "monitoring events (needs filters: a business service)",
  Messages: "integration messages (IDoc, web service, Integration Suite…)",
};

export async function analytics(
  calm: CloudAlm,
  input: { dataset?: AnalyticsDataset; groupBy?: string[]; filters?: Record<string, string>; period?: string; limit?: number },
) {
  if (!input.dataset)
    return [
      "Datasets (pass one as dataset; group_by sums the counters; rows are tenant-wide):",
      ...Object.entries(DATASETS).map(([k, v]) => `- ${k}: ${v}`),
    ].join("\n");
  const result = await calm.queryAnalytics({
    dataset: input.dataset,
    ...(input.filters ? { filters: input.filters } : {}),
    ...(input.period ? { period: input.period } : {}),
    limit: 200,
  });
  const rows = result.rows;
  if (!rows.length) return `${input.dataset}: no rows${input.period ? "" : " (default period; try period C30D)"}.`;
  const numeric = result.columns.filter((c) => rows.every((r) => r[c] === null || typeof r[c] === "number"));
  if (input.groupBy?.length) {
    const unknown = input.groupBy.filter((g) => !result.columns.includes(g));
    if (unknown.length) return `Unknown columns ${unknown.join(", ")}. Columns: ${result.columns.join(", ")}`;
    const groups = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const key = input.groupBy.map((g) => String(r[g] ?? "—")).join(" · ");
      const acc = groups.get(key) ?? {};
      for (const c of numeric.filter((c) => !input.groupBy?.includes(c))) acc[c] = (acc[c] ?? 0) + Number(r[c] ?? 0);
      groups.set(key, acc);
    }
    return [
      `${input.dataset} by ${input.groupBy.join(", ")} (${rows.length} rows${result.truncated ? ", cut at 200" : ""}):`,
      ...[...groups.entries()].slice(0, input.limit ?? 50).map(([k, v]) => `- ${k}: ${Object.entries(v).filter(([, x]) => x).map(([c, x]) => `${c} ${Math.round(x * 100) / 100}`).join(", ")}`),
    ].join("\n");
  }
  const cols = result.columns.filter((c) => rows.some((r) => r[c] !== null && r[c] !== ""));
  // Columns equal on every row are printed once, not per row.
  const same = cols.filter((c) => rows.every((r) => r[c] === rows[0]?.[c]));
  const varying = cols.filter((c) => !same.includes(c));
  const cell = (v: unknown) => short(String(v), 60);
  return [
    `${input.dataset}: ${rows.length} rows${result.truncated ? " (cut)" : ""}. Use groupBy to count.`,
    same.length ? `All rows: ${same.map((c) => `${c}=${cell(rows[0]?.[c])}`).join("; ")}` : "",
    ...rows.slice(0, input.limit ?? 10).map((r) => `- ${varying.map((c) => `${c}=${cell(r[c])}`).join("; ")}`),
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// calm_landscape
// ---------------------------------------------------------------------------

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
      lines.push(`- ${e.status ?? "?"} · ${e.type ?? "?"} · ${(e.systemNumber && bySystem.get(e.systemNumber)) || e.serviceType || e.serviceName || "?"} · ${e.startTime?.slice(0, 10) ?? ""}${e.endTime ? `–${e.endTime.slice(0, 10)}` : ""} · ${short(e.name, 80)}`);
  }
  return lines.join("\n");
}
