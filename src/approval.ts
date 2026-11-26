/**
 * Human approval of writes. A write the agent asks for is first run as a
 * dry run; the preview goes to the user, and only their approval runs it.
 *
 * Every write is first a proposal, whatever the client says it supports
 * (hosts draw the card from the tool definition even when they do not
 * declare MCP Apps support, and some declare dialogs they decline unseen).
 * The same pending change can then be approved:
 * - in the card: an MCP Apps view (Claude, ChatGPT, VS Code…) whose buttons
 *   call the app-only `calm_approve` tool, with a nonce the model never sees
 *   (it travels in the result's `_meta` only);
 * - in the chat (not in mode `required`, as it trusts the agent to ask):
 *   the user says yes and the agent calls `calm_confirm`. A card that can
 *   approve takes the change for itself (`cardShown`), and the chat is
 *   refused for the first seconds so that such a card gets there first.
 *
 * What this cannot do: tell a user's yes from an agent that claims one. In
 * an app without a working card the last guard is the app's own permission
 * prompt for `calm_confirm`; mode `required` closes that path altogether.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { sapLogo } from "./sap-logo.js";
import { metricsCss, metricsScript } from "./project-metrics.js";
import type { WriteOutcome } from "./write-outcome.js";
import { CARD_TEMPLATE } from "./approval-card.js";
import { OVERVIEW_TEMPLATE } from "./overview-card.js";

/** off: write at once; prefer: approve in the card, or in the chat where no card can; required: in the card only. */
export type ApprovalMode = "off" | "prefer" | "required";
export const APPROVAL_MODES: ApprovalMode[] = ["off", "prefer", "required"];

/** `CALM_APPROVAL`: `card` accepts the card only; `chat` (or unset) also the chat where no card can approve. */
export const APPROVAL_ENV = "CALM_APPROVAL";
export function approvalFromEnv(env: Record<string, string | undefined>): Exclude<ApprovalMode, "off"> {
  const value = env[APPROVAL_ENV]?.trim().toLowerCase();
  if (!value || value === "chat") return "prefer";
  if (value === "card") return "required";
  throw new Error(`${APPROVAL_ENV} must be "card" or "chat"`);
}

/**
 * Hosts keep a card by its address: give it a new one whenever the card
 * changes (test/card.test.ts fails until you do), and keep the one before in
 * the list of earlier addresses, which still answer with the current card: an
 * app that listed the tools before an update asks for the address it knows.
 */
export const CARD_URI = "ui://cloud-alm/approve-v6.html";
export const CARD_URIS_BEFORE = ["ui://cloud-alm/approve-v5.html", "ui://cloud-alm/approve-v4.html", "ui://cloud-alm/approve-v3.html"];
export const META_KEY = "cloud-alm/approval";
/** Long enough for a user who answers a turn later; still single-use and bound to one change. */
export const TTL_MS = 60 * 60_000;
const MAX_PENDING = 1000;
/** Per approver, so one HTTP caller cannot push out everyone else's. */
const MAX_PER_SUBJECT = 50;
/**
 * A yes in the chat is not taken this soon after the proposal: a card
 * that can approve claims the change within a second or two of being
 * drawn, and a person needs longer than this to read and answer.
 */
export const CHAT_HOLD_MS = 10_000;

/** A write waiting for the user. Holds the tool name and its arguments, not a client. */
type Pending = {
  tool: string;
  /** Whether it may be taken without the card's nonce (mode prefer). */
  allowChat: boolean;
  args: Record<string, unknown>;
  fingerprint: string;
  subject: string;
  nonce: Buffer;
  createdAt: number;
  expiresAt: number;
};

/**
 * Pending writes, process-wide: in HTTP mode every request gets a new
 * server, and the approval arrives in a later request.
 */
const pending = new Map<string, Pending>();

/** How a proposal ended. `working` while its write runs; `failed` when the write was refused. */
export type Outcome = { status: "working" | "approved" | "rejected" | "failed" | WriteOutcome["status"]; summary?: string; outcome?: WriteOutcome };
/** A decided proposal keeps this much of the write's answer. */
const MAX_SUMMARY = 2000;
/**
 * Decided proposals, until they would have expired: a card drawn again
 * (a reload, another device) shows what happened instead of live buttons,
 * and a second approval is told the outcome, not "nothing was written".
 */
const decided = new Map<string, Outcome & { subject: string; expiresAt: number }>();

/** Who may approve: the stdio user, or the holder of the same bearer token. */
export const subjectOf = (token: string | undefined) =>
  token ? createHash("sha256").update(token).digest("hex") : "local";

/** SAP may reorder JSON object properties between reads. Keep array order significant. */
export function planFingerprint(plan: unknown): string {
  const canonical = JSON.stringify(plan, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Record<string, unknown>)[key]]))
      : value
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export type Proposal = { id: string; nonce: string; expiresAt: number };

export function propose(
  entry: Omit<Pending, "nonce" | "createdAt" | "expiresAt">,
  now = Date.now(),
): Proposal {
  for (const [id, p] of pending) if (p.expiresAt <= now) pending.delete(id);
  const own = [...pending].filter(([, p]) => p.subject === entry.subject);
  while (own.length >= MAX_PER_SUBJECT) pending.delete(own.shift()![0]);
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  const id = randomBytes(6).toString("hex");
  const nonce = randomBytes(16);
  const expiresAt = now + TTL_MS;
  pending.set(id, { ...entry, nonce, createdAt: now, expiresAt });
  return { id, nonce: nonce.toString("base64url"), expiresAt };
}

export class ApprovalError extends Error {}

/**
 * Take a pending write out (single use). With `nonce`, it must match: the
 * card path. Without, only entries that allow the chat (mode prefer) may,
 * and not within `hold` of the proposal.
 */
export function take(
  id: string,
  subject: string,
  nonce: string | undefined,
  now = Date.now(),
  tool?: string,
  hold = CHAT_HOLD_MS,
): Pending {
  const p = pending.get(id);
  const d = decided.get(id);
  if (d?.outcome && d.subject === subject && d.expiresAt > now)
    throw new ApprovalError(`This approval was already used. ${d.status === "partial" ? "The change was partly applied." : "The write could not be confirmed."} Check the items in Cloud ALM before trying any remaining changes.${d.summary ? ` Previous answer: ${d.summary}` : ""}`);
  if (d && d.subject === subject && d.expiresAt > now)
    throw new ApprovalError(
      d.status === "rejected"
        ? "This change was already rejected; nothing was written."
        : d.status === "failed"
          ? `This approval was already used and its write failed; it is not run again. Propose the change again.${d.summary ? ` Answer then: ${d.summary}` : ""}`
          : `This change was already approved; it is not run again.${d.summary ? ` Answer then: ${d.summary}` : ""}`,
    );
  if (!p || p.expiresAt <= now) {
    pending.delete(id);
    throw new ApprovalError("This approval is unknown or expired; nothing was written. Propose the change again and ask the user.");
  }
  if (p.subject !== subject) throw new ApprovalError("This approval belongs to another session; nothing was written.");
  if (tool !== undefined && tool !== p.tool)
    throw new ApprovalError(`This approval is for ${p.tool}, not ${tool}; nothing was written.`);
  if (nonce === undefined && !p.allowChat)
    throw new ApprovalError("This change can only be approved in the approval card; nothing was written. The card is on the user's screen: they approve or reject it there. Do not confirm it for them.");
  if (nonce === undefined && now - p.createdAt < hold)
    throw new ApprovalError("Too early; nothing was written. This change waits for the user: they approve it in the approval card, or answer in the chat. Confirm only after their own message says yes to this exact change; if it already has, confirm again in a few seconds.");
  if (nonce !== undefined) {
    const given = Buffer.from(nonce, "base64url");
    if (given.length !== p.nonce.length || !timingSafeEqual(given, p.nonce))
      throw new ApprovalError("Approval refused: bad token; nothing was written.");
  }
  pending.delete(id);
  for (const [key, e] of decided) if (e.expiresAt <= now) decided.delete(key);
  while (decided.size >= MAX_PENDING) {
    const oldest = decided.keys().next().value;
    if (oldest === undefined) break;
    decided.delete(oldest);
  }
  decided.set(id, { subject, expiresAt: p.expiresAt, status: "working" });
  return p;
}

/**
 * A card that can approve is on the user's screen (it proved so with the
 * nonce only it holds): from now on only that card decides, and a yes
 * passed on by the agent in the chat is refused.
 */
export function cardShown(id: string, subject: string, nonce: string, now = Date.now()) {
  const p = pending.get(id);
  if (!p || p.subject !== subject || p.expiresAt <= now) return;
  const given = Buffer.from(nonce, "base64url");
  if (given.length === p.nonce.length && timingSafeEqual(given, p.nonce)) p.allowChat = false;
}

/** What came of a taken proposal. */
export function settle(id: string, status: Exclude<Outcome["status"], "working">, summary?: string, outcome?: WriteOutcome) {
  const d = decided.get(id);
  if (!d) return;
  d.status = status;
  if (outcome) d.outcome = outcome;
  if (summary) d.summary = summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)} …` : summary;
}

/** Where a proposal stands, for its approver only; anyone else's is unknown. */
export function statusOf(id: string, subject: string, now = Date.now()): Outcome | { status: "pending" | "unknown" } {
  const d = decided.get(id);
  if (d && d.subject === subject && d.expiresAt > now) return { status: d.status, ...(d.outcome ? { outcome: d.outcome } : {}), ...(d.summary ? { summary: d.summary } : {}) };
  const p = pending.get(id);
  return { status: p && p.subject === subject && p.expiresAt > now ? "pending" : "unknown" };
}

/** Forget every pending and decided write (tests). */
export function clearPending() {
  pending.clear();
  decided.clear();
}

let appJs: string | undefined;

/** The MCP Apps client bundle, with its exports turned into a local `App`. */
export function appBundle(): string {
  if (appJs) return appJs;
  const path = createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps");
  // A blob document already includes its origin in its pathname.
  const source = readFileSync(path, "utf8").replace(
    "new URL(self.location.origin+self.location.pathname+location.search)",
    'new URL(self.location.protocol === "blob:" ? self.location.origin + "/" : self.location.href)',
  );
  const exports = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(source);
  const local = exports?.[1]
    ?.split(",")
    .map((s) => s.trim().split(/\s+as\s+/))
    .find(([, name]) => name === "App")?.[0];
  if (!exports || !local) throw new Error("ext-apps bundle has an unexpected shape");
  // The card also themes itself from the host: expose those helpers too.
  const pairs = (exports[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/));
  const helper = (name: string) => pairs.find(([, n]) => n === name)?.[0] ?? pairs.find(([n, alias]) => !alias && n === name)?.[0];
  const theme = (["applyDocumentTheme", "applyHostStyleVariables"] as const)
    .map((name) => `const ${name} = ${helper(name) ?? "() => {}"};`)
    .join("\n");
  appJs = `${source.slice(0, exports.index)}\nconst App = ${local};\n${theme}\n`;
  return appJs;
}

/**
 * The approval card. Shows the server's preview (never HTML from the
 * model or the tenant: text only), and Approve / Reject.
 */
export const OVERVIEW_URI = "ui://cloud-alm/overview-v3.html";
export const OVERVIEW_URIS_BEFORE = ["ui://cloud-alm/overview-v2.html", "ui://cloud-alm/overview-v1.html"];

/** The project overview card. */
export function overviewHtml(): string {
  return OVERVIEW_TEMPLATE.replace("<!--sap-logo-->", () => sapLogo).replace("/*__METRICS_CSS__*/", metricsCss).replace("/*__METRICS_JS__*/", metricsScript).replace("/*__APP_BUNDLE__*/", () => appBundle());
}

export function cardHtml(): string {
  return CARD_TEMPLATE.replace("<!--sap-logo-->", () => sapLogo).replace("/*__APP_BUNDLE__*/", () => appBundle()).replace("__META_KEY__", META_KEY);
}
