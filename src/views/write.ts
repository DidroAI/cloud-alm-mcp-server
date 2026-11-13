/**
 * Write tools, offered only when the operator turns writing on. Each one
 * reads first (to resolve ids and refuse duplicates), can run as a dry run,
 * and reads back what Cloud ALM stored. What the API cannot do is said up
 * front: test cases cannot be deleted or tagged through the API.
 */
import { type CloudAlm, CloudAlmError, type TaskSummary } from "../calm/index.js";
import { PATHS } from "../calm/client.js";
import { rowOf } from "../calm/values.js";
import type { CloudAlmWriter } from "../calm/writer.js";
import { escapeHtml } from "./html.js";
import { resolveProject, Snapshot } from "./snapshot.js";
import { short, statusLabel, typeLabel } from "./text.js";
import type { ViewOptions } from "./tools.js";

export type WriteOptions = ViewOptions & {
  /** "dry-run": every write tool answers with what it would send. */
  writeMode?: "on" | "dry-run";
};

type Step = { title: string; description: string; expected: string; evidence?: boolean };
type Activity = { title: string; steps: Step[] };

const TASK_TYPES = {
  requirement: "CALMREQU",
  user_story: "CALMUS",
  defect: "CALMDEF",
  project_task: "CALMTASK",
} as const;
export type CreatableTaskType = keyof typeof TASK_TYPES;
export const CREATABLE_TASK_TYPES = Object.keys(TASK_TYPES) as CreatableTaskType[];

const textToHtml = (text: string) =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.replace(/\s*\n\s*/g, " "))}</p>`)
    .join("");

async function snapshot(calm: CloudAlm, projectId: string | undefined, o: WriteOptions) {
  const { project } = await resolveProject(calm, projectId, o.defaultProject);
  return new Snapshot(calm, project);
}

/** Tasks by display id or GUID; unknown ones are an error naming them. */
async function tasksByRef(snap: Snapshot, refs: string[]): Promise<TaskSummary[]> {
  const tasks = await snap.tasks();
  const found: TaskSummary[] = [];
  const missing: string[] = [];
  for (const raw of refs) {
    const ref = raw.trim().replace(/^\[|\]$/g, "");
    const t = tasks.find((x) => x.displayId === ref || x.id.toLowerCase() === ref.toLowerCase());
    if (t) found.push(t);
    else missing.push(ref);
  }
  if (missing.length)
    throw new CloudAlmError("not_found", `tasks not found in ${snap.project.name ?? "the project"}: ${missing.join(", ")}`);
  return found;
}

/** A tag Cloud ALM keeps: at most 256 characters, no markup or control characters. */
function checkTag(t: string) {
  if (t.length > 256 || [...t].some((c) => c === "<" || c === ">" || c.charCodeAt(0) < 32))
    throw new CloudAlmError("bad_request", `tag "${short(t, 40)}": at most 256 characters, no < > or control characters`);
}

/**
 * Every tag of a task, uncapped: `updateTags` replaces the whole list, so a
 * list read short would delete the rest. Refuses anything not plain text.
 */
async function allTags(calm: CloudAlm, taskId: string): Promise<string[]> {
  const row = await calm.operation(async (s) => rowOf(await s.get(`${PATHS.tasks}/${taskId}`)));
  const tags = row.tags ?? [];
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))
    throw new CloudAlmError("unavailable", "Cloud ALM returned the task's tags in an unexpected shape; nothing written");
  return tags as string[];
}

/** Duplicate checks need the whole project: refuse when a list was cut. */
function requireComplete(snap: Snapshot) {
  if (snap.truncated)
    throw new CloudAlmError("bad_request", "the project has more than 1000 items of a kind; this server cannot check for duplicates, so it does not create");
}

/** After a create succeeded, later failures must not read as "not created". */
async function afterCreate<T>(what: string, step: () => Promise<T>): Promise<T | string> {
  try {
    return await step();
  } catch (error) {
    return `${what} failed (${error instanceof CloudAlmError ? `${error.code}: ${error.reason}` : "unexpected error"})`;
  }
}

const dry = (o: WriteOptions, dryRun?: boolean) => o.writeMode === "dry-run" || dryRun === true;
/** Why nothing was sent: the call's dryRun, or the server's mode. */
const dryNote = (o: WriteOptions) =>
  o.writeMode === "dry-run"
    ? "Dry run (the server is in dry-run mode, CALM_WRITE=dry-run; only its operator can turn writing on), nothing sent."
    : "Dry run, nothing sent.";
const label = (t: TaskSummary) => `${t.displayId} ${typeLabel(t.type)} "${short(t.title, 70)}"`;

// ---------------------------------------------------------------------------

export async function createTestCase(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: {
    title: string;
    covers?: string[];
    priority?: number;
    activities: Activity[];
    projectId?: string;
    dryRun?: boolean;
  },
  o: WriteOptions,
) {
  const snap = await snapshot(calm, input.projectId, o);
  const covered = await tasksByRef(snap, input.covers ?? []);
  await snap.testCases();
  requireComplete(snap);
  const existing = (await snap.testCases()).find(
    (t) => (t.title ?? "").trim().toLowerCase() === input.title.trim().toLowerCase(),
  );
  if (existing)
    throw new CloudAlmError(
      "bad_request",
      `a test case with this title exists: ${existing.displayId}. Test cases cannot be deleted through the API, so no duplicate is created.`,
    );
  const scopes = await calm.listScopes({ projectId: snap.project.id });
  const fromTask = covered.find((t) => t.scopeId);
  if (!fromTask && scopes.length > 1)
    throw new CloudAlmError("bad_request", `the project has ${scopes.length} scopes; give covers so the test case goes in their scope`);
  const scopeId = fromTask?.scopeId ?? scopes[0]?.id;
  if (!scopeId) throw new CloudAlmError("bad_request", "the project has no scope to put the test case in");
  const scopeName = fromTask?.scopeName ?? scopes.find((x) => x.id === scopeId)?.name ?? scopeId;
  const body = {
    projectId: snap.project.id,
    scopeId,
    title: input.title.trim(),
    priorityCode: input.priority ?? 30,
    isPrepared: true,
    toActivities: input.activities.map((a, i) => ({
      title: a.title,
      sequence: i + 1,
      isInScope: true,
      toActions: a.steps.map((s, j) => ({
        title: s.title,
        // Cloud ALM refuses a step without a description.
        description: s.description,
        expectedResult: s.expected,
        sequence: j + 1,
        isEvidenceRequired: s.evidence ?? false,
      })),
    })),
  };
  const steps = input.activities.reduce((n, a) => n + a.steps.length, 0);
  const plan = `test case "${body.title}" in scope "${scopeName}" with ${input.activities.length} activities and ${steps} steps${covered.length ? `, covering ${covered.map(label).join("; ")}` : ""}`;
  if (dry(o, input.dryRun))
    return `${dryNote(o)} Would create ${plan}.\nNote: a created test case cannot be deleted or tagged through the API.`;
  const created = (await writer.post("calm-testmanagement/v1/ManualTestCases", body)) as {
    uuid?: string;
    displayId?: string;
  } | null;
  const id = created?.uuid;
  if (!id)
    return `Cloud ALM accepted the test case "${body.title}" but did not return its id. Check with calm_find before trying again: a retry would create a duplicate.`;
  const linked: string[] = [];
  const failed: string[] = [];
  for (const t of covered) {
    try {
      await writer.post("calm-testmanagement/v1/TaskAssignments", { parentTestCase_ID: id, taskId: t.id });
      linked.push(t.displayId ?? t.id);
    } catch (error) {
      failed.push(`${t.displayId}: ${error instanceof CloudAlmError ? error.reason : "failed"}`);
    }
  }
  const back = await afterCreate("reading it back", () => calm.getTestCase(id));
  const stored =
    typeof back === "string"
      ? back
      : `${back.activities.length} activities, ${back.activities.reduce((n, a) => n + a.actions.length, 0)} steps stored`;
  return [
    `Created ${created?.displayId ?? (typeof back === "string" ? "" : back.displayId)} "${body.title}" [${id}]: ${stored}${linked.length ? `; linked to ${linked.join(", ")}` : ""}.`,
    failed.length ? `Links that failed: ${failed.join("; ")}` : "",
    "It cannot be deleted or tagged through the API; change or delete it in the Cloud ALM UI.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------

export async function link(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: { from: string; tasks: string[]; projectId?: string; dryRun?: boolean },
  o: WriteOptions,
) {
  const snap = await snapshot(calm, input.projectId, o);
  const tasks = await tasksByRef(snap, input.tasks);
  const ref = input.from.trim();
  const testCase = (await snap.testCases()).find((t) => t.displayId === ref || t.id.toLowerCase() === ref.toLowerCase());
  const snapFeatures = testCase ? undefined : await snap.features();
  const feature = snapFeatures?.find((f) => f.displayId === ref || f.id.toLowerCase() === ref.toLowerCase());
  if (!testCase && !feature)
    throw new CloudAlmError("not_found", `${ref} is not a test case or feature of ${snap.project.name ?? "the project"}`);
  if (testCase?.kind === "automated")
    throw new CloudAlmError("bad_request", "automated test cases cannot be changed through the API");
  const already = new Set(testCase ? testCase.taskIds : (feature?.taskIds ?? []));
  const todo = tasks.filter((t) => !already.has(t.id));
  const name = testCase ? `test case ${testCase.displayId}` : `feature ${feature?.displayId}`;
  const skipped = tasks.filter((t) => already.has(t.id)).map((t) => t.displayId);
  if (!todo.length) return `Nothing to do: ${name} is already linked to ${skipped.join(", ")}.`;
  if (dry(o, input.dryRun))
    return `${dryNote(o)} Would link ${name} to ${todo.map(label).join("; ")}.`;
  const others = feature
    ? todo.flatMap((t) =>
        (snapFeatures ?? [])
          .filter((f) => f.id !== feature.id && f.taskIds.includes(t.id))
          .map((f) => `${t.displayId} is also linked to feature ${f.displayId}`),
      )
    : [];
  const done: string[] = [];
  for (const t of todo) {
    if (testCase)
      await writer.post("calm-testmanagement/v1/TaskAssignments", { parentTestCase_ID: testCase.id, taskId: t.id });
    else await writer.post(`calm-tasks/v1/tasks/${t.id}/featureAssignments`, { featureId: feature?.id });
    done.push(t.displayId ?? t.id);
  }
  return `Linked ${name} to ${done.join(", ")}.${skipped.length ? ` Already linked: ${skipped.join(", ")}.` : ""}${others.length ? ` Note: ${others.join("; ")}.` : ""}`;
}

// ---------------------------------------------------------------------------

export async function tag(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: { tasks: string[]; add?: string[]; remove?: string[]; projectId?: string; dryRun?: boolean },
  o: WriteOptions,
) {
  const add = (input.add ?? []).map((t) => t.trim()).filter(Boolean);
  const remove = new Set((input.remove ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean));
  for (const t of add) checkTag(t);
  if (!add.length && !remove.size) throw new CloudAlmError("bad_request", "give tags to add or remove");
  const snap = await snapshot(calm, input.projectId, o);
  const tasks = await tasksByRef(snap, input.tasks);
  const lines: string[] = [];
  for (const t of tasks) {
    // Read just before writing: the call replaces the whole list.
    const before = await allTags(calm, t.id);
    const kept = before.filter((x) => !remove.has(x.toLowerCase()));
    const keys = new Set(kept.map((x) => x.toLowerCase()));
    const target = [...kept, ...add.filter((x) => !keys.has(x.toLowerCase()))];
    const same = target.length === before.length && target.every((x, i) => x === before[i]);
    if (same) {
      lines.push(`${t.displayId}: no change (${before.join(", ") || "no tags"})`);
      continue;
    }
    if (dry(o, input.dryRun)) {
      lines.push(`${t.displayId}: would go from [${before.join(", ")}] to [${target.join(", ")}] (${dryNote(o).replace(/\.$/, "")})`);
      continue;
    }
    await writer.post("calm-tasks/v1/tasks/updateTags", { taskId: t.id, tags: target });
    const after = await allTags(calm, t.id);
    const stored = new Set(after.map((x) => x.toLowerCase()));
    const dropped = target.filter((x) => !stored.has(x.toLowerCase()));
    lines.push(
      `${t.displayId}: [${before.join(", ")}] → [${after.join(", ")}]${dropped.length ? `; Cloud ALM did not store ${dropped.join(", ")} (a tag differing only in capitals from an existing one is dropped)` : ""}`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

export async function createTask(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: {
    type: CreatableTaskType;
    title: string;
    description: string;
    priority?: number;
    requirement?: string;
    tags?: string[];
    projectId?: string;
    dryRun?: boolean;
  },
  o: WriteOptions,
) {
  for (const t of input.tags ?? []) checkTag(t);
  const snap = await snapshot(calm, input.projectId, o);
  const tasks = await snap.tasks();
  requireComplete(snap);
  const title = input.title.trim();
  const duplicate = tasks.find((t) => (t.title ?? "").trim().toLowerCase() === title.toLowerCase() && t.type === TASK_TYPES[input.type]);
  if (duplicate)
    throw new CloudAlmError("bad_request", `a ${typeLabel(duplicate.type)} with this title exists: ${duplicate.displayId} (${statusLabel(duplicate.status)})`);
  const parent = input.requirement ? (await tasksByRef(snap, [input.requirement]))[0] : undefined;
  if (parent && parent.type !== "CALMREQU")
    throw new CloudAlmError("bad_request", `${parent.displayId} is a ${typeLabel(parent.type)}, not a requirement`);
  if (parent && !["user_story", "project_task"].includes(input.type))
    throw new CloudAlmError("bad_request", "only user stories and project tasks go under a requirement");
  const scopes = parent ? [] : await calm.listScopes({ projectId: snap.project.id });
  if (!parent && scopes.length > 1)
    throw new CloudAlmError("bad_request", `the project has ${scopes.length} scopes; give a requirement, or create it in the Cloud ALM UI`);
  const scopeId = parent?.scopeId ?? scopes[0]?.id;
  const scopeName = parent?.scopeName ?? scopes[0]?.name ?? null;
  const body = {
    projectId: snap.project.id,
    type: TASK_TYPES[input.type],
    title,
    description: textToHtml(input.description),
    priorityId: input.priority ?? 30,
    ...(scopeId ? { scopeId } : {}),
    ...(parent ? { parentId: parent.id } : {}),
  };
  const plan = `${input.type.replace("_", " ")} "${title}"${scopeName ? ` in scope "${scopeName}"` : ""}${parent ? ` under ${label(parent)}` : ""}${input.tags?.length ? ` tagged ${input.tags.join(", ")}` : ""}`;
  if (dry(o, input.dryRun)) return `${dryNote(o)} Would create ${plan}.`;
  const created = (await writer.post("calm-tasks/v1/tasks", body)) as { id?: string; displayId?: string } | null;
  if (!created?.id)
    return `Cloud ALM accepted the ${input.type.replace("_", " ")} "${title}" but did not return its id. Check with calm_find before trying again: a retry would create a duplicate.`;
  let tags = "";
  if (input.tags?.length) {
    const id = created.id;
    const stored = await afterCreate("setting its tags", async () => {
      await writer.post("calm-tasks/v1/tasks/updateTags", { taskId: id, tags: input.tags });
      return (await allTags(calm, id)).join(", ") || "none stored";
    });
    tags = ` Tags: ${stored}.`;
  }
  return `Created ${created.displayId ?? ""} ${plan} [${created.id}].${tags}`;
}
