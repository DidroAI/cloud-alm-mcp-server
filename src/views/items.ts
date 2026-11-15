/**
 * Helpers shared by the write tools: the project snapshot, resolving
 * display ids of any kind, dry-run wording, plain text to HTML, and the
 * scope a 403 means.
 */
import { type CloudAlm, CloudAlmError, type TaskSummary } from "../calm/index.js";
import { type Row, rowOf } from "../calm/values.js";
import { escapeHtml } from "./html.js";
import { resolveProject, type SnapDocument, type SnapFeature, Snapshot, type SnapTestCase } from "./snapshot.js";
import { short, typeLabel } from "./text.js";
import type { ViewOptions } from "./tools.js";

export type WriteOptions = ViewOptions & {
  /** "dry-run": every write tool answers with what it would send. */
  writeMode?: "on" | "dry-run";
};

export const textToHtml = (text: string) =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.replace(/\s*\n\s*/g, " "))}</p>`)
    .join("");

export async function snapshot(calm: CloudAlm, projectId: string | undefined, o: WriteOptions) {
  const { project } = await resolveProject(calm, projectId, o.defaultProject);
  return new Snapshot(calm, project);
}

const clean = (raw: string) => raw.trim().replace(/^\[|\]$/g, "");
const matches = (ref: string, x: { id: string; displayId: string | null }) =>
  x.displayId === ref || x.id.toLowerCase() === ref.toLowerCase();

/** A code written in titles, like REQ-03, FEAT-02 or O2C-11 (not a display id like 3-17). */
export const TITLE_CODE = /^[A-Z][A-Z0-9]{0,9}-\d{1,5}$/i;

type Titled = { id: string; displayId: string | null; title: string | null };

/**
 * The one item whose title carries `code` as a word ("[seed] REQ-03 Credit…").
 * Several: the one whose title starts with it; still several or none: an
 * error that names the candidates or the way out.
 */
export function byTitleCode<T extends Titled>(code: string, items: T[]): T {
  const esc = code.replace(/[-]/g, "\\-");
  const word = new RegExp(`(^|[^A-Za-z0-9-])${esc}(?![A-Za-z0-9]|-\\d)`, "i");
  const lead = new RegExp(`^(\\[[^\\]]*\\]\\s*)?${esc}(?![A-Za-z0-9]|-\\d)`, "i");
  let found = items.filter((x) => word.test(x.title ?? ""));
  if (found.length > 1) {
    const leading = found.filter((x) => lead.test(x.title ?? ""));
    if (leading.length) found = leading;
  }
  if (found.length === 1) return found[0] as T;
  if (found.length > 1)
    throw new CloudAlmError(
      "bad_request",
      `${code} is in several titles: ${found.slice(0, 8).map((x) => `${x.displayId} "${short(x.title, 50)}"`).join("; ")}; pass one display id`,
    );
  throw new CloudAlmError("not_found", `no item has ${code} in its title; use a display id like 3-17 or 8-1-2 (calm_find lists them)`);
}

/** Tasks by display id or GUID; unknown ones are an error naming them. */
export async function tasksByRef(snap: Snapshot, refs: string[]): Promise<TaskSummary[]> {
  const tasks = await snap.tasks();
  const found: TaskSummary[] = [];
  const missing: string[] = [];
  for (const raw of refs) {
    const ref = clean(raw);
    const t = tasks.find((x) => matches(ref, x)) ?? (TITLE_CODE.test(ref) ? byTitleCode(ref, tasks) : undefined);
    if (t) found.push(t);
    else missing.push(ref);
  }
  if (missing.length)
    throw new CloudAlmError(
      "not_found",
      `tasks not found in ${snap.project.name ?? "the project"}: ${missing.join(", ")}; use display ids like 3-17 (calm_find lists them)`,
    );
  return found;
}

export type Item =
  | { kind: "task"; id: string; task: TaskSummary }
  | { kind: "feature"; id: string; feature: SnapFeature }
  | { kind: "testCase"; id: string; testCase: SnapTestCase }
  | { kind: "document"; id: string; document: SnapDocument };

/**
 * Items of any kind by display id or GUID. The display id's first number
 * names the kind (3 task, 6 feature, 7 document, 8 test); a GUID is looked
 * up in each list in turn.
 */
export async function itemsByRef(snap: Snapshot, refs: string[]): Promise<Item[]> {
  const found: Item[] = [];
  const missing: string[] = [];
  for (const raw of refs) {
    const ref = clean(raw);
    const kind = /^(\d+)-/.exec(ref)?.[1];
    let item: Item | undefined;
    if (!kind || kind === "3") {
      const t = (await snap.tasks()).find((x) => matches(ref, x));
      if (t) item = { kind: "task", id: t.id, task: t };
    }
    if (!item && (!kind || kind === "6")) {
      const f = (await snap.features()).find((x) => matches(ref, x));
      if (f) item = { kind: "feature", id: f.id, feature: f };
    }
    if (!item && (!kind || kind === "8")) {
      const t = (await snap.testCases()).find((x) => matches(ref, x));
      if (t) item = { kind: "testCase", id: t.id, testCase: t };
    }
    if (!item && (!kind || kind === "7")) {
      const d = (await snap.documents()).find((x) => matches(ref, x));
      if (d) item = { kind: "document", id: d.id, document: d };
    }
    if (!item && TITLE_CODE.test(ref)) {
      const [tasks, features, testCases, documents] = await Promise.all([snap.tasks(), snap.features(), snap.testCases(), snap.documents()]);
      const hit = byTitleCode(ref, [...tasks, ...features, ...testCases, ...documents]);
      const t = tasks.find((x) => x.id === hit.id);
      const f = features.find((x) => x.id === hit.id);
      const c = testCases.find((x) => x.id === hit.id);
      const d = documents.find((x) => x.id === hit.id);
      item = t
        ? { kind: "task", id: t.id, task: t }
        : f
          ? { kind: "feature", id: f.id, feature: f }
          : c
            ? { kind: "testCase", id: c.id, testCase: c }
            : d && { kind: "document", id: d.id, document: d };
    }
    if (item) {
      if (!found.some((x) => x.id === item.id)) found.push(item);
    } else missing.push(ref);
  }
  if (missing.length)
    throw new CloudAlmError(
      "not_found",
      `not found in ${snap.project.name ?? "the project"}: ${missing.join(", ")}; use display ids like 3-17 or 8-1-2 (calm_find lists them)`,
    );
  return found;
}

/** `3-17 user story "Title"`, `6-1 feature "Title"`… */
export function itemLabel(item: Item): string {
  switch (item.kind) {
    case "task":
      return label(item.task);
    case "feature":
      return `${item.feature.displayId} feature "${short(item.feature.title, 70)}"`;
    case "testCase":
      return `${item.testCase.displayId} ${item.testCase.kind} test case "${short(item.testCase.title, 70)}"`;
    case "document":
      return `${item.document.displayId} document "${short(item.document.title, 70)}"`;
  }
}

export const label = (t: TaskSummary) => `${t.displayId} ${typeLabel(t.type)} "${short(t.title, 70)}"`;

/** Duplicate checks need the whole project: refuse when a list was cut. */
export function requireComplete(snap: Snapshot) {
  if (snap.truncated)
    throw new CloudAlmError("bad_request", "the project has more than 1000 items of a kind; this server cannot check for duplicates, so it does not create");
}

/** After a write succeeded, later failures must not read as "not written". */
export async function afterWrite<T>(what: string, step: () => Promise<T>): Promise<T | string> {
  try {
    return await step();
  } catch (error) {
    return `${what} failed (${error instanceof CloudAlmError ? `${error.code}: ${error.reason}` : "unexpected error"})`;
  }
}

/** Starts a write's answer when nothing would change: no proposal, no approval. */
export const NOTHING_TO_DO = "Nothing to do:";

export const dry = (o: WriteOptions, dryRun?: boolean) => o.writeMode === "dry-run" || dryRun === true;
/** Why nothing was sent: the call's dryRun, or the server's mode. */
export const dryNote = (o: WriteOptions) =>
  o.writeMode === "dry-run"
    ? "Dry run (the server is in dry-run mode, CALM_WRITE=dry-run; only its operator can turn writing on), nothing sent."
    : "Dry run, nothing sent.";

/**
 * Run a write; a 403 becomes an error naming the scope the key lacks.
 * (Cloud ALM's Tasks API also answers 403 to a path it does not know; the
 * writer only sends paths confirmed on a tenant.)
 */
export async function needing<T>(scope: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CloudAlmError && error.code === "forbidden")
      throw new CloudAlmError(
        "forbidden",
        `the key lacks calm-api.${scope} (Cloud ALM answered 403). Add it to the Cloud ALM API service instance and create a new key`,
        error.status,
      );
    throw error;
  }
}

/** One entity as Cloud ALM stores it (all fields). */
export function readRow(calm: CloudAlm, path: string, query?: Record<string, string>): Promise<Row> {
  return calm.operation(async (s) => rowOf(await s.get(path, query)));
}

/** An entity's ETag: OData's `@etag`, else none. */
export const etagOf = (row: Row) => {
  const tag = row["@etag"] ?? row["@odata.etag"];
  return typeof tag === "string" ? tag : undefined;
};

/** Whether a read says the item is gone. */
export async function gone(read: () => Promise<unknown>): Promise<boolean | string> {
  try {
    await read();
    return false;
  } catch (error) {
    if (error instanceof CloudAlmError && error.code === "not_found") return true;
    return `could not check (${error instanceof CloudAlmError ? error.code : "unexpected error"})`;
  }
}
