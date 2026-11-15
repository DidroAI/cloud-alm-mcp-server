/**
 * Write tools that change, delete, comment and create features and
 * documents. Like `write.ts`: each reads first, answers a dry run with the
 * exact change (ids, titles, each field before → after), and reads back
 * what Cloud ALM stored. Only what the API allows is offered; the rest is
 * refused with the reason (features cannot be deleted, documents cannot be
 * changed after create, test cases cannot be tagged).
 */
import { type CloudAlm, CloudAlmError, type TaskSummary } from "../calm/index.js";
import { PATHS } from "../calm/client.js";
import { bool, num, plainText, type Row, str } from "../calm/values.js";
import type { CloudAlmWriter } from "../calm/writer.js";
import {
  afterWrite,
  dry,
  dryNote,
  NOTHING_TO_DO,
  etagOf,
  gone,
  type Item,
  itemLabel,
  itemsByRef,
  label,
  needing,
  readRow,
  requireComplete,
  snapshot,
  tasksByRef,
  textToHtml,
  type WriteOptions,
} from "./items.js";
import type { Snapshot } from "./snapshot.js";
import { documentType, featureStatus, short, statusLabel, typeLabel } from "./text.js";

type Step = { title: string; description: string; expected: string; evidence?: boolean };

const PRIORITIES: Record<number, string> = { 10: "very high", 20: "high", 30: "medium", 40: "low" };
const priorityText = (p: unknown) => {
  const n = num(p);
  return n === null ? "none" : `${n} ${PRIORITIES[n] ?? ""}`.trim();
};
const words = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const codeText = (s: unknown) => (typeof s === "string" && s ? s.toLowerCase().replaceAll("_", " ") : null);

// ---- Task status -----------------------------------------------------------

type StatusChange = { status: string; subStatus?: string; approvalState?: string };

/** Plain words → the status suffix shared by all task types. */
const PLAIN_STATUS: Record<string, string> = {
  open: "OPEN",
  new: "OPEN",
  "to do": "OPEN",
  "in progress": "INP",
  blocked: "BLK",
  "in review": "REV",
  done: "DONE",
  closed: "DONE",
  completed: "DONE",
  "not relevant": "NO",
  cancelled: "NO",
  canceled: "NO",
};

/**
 * Status codes per task type: code prefix and which plain states exist
 * (DONE is CLOSE for most types; not relevant is NR for quality gates).
 * Checked on the eu20 tenant 2026-11-13 for project tasks, user stories,
 * requirements and defects; the others follow SAP's code lists.
 */
const TASK_STATUS: Record<string, { prefix: string; states: Record<string, string> }> = {
  CALMTASK: { prefix: "CIPTK", states: { OPEN: "OPEN", INP: "INP", BLK: "BLK", REV: "REV", DONE: "CLOSE", NO: "NO" } },
  CALMTMPL: { prefix: "CIPTK", states: { OPEN: "OPEN", INP: "INP", BLK: "BLK", REV: "REV", DONE: "CLOSE", NO: "NO" } },
  CALMST: { prefix: "CIPTK", states: { OPEN: "OPEN", INP: "INP", BLK: "BLK", REV: "REV", DONE: "CLOSE", NO: "NO" } },
  CALMUS: { prefix: "CIPUS", states: { OPEN: "OPEN", INP: "INP", BLK: "BLK", REV: "REV", DONE: "CLOSE", NO: "NO" } },
  CALMREQU: { prefix: "CIPREQU", states: { OPEN: "OPEN", INP: "INP", BLK: "BLK", DONE: "CLOSE", NO: "NO" } },
  CALMDEF: { prefix: "CIPDFCT", states: { OPEN: "OPEN", INP: "INP", BLK: "BLK", DONE: "DONE" } },
  CALMRISK: { prefix: "CIPRI", states: { OPEN: "OPEN", INP: "INP", DONE: "DONE" } },
  CALMQGATE: { prefix: "CIPQG", states: { OPEN: "OPEN", BLK: "BLK", DONE: "DONE", NO: "NR" } },
};

/** Requirement states beyond the plain ones: they set the approval too. */
const REQUIREMENT_STATUS: Record<string, StatusChange> = {
  "to be approved": { status: "CIPREQUINP", subStatus: "TO_BE_APPROVED", approvalState: "READY_4_APPR" },
  approved: { status: "CIPREQUINP", subStatus: "IN_PLANNING", approvalState: "APPROVED" },
  "in planning": { status: "CIPREQUINP", subStatus: "IN_PLANNING", approvalState: "APPROVED" },
  "in realization": { status: "CIPREQUINP", subStatus: "IN_REALIZATION", approvalState: "APPROVED" },
  "in implementation": { status: "CIPREQUINP", subStatus: "IN_REALIZATION", approvalState: "APPROVED" },
  "approved for deployment": { status: "CIPREQUINP", subStatus: "APPROVED_FOR_DEPLOYMENT", approvalState: "APPROVED" },
  "ready for deployment": { status: "CIPREQUINP", subStatus: "APPROVED_FOR_DEPLOYMENT", approvalState: "APPROVED" },
  rejected: { status: "CIPREQUNO", approvalState: "REJECTED" },
};

const PLAIN_NAMES: Record<string, string> = { OPEN: "open", INP: "in progress", BLK: "blocked", REV: "in review", DONE: "done", NO: "not relevant" };

function taskStatus(type: string, wanted: string): StatusChange {
  const w = words(wanted);
  const table = TASK_STATUS[type];
  if (!table) throw new CloudAlmError("bad_request", `the status of a ${typeLabel(type)} cannot be set by this server`);
  const raw = wanted.trim().toUpperCase();
  if (raw.startsWith(table.prefix) && Object.values(table.states).includes(raw.slice(table.prefix.length)))
    return { status: raw };
  if (type === "CALMREQU" && REQUIREMENT_STATUS[w]) return { ...(REQUIREMENT_STATUS[w] as StatusChange) };
  if (type === "CALMDEF" && (w === "retest" || w === "retest required"))
    return { status: "CIPDFCTINP", subStatus: "DFC_RETEST_REQ" };
  const plain = PLAIN_STATUS[w];
  const suffix = plain ? table.states[plain] : undefined;
  if (!suffix) {
    const offered = Object.keys(table.states).map((k) => PLAIN_NAMES[k]);
    if (type === "CALMREQU") offered.push(...Object.keys(REQUIREMENT_STATUS));
    if (type === "CALMDEF") offered.push("retest");
    throw new CloudAlmError("bad_request", `a ${typeLabel(type)} has no status "${wanted}"; it takes ${offered.join(", ")}`);
  }
  return { status: `${table.prefix}${suffix}` };
}

/** Sub-statuses that say more than the status; others are left out. */
const SUB_STATUS: Record<string, string> = {
  TO_BE_APPROVED: "to be approved",
  IN_PLANNING: "in planning",
  IN_REALIZATION: "in realization",
  APPROVED_FOR_DEPLOYMENT: "approved for deployment",
  DFC_RETEST_REQ: "retest required",
  DFC_POSTPONE: "postponed",
};
const READY_4_APPR = "ready for approval";

const taskStatusText = (row: Row) => {
  const status = statusLabel(str(row.status));
  const approval = str(row.approvalState);
  const extra = [
    SUB_STATUS[str(row.subStatus) ?? ""],
    approval ? `approval ${approval === "READY_4_APPR" ? READY_4_APPR : codeText(approval)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return extra ? `${status} (${extra})` : status;
};

// ---- Feature status --------------------------------------------------------

const FEATURE_STATUS: Record<string, string> = {
  "in specification": "CREATED",
  created: "CREATED",
  open: "CREATED",
  "not planned": "NOT_PLANNED",
  "not relevant": "NOT_PLANNED",
  "in realization": "IN_REALIZATION",
  "in implementation": "IN_REALIZATION",
  "in progress": "IN_REALIZATION",
  "in testing": "IN_TESTING",
  "successfully tested": "SUCCESSFULLY_TESTED",
  tested: "SUCCESSFULLY_TESTED",
  deployed: "CONFIRMED",
  confirmed: "CONFIRMED",
  done: "CONFIRMED",
};

/**
 * Feature status changes Cloud ALM accepts, as answered by the eu20 tenant
 * (2026-11-13); other changes from these states answer 400. Ready for
 * production (APPROVED_FOR_DEPLOYMENT) cannot be set through the API at all.
 */
const FEATURE_NEXT: Record<string, string[]> = {
  IN_REALIZATION: ["IN_TESTING"],
  IN_TESTING: ["SUCCESSFULLY_TESTED", "IN_REALIZATION"],
  SUCCESSFULLY_TESTED: ["IN_REALIZATION"],
};

function featureCode(wanted: string): string {
  const w = words(wanted);
  const raw = wanted.trim().toUpperCase().replace(/\s+/g, "_");
  if (raw === "APPROVED_FOR_DEPLOYMENT" || w === "ready for production" || w === "approved for deployment")
    throw new CloudAlmError("bad_request", "Cloud ALM does not let the API set a feature to ready for production (approved for deployment); do that in the Cloud ALM UI");
  const code = FEATURE_STATUS[w] ?? (Object.values(FEATURE_STATUS).includes(raw) ? raw : undefined);
  if (!code)
    throw new CloudAlmError("bad_request", `a feature has no status "${wanted}"; it takes in specification, not planned, in realization, in testing, successfully tested, deployed`);
  return code;
}

// ---- calm_update -----------------------------------------------------------

export type UpdateInput = {
  ids: string[];
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  assignee?: string;
  startDate?: string;
  dueDate?: string;
  timebox?: string;
  obsolete?: boolean;
  prepared?: boolean;
  addActivity?: { title: string; steps: Step[] };
  /** Tasks: a comment added with the change, under the same approval. */
  comment?: string;
  projectId?: string;
  dryRun?: boolean;
};
type Field = Exclude<keyof UpdateInput, "ids" | "projectId" | "dryRun">;

const FIELDS: Record<Item["kind"], Field[]> = {
  task: ["title", "description", "status", "priority", "assignee", "startDate", "dueDate", "timebox", "obsolete", "comment"],
  feature: ["title", "description", "status", "priority"],
  testCase: ["title", "prepared", "priority", "addActivity"],
  document: [],
};
const KIND_NAME: Record<Item["kind"], string> = { task: "task", feature: "feature", testCase: "manual test case", document: "document" };

/** One field's part of the PATCH body, and how to show it from a row. */
type Part = {
  field: string;
  body: Record<string, unknown>;
  show: (row: Row) => string;
  /** Whether a read-back row holds what was sent; default: every body key equal. */
  stored?: (row: Row) => boolean;
};
type Planned = {
  item: Item;
  path: string;
  scope: string;
  before: Row;
  parts: Part[];
  ifMatch?: string;
  notes: string[];
  /** Done after the PATCH (test case activities). */
  extra?: { line: string; run: () => Promise<string> };
};

const changed = (row: Row, part: Part) => Object.entries(part.body).some(([k, v]) => (row[k] ?? null) !== v);
const lineOf = (part: Part, before: Row, after: Row) => `${part.field}: ${part.show(before)} → ${part.show(after)}`;

function refuseFields(items: Item[], input: UpdateInput) {
  const given = (Object.keys(input) as (keyof UpdateInput)[]).filter(
    (k): k is Field => !["ids", "projectId", "dryRun"].includes(k) && input[k] !== undefined,
  );
  if (!given.length) throw new CloudAlmError("bad_request", "give at least one change (title, description, status, priority…)");
  if (given.includes("title") && items.length > 1)
    throw new CloudAlmError("bad_request", "a title is changed one item at a time");
  const problems: string[] = [];
  for (const item of items) {
    if (item.kind === "document") {
      problems.push(
        `${itemLabel(item)}: a document cannot be changed through the Cloud ALM API (title, content, status, priority and type are fixed at create); delete it and create it again`,
      );
      continue;
    }
    if (item.kind === "testCase" && item.testCase.kind === "automated") {
      problems.push(`${itemLabel(item)}: automated test cases cannot be changed through the API`);
      continue;
    }
    const allowed = FIELDS[item.kind];
    const wrong = given.filter((f) => !allowed.includes(f));
    if (wrong.length)
      problems.push(`${itemLabel(item)}: a ${KIND_NAME[item.kind]} has no ${wrong.join(", ")} to change (it takes ${allowed.join(", ")})`);
  }
  if (problems.length) throw new CloudAlmError("bad_request", problems.join("; "));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function planTask(calm: CloudAlm, writer: CloudAlmWriter, snap: Snapshot, item: Item & { kind: "task" }, input: UpdateInput): Promise<Planned> {
  const t = item.task;
  const before = await readRow(calm, `${PATHS.tasks}/${t.id}`);
  const type = str(before.type) ?? t.type ?? "";
  const parts: Part[] = [];
  const notes: string[] = [];
  if (input.title !== undefined) parts.push({ field: "title", body: { title: input.title.trim() }, show: (r) => `"${short(str(r.title), 80)}"` });
  if (input.description !== undefined)
    parts.push({
      field: "description",
      body: { description: textToHtml(input.description) },
      show: (r) => `"${short(plainText(r.description) ?? "", 80)}"`,
      stored: (r) => plainText(r.description) === plainText(textToHtml(input.description ?? "")),
    });
  if (input.status !== undefined) {
    const change = taskStatus(type, input.status);
    const approval = str(before.approvalState);
    if (approval === "APPROVED" && change.approvalState && change.approvalState !== "APPROVED")
      throw new CloudAlmError("bad_request", `${t.displayId} is approved; Cloud ALM does not let an approval go back (to be approved, rejected)`);
    if (approval === "APPROVED" && change.approvalState === "APPROVED") delete change.approvalState;
    if (change.approvalState === "APPROVED")
      notes.push(`${t.displayId} becomes approved: an approval cannot be undone through the API, and an approved requirement cannot be deleted`);
    parts.push({ field: "status", body: change, show: taskStatusText });
  }
  if (input.priority !== undefined) parts.push({ field: "priority", body: { priorityId: input.priority }, show: (r) => priorityText(r.priorityId) });
  if (input.assignee !== undefined) {
    const who = input.assignee.trim();
    parts.push({
      field: "assignee",
      body: { assigneeId: who && who.toLowerCase() !== "none" ? who : null },
      show: (r) => str(r.assigneeName) ?? str(r.assigneeId) ?? "nobody",
    });
  }
  for (const field of ["startDate", "dueDate"] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (value && !DATE.test(value)) throw new CloudAlmError("bad_request", `${field} must be YYYY-MM-DD, or empty to clear it`);
    parts.push({ field, body: { [field]: value || null }, show: (r) => str(r[field]) ?? "none" });
  }
  if (input.timebox !== undefined) {
    const boxes = await snap.timeboxes();
    const wanted = input.timebox.trim().toLowerCase();
    const box = boxes.find((b) => b.id.toLowerCase() === wanted) ?? boxes.find((b) => (b.name ?? "").toLowerCase() === wanted);
    if (!box)
      throw new CloudAlmError("bad_request", `no timebox "${input.timebox}" in the project; it has ${boxes.map((b) => b.name).filter(Boolean).join(", ")}`);
    const name = (r: Row) => {
      const id = str(r.timeboxId);
      return id ? (boxes.find((b) => b.id === id)?.name ?? str(r.timeboxName) ?? id) : "none";
    };
    parts.push({ field: "timebox", body: { timeboxId: box.id }, show: name });
  }
  if (input.obsolete !== undefined) parts.push({ field: "obsolete", body: { obsolete: input.obsolete }, show: (r) => (r.obsolete === true ? "yes" : "no") });
  const text = input.comment?.trim();
  const extra = text
    ? {
        line: `comment: "${text.length > 300 ? `${text.slice(0, 300)}…` : text}"`,
        run: async () => {
          await needing("tasks.write", () => writer.post(`${PATHS.tasks}/${t.id}/comments`, { text: textToHtml(text) }));
          return "comment added";
        },
      }
    : undefined;
  return { item, path: `${PATHS.tasks}/${t.id}`, scope: "tasks.write", before, parts, notes, ...(extra ? { extra } : {}) };
}

async function planFeature(calm: CloudAlm, item: Item & { kind: "feature" }, input: UpdateInput): Promise<Planned> {
  const f = item.feature;
  const before = await readRow(calm, `${PATHS.features}/${f.id}`);
  const parts: Part[] = [];
  if (input.title !== undefined) parts.push({ field: "title", body: { title: input.title.trim() }, show: (r) => `"${short(str(r.title), 80)}"` });
  if (input.description !== undefined) {
    if (/<img\b/i.test(String(before.description ?? "")))
      throw new CloudAlmError(
        "bad_request",
        `${f.displayId}'s description holds images; Cloud ALM cannot save a new description for it through the API (it answers 500). Change it in the Cloud ALM UI`,
      );
    const html = textToHtml(input.description);
    parts.push({
      field: "description",
      body: { description: html },
      show: (r) => `"${short(plainText(r.description) ?? "", 80)}"`,
      stored: (r) => plainText(r.description) === plainText(html),
    });
  }
  if (input.status !== undefined) {
    const code = featureCode(input.status);
    const from = str(before.statusCode) ?? "";
    const next = FEATURE_NEXT[from];
    if (code !== from && next && !next.includes(code))
      throw new CloudAlmError(
        "bad_request",
        `Cloud ALM does not let a feature go from ${featureStatus(from)} to ${featureStatus(code)}; from ${featureStatus(from)} it allows ${next.map(featureStatus).join(", ")}`,
      );
    parts.push({ field: "status", body: { statusCode: code }, show: (r) => featureStatus(str(r.statusCode)) });
  }
  if (input.priority !== undefined) parts.push({ field: "priority", body: { priorityCode: input.priority }, show: (r) => priorityText(r.priorityCode) });
  return { item, path: `${PATHS.features}/${f.id}`, scope: "features.write", before, parts, notes: [] };
}

const activitiesOf = (row: Row) => (Array.isArray(row.toActivities) ? (row.toActivities as Row[]) : []);

async function planTestCase(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  item: Item & { kind: "testCase" },
  input: UpdateInput,
): Promise<Planned> {
  const tc = item.testCase;
  const before = await readRow(calm, `${PATHS.manualTestCases}/${tc.id}`, { $expand: "toActivities($expand=toActions)" });
  const parts: Part[] = [];
  if (input.title !== undefined) parts.push({ field: "title", body: { title: input.title.trim() }, show: (r) => `"${short(str(r.title), 80)}"` });
  if (input.prepared !== undefined) parts.push({ field: "prepared", body: { isPrepared: input.prepared }, show: (r) => (bool(r.isPrepared) ? "yes" : "no") });
  if (input.priority !== undefined) parts.push({ field: "priority", body: { priorityCode: input.priority }, show: (r) => priorityText(r.priorityCode) });
  const planned: Planned = { item, path: `${PATHS.manualTestCases}/${tc.id}`, scope: "testcases.write", before, parts, notes: [] };
  const etag = etagOf(before);
  if (etag) planned.ifMatch = etag;
  const add = input.addActivity;
  if (add) {
    const activities = activitiesOf(before);
    const sequence = activities.reduce((n, a) => Math.max(n, num(a.sequence) ?? 0), 0) + 1;
    planned.extra = {
      line: `activities: ${activities.length} → ${activities.length + 1} (adds "${short(add.title, 60)}" as activity ${sequence} with ${add.steps.length} steps: ${add.steps.map((s) => `"${short(s.title, 40)}"`).join(", ")})`,
      run: async () => {
        const created = (await needing("testcases.write", () =>
          writer.post("calm-testmanagement/v1/Activities", { parent_ID: tc.id, title: add.title, sequence, isInScope: true }),
        )) as { uuid?: string } | null;
        const activityId = str(created?.uuid);
        if (!activityId) return `activity "${add.title}" sent, but Cloud ALM did not return its id; its steps were not added`;
        let steps = 0;
        for (const [j, s] of add.steps.entries()) {
          await writer.post("calm-testmanagement/v1/Actions", {
            parent_ID: activityId,
            title: s.title,
            description: s.description,
            expectedResult: s.expected,
            sequence: j + 1,
            isEvidenceRequired: s.evidence ?? false,
          });
          steps++;
        }
        const back = await afterWrite("reading it back", () =>
          readRow(calm, `${PATHS.manualTestCases}/${tc.id}`, { $expand: "toActivities($expand=toActions)" }),
        );
        const count = typeof back === "string" ? back : `${activitiesOf(back).length} activities stored`;
        return `activities: ${activitiesOf(before).length} → added "${short(add.title, 60)}" with ${steps} steps (${count})`;
      },
    };
  }
  return planned;
}

/**
 * Change 1–20 items with the same changes: tasks, features, manual test
 * cases. Reads each, PATCHes only the fields that differ, reads back, and
 * answers before → after per field.
 */
export async function update(calm: CloudAlm, writer: CloudAlmWriter, input: UpdateInput, o: WriteOptions) {
  const snap = await snapshot(calm, input.projectId, o);
  const items = await itemsByRef(snap, input.ids);
  refuseFields(items, input);
  const plans: Planned[] = [];
  for (const item of items) {
    if (item.kind === "task") plans.push(await planTask(calm, writer, snap, item, input));
    else if (item.kind === "feature") plans.push(await planFeature(calm, item, input));
    else if (item.kind === "testCase") plans.push(await planTestCase(calm, writer, item, input));
  }
  const lines: string[] = [];
  const isDry = dry(o, input.dryRun);
  const noop = (p: Planned) => !p.extra && !p.parts.some((part) => changed(p.before, part));
  if (plans.length && plans.every(noop))
    return `${NOTHING_TO_DO} ${plans.map((p) => `${itemLabel(p.item)} already has ${p.parts.map((part) => `${part.field} ${part.show(p.before)}`).join(", ")}`).join("; ")}.`;
  if (isDry) lines.push(`${dryNote(o)} Would change:`);
  let failed = 0;
  let firstError: unknown;
  for (const p of plans) {
    const todo = p.parts.filter((part) => changed(p.before, part));
    const head = itemLabel(p.item);
    if (!todo.length && !p.extra) {
      lines.push(`${head}: no change (${p.parts.map((part) => `${part.field} already ${part.show(p.before)}`).join(", ")})`);
      continue;
    }
    const body = Object.assign({}, ...todo.map((part) => part.body)) as Record<string, unknown>;
    // Fields Cloud ALM derives (assignee name, a status's sub-status) are unknown until read back.
    const plannedRow: Row = {
      ...p.before,
      ...body,
      ...("assigneeId" in body ? { assigneeName: null } : {}),
      ...("status" in body && !("subStatus" in body) ? { subStatus: null } : {}),
    };
    if (isDry) {
      lines.push(`${head}:`);
      for (const part of todo) lines.push(`  ${lineOf(part, p.before, plannedRow)}`);
      if (p.extra) lines.push(`  ${p.extra.line}`);
      for (const n of p.notes) lines.push(`  Note: ${n}`);
      continue;
    }
    try {
      const out: string[] = [];
      if (todo.length) {
        await needing(p.scope, () => writer.patch(p.path, body, p.ifMatch ? { ifMatch: p.ifMatch } : {})).catch((error) => {
          if (error instanceof CloudAlmError && error.code === "bad_request" && "assigneeId" in body && /processor/i.test(error.reason))
            throw new CloudAlmError("bad_request", `${error.reason} The assignee must be the user id of a member of the project team`, error.status);
          throw error;
        });
        const after = await afterWrite("reading it back", () =>
          readRow(calm, p.path, p.item.kind === "testCase" ? { $expand: "toActivities" } : undefined),
        );
        for (const part of todo) {
          if (typeof after === "string") {
            out.push(`  ${lineOf(part, p.before, plannedRow)} (sent; ${after})`);
            continue;
          }
          const kept = !(part.stored ? part.stored(after) : Object.entries(part.body).every(([k, v]) => (after[k] ?? null) === v));
          out.push(`  ${lineOf(part, p.before, after)}${kept ? ` (asked for ${part.show(plannedRow)}; Cloud ALM stored this)` : ""}`);
        }
      }
      if (p.extra) out.push(`  ${await p.extra.run()}`);
      lines.push(`${head}:`, ...out);
    } catch (error) {
      failed++;
      firstError ??= error;
      lines.push(`${head}: not changed (${error instanceof CloudAlmError ? `${error.code}: ${error.reason}` : "unexpected error"})`);
    }
  }
  if (failed && failed === plans.length) throw firstError;
  return lines.join("\n");
}

// ---- calm_delete -----------------------------------------------------------

type DeletePlan = { item: Item; line: string; run: () => Promise<string> };

/**
 * Delete tasks (or with `soft`, mark them obsolete, which SAP recommends),
 * manual test cases (`force` also deletes their runs and results) and
 * documents. Features cannot be deleted through the API.
 */
export async function remove(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: { ids: string[]; soft?: boolean; force?: boolean; projectId?: string; dryRun?: boolean },
  o: WriteOptions,
) {
  const snap = await snapshot(calm, input.projectId, o);
  const items = await itemsByRef(snap, input.ids);
  const refused: string[] = [];
  for (const item of items) {
    if (item.kind === "feature")
      refused.push(`${itemLabel(item)}: features cannot be deleted through the Cloud ALM API; set it to not planned with calm_update (allowed from in specification)`);
    else if (item.kind === "testCase" && item.testCase.kind === "automated")
      refused.push(`${itemLabel(item)}: automated test cases cannot be deleted through the API`);
    else if (input.soft && item.kind !== "task")
      refused.push(`${itemLabel(item)}: soft applies to tasks only (it marks them obsolete)`);
    else if (input.force && item.kind !== "testCase")
      refused.push(`${itemLabel(item)}: force applies to test cases only (it deletes their runs and results)`);
  }
  if (refused.length) throw new CloudAlmError("bad_request", refused.join("; "));
  const plans: DeletePlan[] = [];
  for (const item of items) plans.push(await deletePlan(calm, writer, snap, item, input));
  // Warn about what a bulk delete takes with it.
  const warnings: string[] = [];
  const hardTasks = items.filter((i): i is Item & { kind: "task" } => i.kind === "task" && !input.soft);
  if (hardTasks.length) {
    const tasks = await snap.tasks();
    const byType = new Map<string, number>();
    for (const i of hardTasks) byType.set(i.task.type ?? "", (byType.get(i.task.type ?? "") ?? 0) + 1);
    for (const [type, n] of byType) {
      const all = tasks.filter((t) => t.type === type).length;
      if (n === all && n > 1) warnings.push(`this deletes every ${typeLabel(type)} in the project (${n} of ${n})`);
    }
    const links = await snap.defects().catch(() => null);
    const fromTests = hardTasks.filter((i) => links?.byDefect.has(i.task.id.toLowerCase())).length;
    if (fromTests) warnings.push(`${fromTests} of them record a failed test (their test case loses its defect)`);
    if (hardTasks.length >= 3 || warnings.length) warnings.push("soft: true marks them obsolete instead, which can be undone");
  }
  if (dry(o, input.dryRun))
    return [`${dryNote(o)} Would:`, ...plans.map((p) => `- ${p.line}`), ...(warnings.length ? [`Warning: ${warnings.join("; ")}.`] : [])].join("\n");
  const lines: string[] = [];
  let failed = 0;
  let firstError: unknown;
  for (const p of plans) {
    try {
      lines.push(await p.run());
    } catch (error) {
      failed++;
      firstError ??= error;
      lines.push(`${itemLabel(p.item)}: not deleted (${error instanceof CloudAlmError ? `${error.code}: ${error.reason}` : "unexpected error"})`);
    }
  }
  if (failed === plans.length) throw firstError;
  return lines.join("\n");
}

const goneNote = async (what: string, read: () => Promise<unknown>) => {
  const check = await gone(read);
  return check === true ? `Deleted ${what}.` : check === false ? `${what}: Cloud ALM accepted the delete, but it still reads back` : `Deleted ${what} (read back ${check}).`;
};

async function deletePlan(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  snap: Snapshot,
  item: Item,
  input: { soft?: boolean; force?: boolean },
): Promise<DeletePlan> {
  const name = itemLabel(item);
  if (item.kind === "task") {
    const path = `${PATHS.tasks}/${item.id}`;
    const row = await readRow(calm, path);
    if (input.soft) {
      if (row.obsolete === true)
        return { item, line: `${name}: already obsolete, nothing to do`, run: async () => `${name}: already obsolete.` };
      return {
        item,
        line: `mark ${name} obsolete (soft delete: it stays, with its links and history; obsolete: no → yes)`,
        run: async () => {
          await needing("tasks.write", () => writer.patch(path, { obsolete: true }));
          const back = await afterWrite("reading it back", () => readRow(calm, path));
          return typeof back === "string" ? `Marked ${name} obsolete (${back}).` : `Marked ${name} obsolete: obsolete ${back.obsolete === true ? "yes" : "no"}.`;
        },
      };
    }
    if (row.type === "CALMREQU" && row.approvalState === "APPROVED")
      throw new CloudAlmError("bad_request", `${name} is approved; Cloud ALM does not delete approved requirements. Use soft: true to mark it obsolete`);
    return {
      item,
      line: `delete ${name} (status ${statusLabel(str(row.status))}) with its comments and links; cannot be undone (soft: true marks it obsolete instead, which SAP recommends)`,
      run: async () => {
        await needing("tasks.write", () => writer.delete(path));
        return goneNote(name, () => readRow(calm, path));
      },
    };
  }
  if (item.kind === "testCase") {
    const path = `${PATHS.manualTestCases}/${item.id}`;
    const row = await readRow(calm, path, { $expand: "toActivities($expand=toActions),toTaskAssignments" });
    const activities = activitiesOf(row);
    const steps = activities.reduce((n, a) => n + (Array.isArray(a.toActions) ? a.toActions.length : 0), 0);
    const tasks = await snap.tasks();
    const links = (Array.isArray(row.toTaskAssignments) ? (row.toTaskAssignments as Row[]) : []).map(
      (r) => str(r.taskDisplayId) ?? tasks.find((t) => t.id === r.taskId)?.displayId ?? str(r.taskId),
    );
    const what = `${name} (${activities.length} activities, ${steps} steps${links.length ? `, linked to ${links.join(", ")}` : ""})`;
    const etag = etagOf(row);
    const ifMatch = etag ? { ifMatch: etag } : {};
    if (input.force)
      return {
        item,
        line: `force-delete ${what} together with all its test runs and results; cannot be undone`,
        run: async () => {
          await needing("testcases.force-delete", () =>
            writer.post(`${path}/api.v1.ExternalTestCaseServiceAPI.forceDeletionIncludingTestRunsAndResults`, {}, ifMatch),
          );
          return goneNote(`${name} with its runs and results`, () => readRow(calm, path));
        },
      };
    return {
      item,
      line: `delete ${what}; cannot be undone. Cloud ALM refuses when the test case has test runs (then force: true deletes them too)`,
      run: async () => {
        try {
          await needing("testcases.delete", () => writer.delete(path, ifMatch));
        } catch (error) {
          if (error instanceof CloudAlmError && error.code === "bad_request")
            throw new CloudAlmError("bad_request", `${error.reason}. If it has test runs, force: true deletes them with it`, error.status);
          throw error;
        }
        return goneNote(name, () => readRow(calm, path));
      },
    };
  }
  if (item.kind === "document") {
    const path = `${PATHS.documents}/${item.id}`;
    const d = item.document;
    const links = d.taskIds.length + d.testCaseIds.length + d.processIds.length;
    return {
      item,
      line: `delete ${name} (${documentType(d.documentTypeCode)}${links ? `, with its ${links} links` : ""}); cannot be undone`,
      run: async () => {
        await needing("documents.delete", () => writer.delete(path));
        return goneNote(name, () => readRow(calm, path, { $select: "uuid" }));
      },
    };
  }
  throw new CloudAlmError("bad_request", `${name} cannot be deleted through the API`);
}

// ---- calm_comment ----------------------------------------------------------

export async function comment(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: { task: string; text: string; projectId?: string; dryRun?: boolean },
  o: WriteOptions,
) {
  const snap = await snapshot(calm, input.projectId, o);
  const [task] = await tasksByRef(snap, [input.task]);
  if (!task) throw new CloudAlmError("not_found", `${input.task} not found`);
  const text = input.text.trim();
  if (!text) throw new CloudAlmError("bad_request", "the comment is empty");
  if (dry(o, input.dryRun)) return `${dryNote(o)} Would add to ${label(task)} the comment:\n${text.length > 4000 ? `${text.slice(0, 3999)}…` : text}`;
  const created = (await needing("tasks.write", () =>
    writer.post(`${PATHS.tasks}/${task.id}/comments`, { text: textToHtml(text) }),
  )) as { id?: string } | null;
  return `Added a comment to ${label(task)}${created?.id ? ` [${created.id}]` : ""}.`;
}

// ---- calm_create_feature ---------------------------------------------------

export async function createFeature(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: { title: string; description?: string; status?: string; priority?: number; tasks?: string[]; projectId?: string; dryRun?: boolean },
  o: WriteOptions,
) {
  const snap = await snapshot(calm, input.projectId, o);
  const features = await snap.features();
  requireComplete(snap);
  const title = input.title.trim();
  const duplicate = features.find((f) => (f.title ?? "").trim().toLowerCase() === title.toLowerCase());
  if (duplicate)
    throw new CloudAlmError("bad_request", `a feature with this title exists: ${duplicate.displayId} (${featureStatus(duplicate.statusCode)}); features cannot be deleted, so no duplicate is created`);
  const tasks = await tasksByRef(snap, input.tasks ?? []);
  const statusCode = input.status ? featureCode(input.status) : "CREATED";
  const body = {
    projectId: snap.project.id,
    title,
    ...(input.description ? { description: textToHtml(input.description) } : {}),
    statusCode,
    priorityCode: input.priority ?? 30,
  };
  const plan = `feature "${title}" (${featureStatus(statusCode)}, priority ${priorityText(body.priorityCode)})${tasks.length ? ` linked to ${tasks.map(label).join("; ")}` : ""}`;
  if (dry(o, input.dryRun))
    return `${dryNote(o)} Would create ${plan}.\nNote: features cannot be deleted through the Cloud ALM API.`;
  const created = (await needing("features.write", () => writer.post(PATHS.features, body))) as { uuid?: string; displayId?: string } | null;
  const id = str(created?.uuid);
  if (!id)
    return `Cloud ALM accepted the feature "${title}" but did not return its id. Check with calm_list before trying again: a retry would create a duplicate.`;
  const linked: string[] = [];
  const failed: string[] = [];
  for (const t of tasks) {
    try {
      await needing("tasks.write", () => writer.post(`${PATHS.tasks}/${t.id}/featureAssignments`, { featureId: id }));
      linked.push(t.displayId ?? t.id);
    } catch (error) {
      failed.push(`${t.displayId}: ${error instanceof CloudAlmError ? error.reason : "failed"}`);
    }
  }
  const back = await afterWrite("reading it back", () => readRow(calm, `${PATHS.features}/${id}`));
  const stored = typeof back === "string" ? back : `${featureStatus(str(back.statusCode))}, priority ${priorityText(back.priorityCode)}`;
  return [
    `Created ${str(created?.displayId) ?? ""} feature "${title}" [${id}]: ${stored}${linked.length ? `; linked to ${linked.join(", ")}` : ""}.`,
    failed.length ? `Links that failed: ${failed.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- calm_create_document --------------------------------------------------

/** Document types of Cloud ALM (`calm-documents/v1/DocumentTypes`). */
const DOCUMENT_TYPES: Record<string, string> = {
  BP: "Business Process Document",
  CG: "Configuration Guide",
  EU: "End-User Documentation",
  FS: "Fact Sheet",
  FU: "Functional Specification",
  IS: "Interface Specification",
  JD: "Job Documentation",
  NA: "Default",
  NT: "Note",
  PJ: "Project Documentation",
  SD: "Solution Design Document",
  TD: "Technical Design Document",
  TE: "Test Document",
  TR: "Training Material",
};
export const DOCUMENT_TYPE_HELP = Object.entries(DOCUMENT_TYPES)
  .map(([c, n]) => `${c} ${n}`)
  .join(", ");
const DOCUMENT_STATUS: Record<string, number> = { "in progress": 10, "in review": 20, released: 30 };
const DOCUMENT_STATUS_NAME: Record<number, string> = { 10: "in progress", 20: "in review", 30: "released" };

function documentTypeCode(wanted: string): string {
  const w = wanted.trim();
  const code = w.toUpperCase();
  if (DOCUMENT_TYPES[code]) return code;
  const byName = Object.entries(DOCUMENT_TYPES).find(([, n]) => n.toLowerCase() === w.toLowerCase());
  if (byName) return byName[0];
  throw new CloudAlmError("bad_request", `no document type "${wanted}"; Cloud ALM has ${DOCUMENT_TYPE_HELP}`);
}

export async function createDocument(
  calm: CloudAlm,
  writer: CloudAlmWriter,
  input: { title: string; content: string; type?: string; status?: string; priority?: number; tasks?: string[]; projectId?: string; dryRun?: boolean },
  o: WriteOptions,
) {
  const snap = await snapshot(calm, input.projectId, o);
  const documents = await snap.documents();
  requireComplete(snap);
  const title = input.title.trim();
  const duplicate = documents.find((d) => (d.title ?? "").trim().toLowerCase() === title.toLowerCase());
  if (duplicate) throw new CloudAlmError("bad_request", `a document with this title exists: ${duplicate.displayId}; no duplicate is created`);
  const tasks: TaskSummary[] = await tasksByRef(snap, input.tasks ?? []);
  const typeCode = input.type ? documentTypeCode(input.type) : undefined;
  const status = input.status ? DOCUMENT_STATUS[words(input.status)] : 10;
  if (status === undefined) throw new CloudAlmError("bad_request", `a document has no status "${input.status}"; it takes in progress, in review, released`);
  const content = textToHtml(input.content);
  const body = {
    projectId: snap.project.id,
    title,
    content,
    ...(typeCode ? { documentTypeCode: typeCode } : {}),
    statusCode: status,
    priorityCode: input.priority ?? 30,
    ...(tasks.length ? { toTaskAssignments: tasks.map((t) => ({ id: t.id })) } : {}),
  };
  const plan = `document "${title}" (${typeCode ? DOCUMENT_TYPES[typeCode] : "default type"}, ${DOCUMENT_STATUS_NAME[status]}, priority ${priorityText(body.priorityCode)}, ${input.content.trim().length} characters of content: "${short(input.content, 120)}")${tasks.length ? ` linked to ${tasks.map(label).join("; ")}` : ""}`;
  if (dry(o, input.dryRun))
    return `${dryNote(o)} Would create ${plan}.\nNote: after create, Cloud ALM's API cannot change a document's title, content, status, priority or type; deleting it needs calm-api.documents.delete.`;
  const created = (await needing("documents.write", () => writer.post(PATHS.documents, body))) as { uuid?: string; displayId?: string } | null;
  const id = str(created?.uuid);
  if (!id)
    return `Cloud ALM accepted the document "${title}" but did not return its id. Check with calm_list before trying again: a retry would create a duplicate.`;
  const back = await afterWrite("reading it back", () => readRow(calm, `${PATHS.documents}/${id}`, { $expand: "toTaskAssignments" }));
  const stored =
    typeof back === "string"
      ? back
      : `${documentType(str(back.documentTypeCode))}, ${DOCUMENT_STATUS_NAME[num(back.statusCode) ?? 0] ?? "?"}, linked to ${Array.isArray(back.toTaskAssignments) ? back.toTaskAssignments.length : 0} tasks`;
  return `Created ${str(created?.displayId) ?? ""} document "${title}" [${id}]: ${stored}.`;
}
