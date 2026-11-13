/**
 * Human approval of writes. A write the agent asks for is first run as a
 * dry run; the preview goes to the user, and only their approval runs it.
 *
 * Channels, best first:
 * - card: an MCP Apps card in the chat (Claude, ChatGPT, Cursor, VS Code…)
 *   whose buttons call the app-only `calm_approve` tool with a nonce the
 *   model never sees (it travels in the result's `_meta` only);
 * - elicitation: the client's own confirm dialog (Claude Code, Codex, Cursor);
 * - chat: the agent asks the user and calls `calm_confirm` (mode `prefer`
 *   only: it trusts the agent to ask).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** off: write at once; prefer: best channel, chat as a last resort; required: card or dialog, else refuse. */
export type ApprovalMode = "off" | "prefer" | "required";
export const APPROVAL_MODES: ApprovalMode[] = ["off", "prefer", "required"];

export const CARD_URI = "ui://cloud-alm/approve-v1.html";
export const META_KEY = "cloud-alm/approval";
const TTL_MS = 10 * 60_000;
const MAX_PENDING = 200;

/** A write waiting for the user. Holds the tool name and its arguments, not a client. */
type Pending = {
  tool: string;
  /** card: approved with the nonce; chat: the agent relays the user's yes. */
  channel: "card" | "chat";
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
 * card path. Without, only `chat` approvals (mode prefer) may take it.
 */
export function take(
  id: string,
  subject: string,
  nonce: string | undefined,
  now = Date.now(),
): Pending {
  const p = pending.get(id);
  if (!p || p.expiresAt <= now) {
    pending.delete(id);
    throw new ApprovalError("This approval is unknown or expired; nothing was written. Ask again.");
  }
  if (p.subject !== subject) throw new ApprovalError("This approval belongs to another session; nothing was written.");
  if (nonce === undefined && p.channel !== "chat")
    throw new ApprovalError("This change waits for the user in the approval card; nothing was written.");
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
function appBundle(): string {
  if (appJs) return appJs;
  const path = createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps");
  const source = readFileSync(path, "utf8");
  const exports = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(source);
  const local = exports?.[1]
    ?.split(",")
    .map((s) => s.trim().split(/\s+as\s+/))
    .find(([, name]) => name === "App")?.[0];
  if (!exports || !local) throw new Error("ext-apps bundle has an unexpected shape");
  appJs = `${source.slice(0, exports.index)}\nconst App = ${local};\n`;
  return appJs;
}

/**
 * The approval card. Shows the server's preview (never HTML from the
 * model or the tenant: text only), and Approve / Reject.
 */
export function cardHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--fg:#1b1b1f;--muted:#5d5d66;--bg:#fff;--line:#d9d9de;--ok:#0a7d38;--no:#a1260d;--accent:#0b57d0}
@media (prefers-color-scheme:dark){:root{--fg:#ececf1;--muted:#a0a0aa;--bg:#1e1e22;--line:#3a3a42;--ok:#3fbf73;--no:#ef6b55;--accent:#8ab4f8}}
body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--fg);background:var(--bg)}
.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;max-width:720px}
.k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
h1{font-size:15px;margin:2px 0 10px}
pre{white-space:pre-wrap;word-break:break-word;margin:0 0 12px;padding:10px;border-radius:8px;background:color-mix(in srgb,var(--line) 35%,transparent);font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:340px;overflow:auto}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button{font:inherit;border-radius:8px;padding:7px 14px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button.ok{background:var(--ok);border-color:var(--ok);color:#fff}
button:disabled{opacity:.5;cursor:default}
#m{color:var(--muted);margin:10px 0 0}
#m.done{color:var(--ok)}#m.err{color:var(--no)}
</style></head><body>
<div class="card">
<div class="k">Cloud ALM · approval needed</div>
<h1 id="t">Waiting for the change…</h1>
<pre id="p" hidden></pre>
<div class="row"><button id="ok" class="ok" disabled>Approve</button><button id="no" disabled>Reject</button><span id="x" class="k"></span></div>
<p id="m"></p>
</div>
<script type="module">
${appBundle()}
const $ = (id) => document.getElementById(id);
const app = new App({ name: "cloud-alm-approval", version: "1" });
let pending;
app.ontoolresult = (result) => {
  const a = result?._meta?.[${JSON.stringify(META_KEY)}];
  if (!a) { $("t").textContent = "Nothing to approve."; return; }
  pending = a;
  $("t").textContent = a.title;
  $("p").textContent = a.preview;
  $("p").hidden = false;
  $("x").textContent = "expires " + new Date(a.expiresAt).toLocaleTimeString();
  $("ok").disabled = $("no").disabled = false;
};
async function decide(decision) {
  if (!pending) return;
  $("ok").disabled = $("no").disabled = true;
  $("m").className = ""; $("m").textContent = decision === "approve" ? "Writing…" : "Rejecting…";
  try {
    const r = await app.callServerTool({ name: "calm_approve", arguments: { id: pending.id, nonce: pending.nonce, decision } });
    const text = (r?.content ?? []).map((c) => c.text ?? "").join("\\n");
    $("m").className = r?.isError ? "err" : "done";
    $("m").textContent = text;
    await app.updateModelContext({ content: [{ type: "text", text: "Approval card (" + pending.tool + ", " + pending.id + "): user chose " + decision + ". " + text }] }).catch(() => {});
  } catch (e) {
    $("m").className = "err"; $("m").textContent = "Could not reach the server: " + (e?.message ?? e);
  }
}
$("ok").onclick = () => decide("approve");
$("no").onclick = () => decide("reject");
await app.connect();
</script></body></html>`;
}
