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
 * - in the chat (mode `prefer` only, as it trusts the agent to ask): the
 *   user says yes and the agent calls `calm_confirm`;
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { metricsCss, metricsScript } from "./project-metrics.js";
import { CARD_TEMPLATE } from "./approval-card.js";
import { OVERVIEW_TEMPLATE } from "./overview-card.js";

/** off: write at once; prefer: approve in the card or the chat; required: in the card (or an opted-in dialog) only. */
export type ApprovalMode = "off" | "prefer" | "required";
export const APPROVAL_MODES: ApprovalMode[] = ["off", "prefer", "required"];

export const CARD_URI = "ui://cloud-alm/approve-v2.html";
export const META_KEY = "cloud-alm/approval";
/** Long enough for a user who answers a turn later; still single-use and bound to one change. */
export const TTL_MS = 60 * 60_000;
const MAX_PENDING = 1000;
/** Per approver, so one HTTP caller cannot push out everyone else's. */
const MAX_PER_SUBJECT = 50;

/** A write waiting for the user. Holds the tool name and its arguments, not a client. */
type Pending = {
  tool: string;
  /** Whether it may be taken without the card's nonce (mode prefer). */
  allowChat: boolean;
  args: Record<string, unknown>;
  preview: string;
  subject: string;
  nonce: Buffer;
  expiresAt: number;
};

/**
 * Pending writes, process-wide: in HTTP mode every request gets a new
 * server, and the approval arrives in a later request.
 */
const pending = new Map<string, Pending>();

/** Who may approve: the stdio user, or the holder of the same bearer token. */
export const subjectOf = (token: string | undefined) =>
  token ? createHash("sha256").update(token).digest("hex") : "local";

export type Proposal = { id: string; nonce: string; expiresAt: number };

export function propose(
  entry: Omit<Pending, "nonce" | "expiresAt">,
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
  pending.set(id, { ...entry, nonce, expiresAt });
  return { id, nonce: nonce.toString("base64url"), expiresAt };
}

export class ApprovalError extends Error {}

/**
 * Take a pending write out (single use). With `nonce`, it must match: the
 * card path. Without, only entries that allow the chat (mode prefer) may.
 */
export function take(
  id: string,
  subject: string,
  nonce: string | undefined,
  now = Date.now(),
  tool?: string,
): Pending {
  const p = pending.get(id);
  if (!p || p.expiresAt <= now) {
    pending.delete(id);
    throw new ApprovalError("This approval is unknown or expired; nothing was written. Propose the change again and ask the user.");
  }
  if (p.subject !== subject) throw new ApprovalError("This approval belongs to another session; nothing was written.");
  if (tool !== undefined && tool !== p.tool)
    throw new ApprovalError(`This approval is for ${p.tool}, not ${tool}; nothing was written.`);
  if (nonce === undefined && !p.allowChat)
    throw new ApprovalError("This change can only be approved in the approval card; nothing was written.");
  if (nonce !== undefined) {
    const given = Buffer.from(nonce, "base64url");
    if (given.length !== p.nonce.length || !timingSafeEqual(given, p.nonce))
      throw new ApprovalError("Approval refused: bad token; nothing was written.");
  }
  pending.delete(id);
  return p;
}

/** Forget every pending write (tests). */
export function clearPending() {
  pending.clear();
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
export const OVERVIEW_URI = "ui://cloud-alm/overview-v1.html";

/** The project overview card. */
export function overviewHtml(): string {
  return OVERVIEW_TEMPLATE.replace("/*__METRICS_CSS__*/", metricsCss).replace("/*__METRICS_JS__*/", metricsScript).replace("/*__APP_BUNDLE__*/", () => appBundle());
}

export function cardHtml(): string {
  return CARD_TEMPLATE.replace("/*__APP_BUNDLE__*/", () => appBundle()).replace("__META_KEY__", META_KEY);
}
