/**
 * One project's items and the links between them, read in a few requests
 * (each list expands its links), for the opinionated tools. Parts are read
 * on demand, so a tool reads only what it needs, and each part is its own
 * operation (own request budget and deadline), so parts can be read in
 * parallel.
 *
 * `snapshotOf` keeps a snapshot per reader and project for a short while
 * (`SNAPSHOT_TTL_MS`), so an agent's follow-up calls do not re-read every
 * list. The cache hangs off the `CloudAlm` instance (a WeakMap keyed by it):
 * readers built per request or per token never share it.
 */
import {
  type CloudAlm,
  CloudAlmError,
  type Feature,
  type Project,
  type SolutionProcess,
  type TaskSummary,
  type TestCaseKind,
} from "../calm/index.js";
import {
  documentSummary,
  feature,
  PATHS,
  project,
  solutionProcess,
  taskSummary,
  testPlan,
} from "../calm/client.js";
import { bool, guid, num, type Row, rowOf, rowsOf, str } from "../calm/values.js";
import type { DocumentSummary, TestPlan } from "../calm/model.js";

/** Rows read per list; a project above this is reported as truncated. */
export const MAX_ROWS = 1000;
const PAGE = 200;
const ODATA_PAGE = 500;
/** How long a project's snapshot (and the project list) is reused. */
export const SNAPSHOT_TTL_MS = 45_000;

export type SnapTestCase = {
  id: string;
  displayId: string | null;
  title: string | null;
  kind: TestCaseKind;
  prepared: boolean | null;
  priority: number | null;
  taskIds: string[];
  /** Tag labels (manual test cases only; automated ones have none). */
  tags: string[];
  modifiedAt?: string | null;
};
export type SnapFeature = Feature & { taskIds: string[] };
export type SnapDocument = DocumentSummary & {
  taskIds: string[];
  testCaseIds: string[];
  processIds: string[];
};
export type Timebox = {
  id: string;
  name: string | null;
  type: number | null;
  startDate: string | null;
  endDate: string | null;
};

export type Part =
  | "tasks"
  | "features"
  | "documents"
  | "testCases"
  | "testPlans"
  | "processes"
  | "processLinks"
  | "timeboxes"
  | "testResults"
  | "defects";

/** A test case's latest result in one test plan (analytics `Tests`). */
export type TestResult = {
  plan: string;
  status: string;
  date: string;
  passed: number;
  failed: number;
  steps: number;
};

/** Defect ↔ test case links, from the analytics `Defects` dataset. */
export type DefectLinks = {
  /** Test case id → ids of the defects raised from it (lower case). */
  byTestCase: Map<string, string[]>;
  /** Defect (task) id → the test case it was raised from (lower case). */
  byDefect: Map<string, string>;
};

const children = (value: unknown): Row[] =>
  Array.isArray(value)
    ? (value as unknown[]).filter(
        (r): r is Row => !!r && typeof r === "object",
      )
    : [];
const ids = (rows: Row[], field: string) => [
  ...new Set(rows.map((r) => str(r[field])).filter((v): v is string => !!v)),
];
/** Tags as strings, whether Cloud ALM sends strings or `{label}` objects. */
const tagLabels = (value: unknown): string[] =>
  Array.isArray(value)
    ? (value as unknown[])
        .map((t) =>
          typeof t === "string"
            ? t
            : t && typeof t === "object"
              ? (str((t as Row).label) ?? str((t as Row).name) ?? str((t as Row).tag))
              : null,
        )
        .filter((t): t is string => !!t)
        .slice(0, 50)
    : [];

/** Run `fn` over `items`, at most `limit` at a time, keeping the order. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

export class Snapshot {
  readonly truncatedParts = new Set<Part>();
  get truncated() { return this.truncatedParts.size > 0; }

  complete(...parts: Part[]): boolean {
    return parts.every(part => !this.unavailable.has(part) && !this.failed.has(part) && !this.truncatedParts.has(part));
  }
  /** Parts the key may not read (403). */
  readonly unavailable = new Set<Part>();
  /** Optional parts whose read failed this time (not kept: retried next call). */
  readonly failed = new Set<Part>();
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(
    readonly calm: CloudAlm,
    readonly project: Project,
  ) {}

  /**
   * Read a part once. A 403 gives `empty` (the key lacks the scope). An
   * `optional` part (analytics enrichment) also gives `empty` on any other
   * Cloud ALM error, so it never breaks the answer. Failures are not kept.
   */
  private once<T>(key: Part, read: () => Promise<T>, empty: T, optional = false): Promise<T> {
    let hit = this.cache.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = read().then((value) => {
        this.failed.delete(key);
        return value;
      }, (error: unknown) => {
        if (error instanceof CloudAlmError && error.code === "forbidden") {
          this.unavailable.add(key);
          return empty;
        }
        // A failed read is not kept: the next call tries again.
        this.cache.delete(key);
        if (optional && error instanceof CloudAlmError) {
          this.failed.add(key);
          return empty;
        }
        throw error;
      });
      this.cache.set(key, hit);
    }
    return hit;
  }

  private get pid() {
    return this.project.id;
  }

  /** Every task of the project (all types), up to MAX_ROWS. */
  tasks(): Promise<TaskSummary[]> {
    return this.once(
      "tasks",
      () =>
        this.calm.operation(async (s) => {
          const out: TaskSummary[] = [];
          for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
            const rows = rowsOf(
              await s.get(PATHS.tasks, {
                projectId: this.pid,
                limit: PAGE,
                offset: offset || undefined,
              }),
            );
            out.push(...rows.map(taskSummary));
            if (rows.length < PAGE) return out;
          }
          this.truncatedParts.add("tasks");
          return out;
        }),
      [],
    );
  }

  /** An OData list of the project, paged (Cloud ALM caps `$top` at 500). */
  private odata(part: Part, path: string, query: Record<string, string>) {
    return this.calm.operation(async (s) => {
      const out: Row[] = [];
      for (let skip = 0; skip < MAX_ROWS; skip += ODATA_PAGE) {
        const rows = rowsOf(
          await s.get(path, {
            $filter: `projectId eq ${this.pid}`,
            ...query,
            $top: ODATA_PAGE,
            $skip: skip || undefined,
          }),
        );
        out.push(...rows);
        if (rows.length < ODATA_PAGE) return out;
      }
      this.truncatedParts.add(part);
      return out;
    });
  }

  features(): Promise<SnapFeature[]> {
    return this.once(
      "features",
      async () =>
        (
          await this.odata("features", PATHS.features, {
            $expand: "toTaskAssignments",
          })
        ).map((r) => ({
          ...feature(r),
          tags: tagLabels(r.tags),
          // The assignment's `uuid` is the task's id.
          taskIds: ids(children(r.toTaskAssignments), "uuid"),
        })),
      [],
    );
  }

  documents(): Promise<SnapDocument[]> {
    return this.once(
      "documents",
      async () =>
        (
          await this.odata("documents", PATHS.documents, {
            $select:
              "uuid,displayId,title,projectId,documentTypeCode,statusCode,isTemplate,version,modifiedAt",
            $expand:
              "toTaskAssignments,toTestCaseAssignments,toSolutionProcessAssignments",
          })
        ).map((r) => ({
          ...documentSummary(r),
          taskIds: ids(children(r.toTaskAssignments), "id"),
          testCaseIds: ids(children(r.toTestCaseAssignments), "testCaseUuid"),
          processIds: ids(
            children(r.toSolutionProcessAssignments),
            "solutionProcessId",
          ),
        })),
      [],
    );
  }

  testCases(): Promise<SnapTestCase[]> {
    return this.once(
      "testCases",
      async () => {
        // Manual and automated lists are independent: read both at once.
        const lists = await Promise.all(
          (["manual", "automated"] as const).map(async (kind) => {
            const rows = await this.odata("testCases",
              kind === "manual"
                ? PATHS.manualTestCases
                : PATHS.automatedTestCases,
              {
                $select: "uuid,displayId,title,isPrepared,priorityCode,modifiedAt",
                // Only manual test cases carry tags.
                $expand:
                  kind === "manual"
                    ? "toTaskAssignments,toTagAssignments"
                    : "toTaskAssignments",
              },
            );
            return rows.map(
              (r): SnapTestCase => ({
                id: str(r.uuid) ?? "",
                displayId: str(r.displayId),
                title: str(r.title),
                kind,
                prepared: bool(r.isPrepared),
                priority: num(r.priorityCode),
                taskIds: ids(children(r.toTaskAssignments), "taskId"),
                tags: tagLabels(children(r.toTagAssignments)),
                modifiedAt: str(r.modifiedAt),
              }),
            );
          }),
        );
        return lists.flat();
      },
      [],
    );
  }

  /** Test plans, each with the test cases assigned to it (the one source of plan membership). */
  testPlans(): Promise<(TestPlan & { testCaseIds: string[] })[]> {
    return this.once(
      "testPlans",
      async () =>
        (await this.odata("testPlans", PATHS.testPlans, { $expand: "toTestCaseAssignments($select=testCaseId)" })).map((r) => ({
          ...testPlan(r),
          testCaseIds: ids(children(r.toTestCaseAssignments), "testCaseId").map((x) => x.toLowerCase()),
        })),
      [],
    );
  }

  private projectPages(part: "processes" | "processLinks", path: string, size: number) {
    return this.calm.operation(async s => {
      const result: Row[] = [];
      while (result.length < MAX_ROWS) {
        const offset = result.length;
        const paging = part === "processes" ? { $top: size, $skip: offset } : { limit: size, offset };
        const rows = rowsOf(await s.get(path, { projectId: this.pid, ...paging }));
        result.push(...rows.slice(0, MAX_ROWS - offset));
        if (rows.length < size) return result;
      }
      this.truncatedParts.add(part);
      return result;
    });
  }

  processes(): Promise<SolutionProcess[]> {
    return this.once(
      "processes",
      () =>
        this.projectPages("processes", PATHS.solutionProcesses, ODATA_PAGE)
          .then(rows => rows.map(solutionProcess)),
      [],
    );
  }

  /** Task id → solution process ids (the Tasks service's assignment list). */
  processLinks(): Promise<Map<string, string[]>> {
    return this.once(
      "processLinks",
      () =>
        this.projectPages("processLinks", `${PATHS.tasks}/solutionProcessAssignments`, PAGE).then(rows => {
          const map = new Map<string, string[]>();
          for (const row of rows) {
            const task = str(row.taskId);
            const process = str(row.solutionProcessId);
            if (!task || !process) continue;
            const list = map.get(task) ?? [];
            if (!list.includes(process)) list.push(process);
            map.set(task, list);
          }
          return map;
        }),
      new Map(),
    );
  }

  timeboxes(): Promise<Timebox[]> {
    return this.once(
      "timeboxes",
      () =>
        this.calm.operation(async (s) =>
          rowsOf(await s.get(`${PATHS.projects}/${this.pid}/timeboxes`)).map(
            (r) => ({
              id: str(r.id) ?? "",
              name: str(r.name),
              type: typeof r.type === "number" ? r.type : null,
              startDate: str(r.startDate),
              endDate: str(r.endDate),
            }),
          ),
        ),
      [],
    );
  }

  /**
   * Latest result per test case and test plan, from the analytics `Tests`
   * dataset (today, else yesterday). Rows outside a test plan are skipped.
   */
  /**
   * Every row of an analytics dataset for this project (filtered by SAP),
   * in pages of 200, up to 1000 rows; beyond that the answer says it is cut.
   */
  private async analyticsRows(dataset: "Tests" | "Defects", period: string): Promise<Record<string, unknown>[]> {
    const filters = dataset === "Tests" ? { projectGUID: this.pid } : { project: this.pid };
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < 1000; offset += 200) {
      const result = await this.calm.queryAnalytics({ dataset, period, limit: 200, offset, filters });
      rows.push(...result.rows);
      if (!result.truncated) return rows;
    }
    this.truncatedParts.add(dataset === "Tests" ? "testResults" : "defects");
    return rows;
  }

  testResults(): Promise<Map<string, TestResult[]>> {
    return this.once(
      "testResults",
      async () => {
        const map = new Map<string, TestResult[]>();
        for (const period of ["C1D", "L1D"]) {
          for (const r of await this.analyticsRows("Tests", period)) {
            if (String(r.projectGUID ?? "").toLowerCase() !== this.pid.toLowerCase()) continue;
            const id = typeof r.testcaseId === "string" ? r.testcaseId : null;
            const plan = typeof r.testPlan === "string" ? r.testPlan : null;
            if (!id || !plan || plan === "(None)") continue;
            const list = map.get(id) ?? [];
            const date = String(r.date ?? "");
            const at = list.findIndex((x) => x.plan === plan);
            // Keep the latest row per test case and plan.
            if (at >= 0 && (list[at] as TestResult).date >= date) continue;
            if (at >= 0) list.splice(at, 1);
            list.push({
                plan,
                status: String(r.status ?? "?"),
                date,
                passed: Number(r.passedActions ?? 0),
                failed: Number(r.failedActions ?? 0),
                steps: Number(r.allActions ?? 0),
              });
            map.set(id, list);
          }
          if (map.size) break;
        }
        // A test case assigned to a plan but never run has no analytics row:
        // the plan's assignments say it is in the plan, not yet run.
        const plans = await this.testPlans().catch(() => {
          this.failed.add("testPlans");
          return [];
        });
        const byLower = new Map([...map.keys()].map((k) => [k.toLowerCase(), k]));
        for (const plan of plans)
          for (const tc of plan.testCaseIds) {
            const key = byLower.get(tc) ?? tc;
            const list = map.get(key) ?? [];
            if (list.some((r) => r.plan === plan.title)) continue;
            list.push({ plan: plan.title ?? "?", status: "Initial", date: "", passed: 0, failed: 0, steps: 0 });
            map.set(key, list);
          }
        return map;
      },
      new Map(),
      true,
    );
  }

  /**
   * Which test case each defect was raised from, from the analytics
   * `Defects` dataset (today, else yesterday). The Tasks API does not carry
   * this link.
   */
  defects(): Promise<DefectLinks> {
    return this.once(
      "defects",
      async () => {
        const links: DefectLinks = { byTestCase: new Map(), byDefect: new Map() };
        for (const period of ["C1D", "L1D"]) {
          const mine = (await this.analyticsRows("Defects", period)).filter(
            (r) => String(r.project ?? "").toLowerCase() === this.pid.toLowerCase(),
          );
          for (const r of mine) {
            const defect = typeof r.GUID === "string" ? r.GUID.toLowerCase() : null;
            const testCase =
              typeof r.testcaseId === "string" ? r.testcaseId.toLowerCase() : null;
            if (!defect || !testCase) continue;
            links.byDefect.set(defect, testCase);
            const list = links.byTestCase.get(testCase) ?? [];
            if (!list.includes(defect)) list.push(defect);
            links.byTestCase.set(testCase, list);
          }
          if (mine.length) break;
        }
        return links;
      },
      { byTestCase: new Map(), byDefect: new Map() },
      true,
    );
  }

  /** Relations of one task: type 10 = its requirement, 0 = a child. */
  relations(taskId: string): Promise<{ type: string; taskId: string }[]> {
    return this.calm
      .operation(async (s) =>
        rowsOf(await s.get(`${PATHS.tasks}/${guid(taskId, "task id")}/relations`)),
      )
      .then((rows) =>
        rows
          .map((r) => ({ type: String(r.type), taskId: str(r.relationTaskId) ?? "" }))
          .filter((r) => r.taskId),
      )
      .catch((error) => {
        if (error instanceof CloudAlmError && error.code === "forbidden")
          return [];
        throw error;
      });
  }
}

type ReaderCache = {
  projects?: { at: number; value: Promise<Project[]> };
  project: Map<string, { at: number; value: Promise<Project> }>;
  snapshots: Map<string, { at: number; snap: Snapshot }>;
};
/** Per reader (CloudAlm instance): gone with the reader, never shared. */
const caches = new WeakMap<CloudAlm, ReaderCache>();
function cacheOf(calm: CloudAlm): ReaderCache {
  let c = caches.get(calm);
  if (!c) {
    c = { project: new Map(), snapshots: new Map() };
    caches.set(calm, c);
  }
  return c;
}
const fresh = (at: number, now: number) => now - at < SNAPSHOT_TTL_MS;

/** Drop a reader's cached project list and snapshots (e.g. after a write). */
export function forgetSnapshots(calm: CloudAlm) {
  caches.delete(calm);
}

/** The tenant's projects, reused for a short while per reader. */
export function listProjects(calm: CloudAlm, now = Date.now()): Promise<Project[]> {
  const c = cacheOf(calm);
  if (c.projects && fresh(c.projects.at, now)) return c.projects.value;
  const value = calm.listProjects();
  const entry = { at: now, value };
  c.projects = entry;
  value.catch(() => {
    if (c.projects === entry) delete c.projects;
  });
  return value;
}

/**
 * The project's snapshot, reused for `SNAPSHOT_TTL_MS` per reader: parts
 * it has read stay read until it expires.
 */
export function snapshotOf(calm: CloudAlm, project: Project, now = Date.now()): Snapshot {
  const c = cacheOf(calm);
  const hit = c.snapshots.get(project.id);
  if (hit && fresh(hit.at, now)) return hit.snap;
  for (const [id, entry] of c.snapshots)
    if (!fresh(entry.at, now)) c.snapshots.delete(id);
  const snap = new Snapshot(calm, project);
  c.snapshots.set(project.id, { at: now, snap });
  return snap;
}

/** The project a tool works on: the given one, the configured default, or the only one. */
export async function resolveProject(
  calm: CloudAlm,
  projectId: string | undefined,
  defaultProject: string | undefined,
  now = Date.now(),
): Promise<{ project: Project; others: Project[] }> {
  const wanted = projectId ?? defaultProject;
  // A name instead of a GUID: look it up in the project list.
  if (wanted && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wanted.trim())) {
    const all = await listProjects(calm, now);
    const name = wanted.trim().toLowerCase();
    const hits = all.filter((p) => (p.name ?? "").toLowerCase() === name);
    const near = hits.length ? hits : all.filter((p) => (p.name ?? "").toLowerCase().includes(name));
    if (near.length === 1) return { project: near[0] as Project, others: [] };
    throw new CloudAlmError(
      near.length ? "bad_request" : "not_found",
      `${near.length ? `several projects match "${wanted}"` : `no project named "${wanted}"`}; use calm_projects to search. Candidates: ${(near.length ? near : all)
        .slice(0, 20)
        .map((p) => `${p.name ?? "?"} = ${p.id}`)
        .join("; ")}`,
    );
  }
  if (wanted) {
    const id = guid(wanted, "projectId");
    const c = cacheOf(calm);
    const hit = c.project.get(id);
    if (hit && fresh(hit.at, now)) return { project: await hit.value, others: [] };
    const value = calm.operation(async (s) =>
      project(rowOf(await s.get(`${PATHS.projects}/${id}`))),
    );
    const entry = { at: now, value };
    c.project.set(id, entry);
    value.catch(() => {
      if (c.project.get(id) === entry) c.project.delete(id);
    });
    return { project: await value, others: [] };
  }
  const all = await listProjects(calm, now);
  if (!all.length)
    throw new CloudAlmError("not_found", "the tenant has no project");
  if (all.length > 1)
    throw new CloudAlmError(
      "bad_request",
      `the tenant has ${all.length} projects; pass projectId: ${all
        .slice(0, 20)
        .map((p) => `${p.name ?? "?"} = ${p.id}`)
        .join("; ")}`,
    );
  return { project: all[0] as Project, others: [] };
}
