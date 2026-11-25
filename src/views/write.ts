/**
 * Write tools that create and link, offered only when the operator turns
 * writing on. Each one reads first (to resolve ids and refuse duplicates),
 * can run as a dry run, and reads back what Cloud ALM stored. Changing and
 * deleting live in `edit.ts`. What the API cannot do is said up front:
 * test cases cannot be tagged through the API.
 */
import { type CloudAlm, CloudAlmError, type TaskSummary } from "../calm/index.js";
import { PATHS } from "../calm/client.js";
import { type Row, rowOf, rowsOf, str } from "../calm/values.js";
import type { CloudAlmWriter } from "../calm/writer.js";
import {
  afterWrite as afterCreate,
  dry,
  dryNote,
  NOTHING_TO_DO,
  similarTitles,
  type Item,
  itemsByRef,
  label,
  needing,
  readRow,
  requireComplete,
  snapshot,
  tasksByRef,
  textToHtml,
  type WriteOptions,
  type Change,
  changeItem,
} from "./items.js";
import { capital, clipped, short, statusLabel, typeLabel } from "./text.js";

export type { WriteOptions } from "./items.js";

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
      `a test case with this title exists: ${existing.displayId}; no duplicate is created`,
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
  const plan = `test case "${body.title}" in scope "${scopeName}" with ${input.activities.length} ${input.activities.length === 1 ? "activity" : "activities"} and ${steps} step${steps === 1 ? "" : "s"}${covered.length ? `, covering ${covered.map(label).join("; ")}` : ""}`;
  const outline = input.activities
    .flatMap((a, i) => [`${i + 1}. ${a.title}`, ...a.steps.map((st, j) => `   ${i + 1}.${j + 1} ${st.title} — do: ${st.description} — expect: ${st.expected}${st.evidence ? " [evidence]" : ""}`)])
    .join("\n");
  const allCases = await snap.testCases();
  const testedAlready = covered.flatMap((t) => {
    const cases = allCases.filter((c) => c.taskIds.includes(t.id));
    return cases.length ? [`${t.displayId} already has ${cases.map((c) => `${c.displayId} "${short(c.title, 50)}"`).join(", ")}`] : [];
  });
  const near = similarTitles(body.title, allCases.map((c) => ({ id: c.displayId, title: c.title })));
  const notes = [
    ...testedAlready.map((x) => `${x}; check the new one adds a case they do not cover`),
    ...(near.length ? [`similar test cases exist: ${near.join("; ")}`] : []),
    "test cases cannot be tagged through the API; deleting one needs the key's calm-api.testcases.delete scope",
  ];
  o.reviewPlan?.({ body, covered: covered.map(t => t.id), plan, notes });
  if (dry(o, input.dryRun)) {
    const shown = clipped(outline, 3000);
    const warnings = [
      ...covered.flatMap((t) => (allCases.some((c) => c.taskIds.includes(t.id)) ? [`${named(t)} already has a test case: check this one adds a case they do not cover`] : [])),
      ...(near.length ? ["Test cases with a similar title exist"] : []),
    ];
    const change: Change = {
      kind: "create",
      project: { id: snap.project.id, name: snap.project.name },
      items: [{
        type: "test case", title: body.title, op: "create",
        fields: [
          { field: "Scope", after: scopeName },
          { field: "Priority", after: capital(PRIORITY_NAMES[body.priorityCode] ?? String(body.priorityCode)) },
          ...(covered.length ? [{ field: "Covers", after: covered.map((t) => capital(named(t))).join("\n") }] : []),
          { field: "Steps", after: outline },
        ],
      }],
      ...(warnings.length ? { warnings } : {}),
    };
    return { text: `${dryNote(o)} Would create ${plan}.\n${shown}\nNote: ${notes.join("; ")}.`, data: { change } };
  }
  const created = (await writer.post("calm-testmanagement/v1/ManualTestCases", body)) as {
    uuid?: string;
    displayId?: string;
  } | null;
  const id = created?.uuid;
  if (!id)
    return `Cloud ALM accepted the test case "${body.title}" but did not return its id. Check with calm_list before trying again: a retry would create a duplicate.`;
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
    "Test cases cannot be tagged through the API. Change it with calm_update; deleting it needs calm-api.testcases.delete.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------

/** What one `calm_link` call will do, before it does it. */
/** A task as people name it: its kind and title, no id. */
const named = (t: TaskSummary) => `${typeLabel(t.type)} "${short(t.title, 70)}"`;

type LinkPlan = {
  /** "test case 8-1-2", "requirement 3-1"… */
  name: string;
  title: string | null;
  todo: TaskSummary[];
  /** Display ids already in the wanted state. */
  skipped: string[];
  notes: string[];
  scope: string;
  run: (t: TaskSummary) => Promise<void>;
  /** The item the links hang on, when it is not the one given as `from` (a requirement named from its user story). */
  subject?: TaskSummary;
};

const relationRows = (calm: CloudAlm, taskId: string, what: string) =>
  calm.operation(async (s) => rowsOf(await s.get(`${PATHS.tasks}/${taskId}/${what}`)));
const idOf = (rows: Row[], field: string, value: string) =>
  str(rows.find((r) => String(r[field] ?? "").toLowerCase() === value.toLowerCase())?.id);

/**
 * Link (or with `unlink`, unlink) an item to tasks: a manual test case
 * (tests them), a feature (delivers them), a document (documents them), or
 * a requirement and its user stories or project tasks (relation type 10;
 * `from` is either side).
 */
export async function link(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: { from: string; tasks: string[]; unlink?: boolean; projectId?: string; dryRun?: boolean },
  o: WriteOptions,
) {
  const snap = await snapshot(calm, input.projectId, o);
  const [source] = await itemsByRef(snap, [input.from]);
  const tasks = await tasksByRef(snap, input.tasks);
  if (!source) throw new CloudAlmError("not_found", `${input.from} not found`);
  const unlink = input.unlink === true;
  const plan = await linkPlan(calm, writer, snap, source, tasks, unlink);
  const verb = unlink ? "unlink" : "link";
  const prep = unlink ? "from" : "to";
  if (!plan.todo.length)
    return `${NOTHING_TO_DO} ${plan.name} is ${unlink ? "not linked to" : "already linked to"} ${plan.skipped.join(", ")}.`;
  const skippedNote = plan.skipped.length ? ` ${unlink ? "Not linked" : "Already linked"}: ${plan.skipped.join(", ")}.` : "";
  const notes = plan.notes.length ? ` Note: ${plan.notes.join("; ")}.` : "";
  o.reviewPlan?.({ project: snap.project.id, source: source.id, verb, tasks: tasks.map(t => ({ id: t.id, title: t.title })),
    todo: plan.todo.map(t => t.id), title: plan.title, notes: plan.notes, skipped: plan.skipped });
  if (dry(o, input.dryRun)) {
    const change: Change = {
      kind: "update",
      project: { id: snap.project.id, name: snap.project.name },
      items: [{
        ...(plan.subject ? { id: plan.subject.displayId, type: typeLabel(plan.subject.type), title: plan.subject.title } : changeItem(source)), op: "update",
        fields: [{ field: unlink ? "Remove the link to" : "Link to", after: plan.todo.map((t) => capital(named(t))).join("\n") }],
      }],
      ...(plan.notes.length ? { warnings: plan.notes } : {}),
    };
    return { text: `${dryNote(o)} Would ${verb} ${plan.name} "${short(plan.title, 70)}" ${prep} ${plan.todo.map(label).join("; ")}.${skippedNote}${notes}`, data: { change } };
  }
  const done: string[] = [];
  const failed: string[] = [];
  for (const t of plan.todo) {
    try {
      await needing(plan.scope, () => plan.run(t));
      done.push(t.displayId ?? t.id);
    } catch (error) {
      if (!done.length && !failed.length && plan.todo.length === 1) throw error;
      failed.push(`${t.displayId}: ${error instanceof CloudAlmError ? `${error.code}: ${error.reason}` : "failed"}`);
    }
  }
  if (!done.length) throw new CloudAlmError("bad_request", `nothing ${verb}ed: ${failed.join("; ")}`);
  return `${unlink ? "Unlinked" : "Linked"} ${plan.name} ${prep} ${done.join(", ")}.${skippedNote}${notes}${failed.length ? ` Failed: ${failed.join("; ")}.` : ""}`;
}

async function linkPlan(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  snap: Awaited<ReturnType<typeof snapshot>>,
  source: Item,
  tasks: TaskSummary[],
  unlink: boolean,
): Promise<LinkPlan> {
  const split = (linked: Set<string>) => ({
    todo: tasks.filter((t) => linked.has(t.id) === unlink),
    skipped: tasks.filter((t) => linked.has(t.id) !== unlink).map((t) => t.displayId ?? t.id),
  });
  switch (source.kind) {
    case "testCase": {
      const tc = source.testCase;
      if (tc.kind === "automated")
        throw new CloudAlmError("bad_request", "automated test cases cannot be changed through the API");
      return {
        name: `test case ${tc.displayId}`,
        title: tc.title,
        ...split(new Set(tc.taskIds)),
        notes: [],
        // Removing a link is a delete in Test Management.
        scope: unlink ? "testcases.delete" : "testcases.write",
        run: async (t) => {
          if (!unlink) {
            await writer.post("calm-testmanagement/v1/TaskAssignments", { parentTestCase_ID: tc.id, taskId: t.id });
            return;
          }
          const row = await readRow(calm, `${PATHS.manualTestCases}/${tc.id}`, { $expand: "toTaskAssignments" });
          const rows = Array.isArray(row.toTaskAssignments) ? (row.toTaskAssignments as Row[]) : [];
          const id = str(rows.find((r) => r.taskId === t.id)?.uuid);
          if (!id) throw new CloudAlmError("not_found", "the link is gone already");
          await writer.delete(`calm-testmanagement/v1/TaskAssignments/${id}`);
        },
      };
    }
    case "feature": {
      const f = source.feature;
      const features = await snap.features();
      const plan = split(new Set(f.taskIds));
      return {
        name: `feature ${f.displayId}`,
        title: f.title,
        ...plan,
        notes: unlink
          ? []
          : plan.todo.flatMap((t) =>
              features
                .filter((x) => x.id !== f.id && x.taskIds.includes(t.id))
                .map((x) => `${t.displayId} is also linked to feature ${x.displayId}`),
            ),
        scope: "tasks.write",
        run: async (t) => {
          if (!unlink) {
            await writer.post(`${PATHS.tasks}/${t.id}/featureAssignments`, { featureId: f.id });
            return;
          }
          const id = idOf(await relationRows(calm, t.id, "featureAssignments"), "featureId", f.id);
          if (!id) throw new CloudAlmError("not_found", "the link is gone already");
          await writer.delete(`${PATHS.tasks}/featureAssignments/${id}`);
        },
      };
    }
    case "document": {
      const d = source.document;
      return {
        name: `document ${d.displayId}`,
        title: d.title,
        ...split(new Set(d.taskIds)),
        notes: [],
        scope: "tasks.write",
        run: async (t) => {
          if (!unlink) {
            await writer.post(`${PATHS.tasks}/${t.id}/documentAssignments`, { documentId: d.id });
            return;
          }
          const id = idOf(await relationRows(calm, t.id, "documentAssignments"), "documentId", d.id);
          if (!id) throw new CloudAlmError("not_found", "the link is gone already");
          await writer.delete(`${PATHS.tasks}/documentAssignments/${id}`);
        },
      };
    }
    case "task":
      return requirementPlan(calm, writer, await snap.tasks(), source.task, tasks, unlink);
  }
}

const UNDER_REQUIREMENT = ["CALMUS", "CALMTASK"];

/** A requirement and the user stories or project tasks under it (relation type 10). */
async function requirementPlan(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  all: TaskSummary[],
  from: TaskSummary,
  tasks: TaskSummary[],
  unlink: boolean,
): Promise<LinkPlan> {
  let requirement: TaskSummary;
  let children: TaskSummary[];
  if (from.type === "CALMREQU") {
    requirement = from;
    children = tasks;
  } else if (UNDER_REQUIREMENT.includes(from.type ?? "")) {
    const [only, ...more] = tasks;
    if (!only || more.length || only.type !== "CALMREQU")
      throw new CloudAlmError("bad_request", `a ${typeLabel(from.type)} goes under one requirement: give that requirement in tasks`);
    requirement = only;
    children = [from];
  } else
    throw new CloudAlmError(
      "bad_request",
      `${from.displayId} is a ${typeLabel(from.type)}: link from a test case, feature, document, requirement, user story or project task`,
    );
  const wrong = children.filter((c) => !UNDER_REQUIREMENT.includes(c.type ?? ""));
  if (wrong.length)
    throw new CloudAlmError("bad_request", `only user stories and project tasks go under a requirement, not ${wrong.map((w) => `${w.displayId} (${typeLabel(w.type)})`).join(", ")}`);
  const todo: TaskSummary[] = [];
  const skipped: string[] = [];
  const relationIds = new Map<string, string>();
  const conflicts: string[] = [];
  for (const c of children) {
    const rows = await relationRows(calm, c.id, "relations");
    const current = rows.find((r) => String(r.type) === "10");
    const currentReq = str(current?.relationTaskId);
    if (currentReq?.toLowerCase() === requirement.id.toLowerCase()) {
      if (unlink) {
        todo.push(c);
        relationIds.set(c.id, str(current?.id) ?? "");
      } else skipped.push(c.displayId ?? c.id);
    } else if (unlink) skipped.push(c.displayId ?? c.id);
    else if (currentReq) conflicts.push(`${c.displayId} is under requirement ${all.find((t) => t.id.toLowerCase() === currentReq.toLowerCase())?.displayId ?? currentReq}`);
    else todo.push(c);
  }
  if (conflicts.length)
    throw new CloudAlmError("bad_request", `a task has one requirement: ${conflicts.join("; ")}. Unlink it from that one first`);
  return {
    name: `requirement ${requirement.displayId}`,
    title: requirement.title,
    subject: requirement,
    todo,
    skipped,
    notes: [],
    scope: "tasks.write",
    run: async (t) => {
      if (!unlink) {
        await writer.post(`${PATHS.tasks}/${t.id}/relations`, { type: "10", relationTaskId: requirement.id });
        return;
      }
      const id = relationIds.get(t.id);
      if (!id) throw new CloudAlmError("not_found", "the link is gone already");
      await writer.delete(`${PATHS.tasks}/relations/${id}`);
    },
  };
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
  const plans = [];
  for (const t of tasks) {
    // Resolve the entire batch before approving or changing any tags.
    const before = await allTags(calm, t.id);
    const kept = before.filter((x) => !remove.has(x.toLowerCase()));
    const keys = new Set(kept.map((x) => x.toLowerCase()));
    const target = [...kept, ...add.filter((x) => !keys.has(x.toLowerCase()))];
    const same = target.length === before.length && target.every((x, i) => x === before[i]);
    plans.push({ task: t, before, target, same });
  }
  o.reviewPlan?.({ project: snap.project.id, items: plans.map(p => ({ id: p.task.id, before: p.before, after: p.target })) });
  for (const { task: t, before, target, same } of plans) {
    if (same) {
      lines.push(`${t.displayId}: no change (${before.join(", ") || "no tags"})`);
      continue;
    }
    if (dry(o, input.dryRun)) {
      lines.push(`${t.displayId}: would go from [${before.join(", ")}] to [${target.join(", ")}] (${dryNote(o).replace(/\.$/, "")})`);
      continue;
    }
    try {
      if (plans.length > 1) {
        const current = await allTags(calm, t.id);
        if (current.length !== before.length || current.some((tag, i) => tag !== before[i]))
          throw new CloudAlmError("bad_request", "The task’s tags changed during the batch; review the current tags before retrying.");
      }
      await writer.post("calm-tasks/v1/tasks/updateTags", { taskId: t.id, tags: target });
    } catch (error) {
      // Report the tasks already tagged, then this one's failure.
      if (!lines.some((l) => l.includes(" → "))) throw error;
      const why = error instanceof CloudAlmError ? `${error.code}: ${error.reason}` : "unexpected error";
      lines.push(`${t.displayId}: not changed (${why}); the rest was not tried`);
      break;
    }
    const after = await allTags(calm, t.id).catch(() => target);
    const stored = new Set(after.map((x) => x.toLowerCase()));
    const dropped = target.filter((x) => !stored.has(x.toLowerCase()));
    lines.push(
      `${t.displayId}: [${before.join(", ")}] → [${after.join(", ")}]${dropped.length ? `; Cloud ALM did not store ${dropped.join(", ")} (a tag differing only in capitals from an existing one is dropped)` : ""}`,
    );
  }
  if (lines.every((l) => / no change \(/.test(l))) return `${NOTHING_TO_DO} ${lines.join("; ")}.`;
  if (dry(o, input.dryRun)) {
    const change: Change = {
      kind: "update",
      project: { id: snap.project.id, name: snap.project.name },
      items: plans.filter((p) => !p.same).map((p) => ({
        id: p.task.displayId, type: typeLabel(p.task.type), title: p.task.title, op: "update" as const,
        fields: [{ field: "Tags", before: p.before.join(", ") || "None", after: p.target.join(", ") || "None" }],
      })),
    };
    return { text: lines.join("\n"), data: { change } };
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

const PRIORITY_NAMES: Record<number, string> = { 10: "very high", 20: "high", 30: "medium", 40: "low" };

export async function createTask(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: {
    type: CreatableTaskType;
    title: string;
    description?: string;
    priority?: number;
    requirement?: string;
    assignee?: string;
    startDate?: string;
    dueDate?: string;
    tags?: string[];
    testCase?: string;
    projectId?: string;
    dryRun?: boolean;
  },
  o: WriteOptions,
) {
  for (const t of input.tags ?? []) checkTag(t);
  if (input.testCase && input.type !== "defect") throw new CloudAlmError("bad_request", "testCase is for defects: the test case the defect was found in");
  for (const field of ["startDate", "dueDate"] as const)
    if (input[field] && !/^\d{4}-\d{2}-\d{2}$/.test(input[field] as string))
      throw new CloudAlmError("bad_request", `${field} must be YYYY-MM-DD`);
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
  // The test case a defect was found in. Cloud ALM's API refuses to link a
  // defect to a test case ("must be a User Story or Requirement"), so the
  // test case is named at the top of the description.
  const warnings: string[] = [];
  let found = "";
  if (input.testCase) {
    const item = (await itemsByRef(snap, [input.testCase]))[0];
    if (item?.kind !== "testCase") throw new CloudAlmError("bad_request", `${input.testCase} is not a test case`);
    const tc = item.testCase;
    const [results, links] = await Promise.all([snap.testResults().catch(() => new Map()), snap.defects().catch(() => null)]);
    const latest = (results.get(tc.id) ?? []) as { status: string; plan: string; passed: number; steps: number }[];
    found = `Found in test case ${tc.displayId} "${tc.title ?? ""}"${latest.length ? ` (latest: ${latest.map((r) => `${r.status.toLowerCase()}, ${r.passed} of ${r.steps} steps passed in ${r.plan}`).join("; ")})` : ""}.`;
    const open = (links?.byTestCase.get(tc.id.toLowerCase()) ?? [])
      .map((id) => tasks.find((t) => t.id.toLowerCase() === id))
      .filter((t): t is NonNullable<typeof t> => !!t && !/DONE|CLOSE|NO$|NR$/.test(t.status ?? ""));
    if (open.length) warnings.push(`an open defect already exists for ${tc.displayId}: ${open.map((t) => label(t)).join(", ")}; check it is not the same problem`);
    warnings.push(`Cloud ALM's API cannot link a defect to a test case: the description names ${tc.displayId}`);
  }
  const near = similarTitles(title, tasks.filter((t) => t.type === TASK_TYPES[input.type] || (parent && t.type === "CALMUS")).map((t) => ({ id: t.displayId, title: t.title })));
  if (near.length) warnings.push(`similar titles exist: ${near.join("; ")}; check it is not already there`);
  const description = [found, input.description?.trim()].filter(Boolean).join("\n\n");
  const body = {
    projectId: snap.project.id,
    type: TASK_TYPES[input.type],
    title,
    ...(description ? { description: textToHtml(description) } : {}),
    priorityId: input.priority ?? 30,
    ...(input.assignee ? { assigneeId: input.assignee } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(scopeId ? { scopeId } : {}),
    ...(parent ? { parentId: parent.id } : {}),
  };
  const plan = `${input.type.replace("_", " ")} "${title}"${scopeName ? ` in scope "${scopeName}"` : ""}${parent ? ` under ${label(parent)}` : ""}, priority ${PRIORITY_NAMES[input.priority ?? 30]}${input.assignee ? `, assigned to ${input.assignee}` : ""}${input.startDate ? `, start ${input.startDate}` : ""}${input.dueDate ? `, due ${input.dueDate}` : ""}${input.tags?.length ? ` tagged ${input.tags.join(", ")}` : ""}`;
  const extra = `${description ? `\nDescription: ${clipped(description, 600)}` : ""}${warnings.length ? `\nNote: ${warnings.join("; ")}.` : ""}`;
  o.reviewPlan?.({ body, tags: input.tags, plan, warnings });
  if (dry(o, input.dryRun)) {
    const fields = [
      ["Scope", scopeName],
      ["Under", parent ? label(parent) : null],
      ["Priority", capital(PRIORITY_NAMES[input.priority ?? 30] ?? "")],
      ["Assignee", input.assignee],
      ["Start", input.startDate],
      ["Due", input.dueDate],
      ["Tags", input.tags?.length ? input.tags.join(", ") : null],
      ["Description", description || null],
    ]
      .filter(([, v]) => !!v)
      .map(([field, after]) => ({ field: field as string, after: after as string }));
    const change: Change = {
      kind: "create",
      project: { id: snap.project.id, name: snap.project.name },
      items: [{ type: input.type.replace("_", " "), title, op: "create", fields }],
      ...(warnings.length ? { warnings } : {}),
    };
    return { text: `${dryNote(o)} Would create ${plan}.${extra}`, data: { change } };
  }
  const created = (await writer.post("calm-tasks/v1/tasks", body)) as { id?: string; displayId?: string } | null;
  if (!created?.id)
    return `Cloud ALM accepted the ${input.type.replace("_", " ")} "${title}" but did not return its id. Check with calm_list before trying again: a retry would create a duplicate.`;
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
