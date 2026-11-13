/** Short labels and lines shared by the opinionated tools. */
import { TASK_TYPES, type TaskSummary, type TaskTypeCode } from "../calm/index.js";
import type { SnapDocument, SnapFeature, SnapTestCase } from "./snapshot.js";

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
    statusLabel(t.status),
    t.priority !== null ? `priority ${t.priority}` : null,
    `"${short(t.title)}"`,
    t.tags.length ? `#${t.tags.join(" #")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

export const featureLine = (f: SnapFeature) =>
  `${f.displayId ?? "?"} · feature · ${featureStatus(f.statusCode)} · "${short(f.title)}"`;

export const testCaseLine = (t: SnapTestCase) =>
  `${t.displayId ?? "?"} · ${t.kind} test case${t.prepared === false ? " · not prepared" : ""} · "${short(t.title)}"`;

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
