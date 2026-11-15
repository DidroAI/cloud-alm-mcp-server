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

/** off: write at once; prefer: approve in the card or the chat; required: in the card (or an opted-in dialog) only. */
export type ApprovalMode = "off" | "prefer" | "required";
export const APPROVAL_MODES: ApprovalMode[] = ["off", "prefer", "required"];

export const CARD_URI = "ui://cloud-alm/approve-v1.html";
export const META_KEY = "cloud-alm/approval";
/** Long enough for a user who answers a turn later; still single-use and bound to one change. */
export const TTL_MS = 60 * 60_000;
const MAX_PENDING = 200;

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
): Pending {
  const p = pending.get(id);
  if (!p || p.expiresAt <= now) {
    pending.delete(id);
    throw new ApprovalError("This approval is unknown or expired; nothing was written. Propose the change again and ask the user.");
  }
  if (p.subject !== subject) throw new ApprovalError("This approval belongs to another session; nothing was written.");
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
<h1 id="t">Preparing the change…</h1>
<pre id="p" hidden></pre>
<div class="row"><button id="ok" class="ok" disabled>Approve</button><button id="no" disabled>Reject</button><span id="x" class="k"></span></div>
<p id="m"></p>
</div>
<script type="module">
${appBundle()}
const KEY = ${JSON.stringify(META_KEY)};
const $ = (id) => document.getElementById(id);
const say = (text, cls = "") => { $("m").className = cls; $("m").textContent = text; };
const buttons = (on) => { $("ok").disabled = $("no").disabled = !on; };
const app = new App({ name: "cloud-alm-approval", version: "2" });
let pending;
let done = false;
/**
 * The pending change, from wherever this host put it: the result's _meta
 * (with the nonce), structuredContent, or the text (some hosts drop the
 * others, e.g. on reload); the last two carry no nonce.
 */
function pendingFrom(result) {
  const meta = result?._meta?.[KEY];
  if (meta?.id) return meta;
  const sc = result?.structuredContent?.approval;
  if (sc?.id) return sc;
  const text = (result?.content ?? []).map((c) => c?.text ?? "").join("\\n");
  try {
    const parsed = JSON.parse(text)?.approval;
    if (parsed?.id) return parsed;
  } catch {}
  const id = /id "([0-9a-f]{12})"/.exec(text)?.[1];
  if (!id) return undefined;
  const body = text.slice(text.indexOf("\\n\\n") + 2);
  const head = /^([^\\n]{1,80}):\\n/.exec(body);
  return {
    id,
    title: head ? head[1] : "Change waiting for approval",
    preview: head ? body.slice(head[0].length) : body,
    chat: /calm_confirm/.test(text),
  };
}
const chatHint = () => pending?.chat !== false ? " To approve, reply \u201cyes\u201d in the chat." : "";
app.ontoolinput = () => { if (!pending && !done) $("t").textContent = "Preparing the change…"; };
app.ontoolcancelled = () => { if (!pending) { $("t").textContent = "Cancelled; nothing was written."; buttons(false); } };
app.ontoolresult = (result) => {
  const a = pendingFrom(result);
  if (!a) {
    const text = (result?.content ?? []).map((c) => c?.text ?? "").join("\\n").trim();
    $("t").textContent = result?.isError ? "Not proposed" : "Nothing waits for approval here.";
    if (text) { $("p").textContent = text; $("p").hidden = false; }
    buttons(false);
    return;
  }
  pending = a;
  $("t").textContent = a.title || "Change waiting for approval";
  $("p").textContent = a.preview || "";
  $("p").hidden = !a.preview;
  if (a.expiresAt) $("x").textContent = "expires " + new Date(a.expiresAt).toLocaleTimeString();
  if (!a.nonce && a.chat === false) {
    say("This app did not pass the approval to the card. Open the change in an app that shows approval cards.", "err");
    return;
  }
  if (expired()) return;
  if (!canCall()) {
    say(pending.chat !== false
      ? "This app does not pass answers from cards to the server. To approve, reply \u201cyes\u201d in the chat."
      : "This app does not pass answers from cards to the server. Open the change in an app that does.", "err");
    return;
  }
  buttons(true);
  if (a.expiresAt) setTimeout(expired, Math.min(a.expiresAt - Date.now() + 500, 2 ** 31 - 1));
};
/** Hosts that forward a card's tool calls declare serverTools (the Claude Code tab, for one, does not). */
const canCall = () => !app.getHostCapabilities || !!app.getHostCapabilities()?.serverTools;
/** Past the expiry the server refuses the approval; say so instead of offering dead buttons. */
function expired() {
  if (done || !pending?.expiresAt || Date.now() < pending.expiresAt) return false;
  done = true;
  buttons(false);
  $("x").textContent = "expired " + new Date(pending.expiresAt).toLocaleTimeString();
  say("This approval expired; nothing was written. Ask again in the chat to get a new one.", "err");
  return true;
}
async function decide(decision) {
  if (!pending || done || expired()) return;
  buttons(false);
  say(decision === "approve" ? "Writing…" : "Rejecting…");
  let r;
  try {
    const args = { id: pending.id, decision };
    if (pending.nonce) args.nonce = pending.nonce;
    r = await app.callServerTool({ name: "calm_approve", arguments: args });
  } catch (e) {
    say("This app could not send your answer to the server (" + (e?.message ?? e) + ")." + chatHint(), "err");
    return;
  }
  const text = (r?.content ?? []).map((c) => c?.text ?? "").join("\\n");
  done = !r?.isError || /unknown or expired|already/.test(text);
  if (!done) buttons(true);
  say(text || (r?.isError ? "Refused." : "Done."), r?.isError ? "err" : "done");
  const note = "Approval card for " + (pending.tool ?? "a change") + " (id " + pending.id + "): the user chose " + decision + ". Server answer: " + text;
  await app.updateModelContext({ content: [{ type: "text", text: note }] }).catch(() => {});
}
$("ok").onclick = () => decide("approve");
$("no").onclick = () => decide("reject");
await app.connect();
</script></body></html>`;
}
