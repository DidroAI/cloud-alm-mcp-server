/**
 * One project's items and the links between them, read in a few requests
 * (each list expands its links), for the opinionated tools. Parts are read
 * on demand, so a tool reads only what it needs.
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
import { bool, guid, type Row, rowOf, rowsOf, str } from "../calm/values.js";
import type { DocumentSummary, TestPlan } from "../calm/model.js";

/** Rows read per list; a project above this is reported as truncated. */
export const MAX_ROWS = 1000;
const PAGE = 200;
const ODATA_PAGE = 500;

export type SnapTestCase = {
  id: string;
  displayId: string | null;
  title: string | null;
  kind: TestCaseKind;
  prepared: boolean | null;
  taskIds: string[];
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
  | "timeboxes";

const children = (value: unknown): Row[] =>
  Array.isArray(value)
    ? (value as unknown[]).filter(
        (r): r is Row => !!r && typeof r === "object",
      )
    : [];
const ids = (rows: Row[], field: string) => [
  ...new Set(rows.map((r) => str(r[field])).filter((v): v is string => !!v)),
];

export class Snapshot {
  truncated = false;
  /** Parts the key may not read (403). */
  readonly unavailable = new Set<Part>();
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(
    readonly calm: CloudAlm,
    readonly project: Project,
  ) {}

  private once<T>(key: Part, read: () => Promise<T>, empty: T): Promise<T> {
    let hit = this.cache.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = read().catch((error) => {
        if (error instanceof CloudAlmError && error.code === "forbidden") {
          this.unavailable.add(key);
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
          this.truncated = true;
          return out;
        }),
      [],
    );
  }

  /** An OData list of the project, paged (Cloud ALM caps `$top` at 500). */
  private odata(path: string, query: Record<string, string>) {
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
      this.truncated = true;
      return out;
    });
  }

  features(): Promise<SnapFeature[]> {
    return this.once(
      "features",
      async () =>
        (
          await this.odata(PATHS.features, {
            $expand: "toTaskAssignments",
          })
        ).map((r) => ({
          ...feature(r),
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
          await this.odata(PATHS.documents, {
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
        const out: SnapTestCase[] = [];
        for (const kind of ["manual", "automated"] as const) {
          const rows = await this.odata(
            kind === "manual"
              ? PATHS.manualTestCases
              : PATHS.automatedTestCases,
            {
              $select: "uuid,displayId,title,isPrepared",
              $expand: "toTaskAssignments",
            },
          );
          for (const r of rows)
            out.push({
              id: str(r.uuid) ?? "",
              displayId: str(r.displayId),
              title: str(r.title),
              kind,
              prepared: bool(r.isPrepared),
              taskIds: ids(children(r.toTaskAssignments), "taskId"),
            });
        }
        return out;
      },
      [],
    );
  }

  testPlans(): Promise<TestPlan[]> {
    return this.once(
      "testPlans",
      async () => (await this.odata(PATHS.testPlans, {})).map(testPlan),
      [],
    );
  }

  processes(): Promise<SolutionProcess[]> {
    return this.once(
      "processes",
      () =>
        this.calm.operation(async (s) =>
          rowsOf(
            await s.get(PATHS.solutionProcesses, {
              projectId: this.pid,
              $top: ODATA_PAGE,
            }),
          ).map(solutionProcess),
        ),
      [],
    );
  }

  /** Task id → solution process ids (the Tasks service's assignment list). */
  processLinks(): Promise<Map<string, string[]>> {
    return this.once(
      "processLinks",
      () =>
        this.calm.operation(async (s) => {
          const map = new Map<string, string[]>();
          for (const r of rowsOf(
            await s.get(`${PATHS.tasks}/solutionProcessAssignments`, {
              projectId: this.pid,
            }),
          )) {
            const task = str(r.taskId);
            const process = str(r.solutionProcessId);
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

/** The project a tool works on: the given one, the configured default, or the only one. */
export async function resolveProject(
  calm: CloudAlm,
  projectId: string | undefined,
  defaultProject: string | undefined,
): Promise<{ project: Project; others: Project[] }> {
  const wanted = projectId ?? defaultProject;
  if (wanted) {
    const id = guid(wanted, "projectId");
    const row = await calm.operation(async (s) =>
      rowOf(await s.get(`${PATHS.projects}/${id}`)),
    );
    return { project: project(row), others: [] };
  }
  const all = await calm.listProjects();
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
