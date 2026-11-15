/** Short labels and lines shared by the opinionated tools. */
import { TASK_TYPES, type TaskSummary, type TaskTypeCode } from "../calm/index.js";
import type { SnapDocument, SnapFeature, SnapTestCase, TestResult } from "./snapshot.js";

const STATES: Record<string, string> = {
  OPEN: "open",
  INP: "in progress",
  BLK: "blocked",
  REV: "in review",
  DONE: "done",
  CLOSE: "done",
  NO: "not relevant",
  NR: "not relevant",
};

/** `CIPREQUOPEN` → "open"; unknown codes stay as they are. */
export function statusLabel(code: string | null): string {
  if (!code) return "?";
  const m = /^CIP(?:DFCT|REQU|TK|US|QG|RI|ST|CL|RSK)(OPEN|INP|BLK|REV|DONE|CLOSE|NO|NR)$/.exec(code);
  return m ? (STATES[m[1] as string] ?? code) : code;
}
export const isOpen = (code: string | null) =>
  !["done", "not relevant"].includes(statusLabel(code));

const SUB_STATES: Record<string, string | null> = {
  // A requirement's sub-status "CREATED" is shown as "in refinement" in Cloud ALM.
  CREATED: "in refinement",
};
/**
 * A task's sub-status in words: `DFC_NEW` → "new", `DFC_RETEST_REQ` →
 * "retest required". Null when there is none.
 */
export function subStatusLabel(code: string | null): string | null {
  if (!code) return null;
  if (code in SUB_STATES) return SUB_STATES[code] ?? null;
  return code
    .replace(/^[A-Z]{2,4}_/, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\breq\b/, "required")
    .replace(/\binp\b/, "in progress")
    .trim() || null;
}

/** A requirement's fit-to-standard classification: `REQ_FIT` → "fit". */
export function classificationLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return code.replace(/^REQ_/, "").toLowerCase().replace(/_/g, " ") || null;
}

const APPROVALS: Record<string, string> = {
  READY_4_APPR: "to be approved",
  APPROVED: "approved",
  REJECTED: "rejected",
  NOT_RELEVANT: "not relevant",
};
/** A requirement's approval state in words. */
export const approvalLabel = (code: string | null | undefined) =>
  code ? (APPROVALS[code] ?? code.toLowerCase().replace(/_/g, " ")) : null;

/** "open (new)" for a defect, "open" for a task without a sub-status. */
export function taskStatus(t: { status: string | null; subStatus: string | null }): string {
  const main = statusLabel(t.status);
  const sub = subStatusLabel(t.subStatus);
  return sub && sub !== main ? `${main} (${sub})` : main;
}

const PRIORITIES: Record<number, string> = { 10: "very high", 20: "high", 30: "medium", 40: "low" };
/** Cloud ALM priority codes in words: 10 → "very high" … 40 → "low". */
export const priorityLabel = (code: number | null) =>
  code === null ? null : (PRIORITIES[code] ?? String(code));

export const typeLabel = (type: string | null) =>
  type ? (TASK_TYPES[type as TaskTypeCode] ?? type) : "task";

const FEATURE_STATES: Record<string, string> = {
  CREATED: "in specification",
  NOT_PLANNED: "not planned",
  IN_REALIZATION: "in realization",
  IN_TESTING: "in testing",
  SUCCESSFULLY_TESTED: "tested",
  APPROVED_FOR_DEPLOYMENT: "approved for deployment",
  DEPLOYED: "deployed",
  CONFIRMED: "confirmed",
};
export const featureStatus = (code: string | null) =>
  code ? (FEATURE_STATES[code] ?? code.toLowerCase()) : "?";

const DOCUMENT_TYPES: Record<string, string> = {
  NA: "document",
  PJ: "project document",
  BP: "business process document",
  SD: "solution design",
  FU: "functional spec",
  TD: "technical design",
  CG: "configuration guide",
  IS: "interface spec",
  TE: "test document",
  EU: "end-user document",
  TR: "training",
  FS: "functional spec",
  NT: "note",
  JD: "job description",
};
export const documentType = (code: string | null) =>
  code ? (DOCUMENT_TYPES[code] ?? code) : "document";

/** A title shortened for list lines. */
export const short = (text: string | null, max = 90) => {
  const t = (text ?? "(no title)").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const taskLine = (t: TaskSummary) =>
  [
    t.displayId ?? "?",
    typeLabel(t.type),
    taskStatus(t),
    t.priority !== null ? `priority ${priorityLabel(t.priority)}` : null,
    t.classification ? classificationLabel(t.classification) : null,
    t.approvalState ? approvalLabel(t.approvalState) : null,
    `"${short(t.title)}"`,
    t.assigneeName ? `@${t.assigneeName}` : "unassigned",
    t.dueDate ? `due ${t.dueDate}` : null,
    t.tags.length ? `#${t.tags.join(" #")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

export const featureLine = (f: SnapFeature) =>
  `${f.displayId ?? "?"} · feature · ${featureStatus(f.statusCode)}${f.priorityCode !== null ? ` · priority ${priorityLabel(f.priorityCode)}` : ""} · "${short(f.title)}"${f.tags.length ? ` · #${f.tags.join(" #")}` : ""}`;

/** One result in words: "failed, 3 of 4 steps passed", "not run yet". */
export function resultWords(r: TestResult): string {
  const status = r.status.toLowerCase();
  if (status === "initial") return "not run";
  return `${status}${r.steps ? `, ${r.passed} of ${r.steps} steps passed` : ""}`;
}

/** "failed, 3 of 4 steps passed in UAT cycle 1" for each plan the test case is in. */
export const resultText = (results: TestResult[] | undefined) =>
  (results ?? [])
    .map((r) => `${resultWords(r)} in ${short(r.plan, 40)}`)
    .join("; ");

export const testCaseLine = (t: SnapTestCase, results?: TestResult[]) => {
  const result = resultText(results);
  return `${t.displayId ?? "?"} · ${t.kind} test case · ${t.prepared === false ? "not prepared" : "prepared"} · ${result || "not run"} · "${short(t.title)}"${t.tags.length ? ` · #${t.tags.join(" #")}` : ""}`;
};

export const documentLine = (d: SnapDocument) =>
  `${d.displayId ?? "?"} · ${documentType(d.documentTypeCode)} · "${short(d.title)}"`;

/** "a, b and 3 more" for capped lists. */
export function capped<T>(items: T[], line: (t: T) => string, max = 30): string[] {
  const out = items.slice(0, max).map((i) => `- ${line(i)}`);
  if (items.length > max) out.push(`- … and ${items.length - max} more`);
  return out;
}

/** Count values: "8 open, 2 done". */
export function counts(values: string[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
}

/** Display ids sort by their numbers: 3-2 before 3-10. */
export function byDisplayId(a: { displayId: string | null }, b: { displayId: string | null }) {
  const pa = (a.displayId ?? "").split("-").map(Number);
  const pb = (b.displayId ?? "").split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
