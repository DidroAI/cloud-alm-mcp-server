/**
 * The approval card's page: SAP Horizon-inspired, light and dark, text
 * only (every value goes through textContent). cardHtml() in approval.ts
 * inserts the ext-apps bundle and the _meta key at the markers.
 *
 * A plain template, not String.raw: Bun writes non-ASCII characters of a
 * template as \u escapes, which a raw template would show as typed.
 */
export const CARD_TEMPLATE: string = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cloud ALM approval</title>
<style>
/* SAP Horizon (Morning / Evening) values; surface, text and border follow the host's MCP Apps
   style variables when it sends them, so the card sits in the chat without a seam. */
:root{color-scheme:light dark;
--surface:var(--color-background-primary,#fff);--sunken:#f5f6f7;--text:var(--color-text-primary,#131e29);--label:#556b82;
--line:#e5e5e5;--edge:var(--color-border-primary,#d1d6db);--brand:#0070f2;--brand-hover:#0064d9;--link:#0064d9;--focus:#0032a5;
--btn:#fff;--btn-edge:#bcc3ca;--btn-hover:#eaecee;--on-brand:#fff;
--pos:#256f3a;--pos-bg:#f5fae5;--pos-edge:#30914c;
--neg:#aa0808;--neg-bg:#ffeaf4;--neg-edge:#e90b0b;--danger:#aa0808;--danger-hover:#8d0606;--on-danger:#fff;
--crit:#a84a00;--crit-bg:#fff8d6;--crit-edge:#dd6100;
--info:#0064d9;--info-bg:#e1f4ff;--info-edge:#0070f2;
--neutral-bg:#eff1f2;--neutral-edge:#788fa6;
--font:"72","72full",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:"72Mono","72Monofull",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
--surface:var(--color-background-primary,#1d232a);--sunken:#12171c;--text:var(--color-text-primary,#f5f6f7);--label:#a9b4be;
--line:#2e3742;--edge:var(--color-border-primary,#3a4a5a);--brand:#0070f2;--brand-hover:#1a85ff;--link:#4db1ff;--focus:#9ad3ff;
--btn:#1c242c;--btn-edge:#4a5c6e;--btn-hover:#28333e;--on-brand:#fff;
--pos:#97dd40;--pos-bg:#11331a;--pos-edge:#6dad1f;
--neg:#ff8f8f;--neg-bg:#350000;--neg-edge:#fa6161;--danger:#fa6161;--danger-hover:#ff8f8f;--on-danger:#12171c;
--crit:#ffdf72;--crit-bg:#382700;--crit-edge:#f7bf00;
--info:#4db1ff;--info-bg:#00144a;--info-edge:#4db1ff;
--neutral-bg:#242e38;--neutral-edge:#a9b4be}}
:root[data-theme=dark]{
--surface:var(--color-background-primary,#1d232a);--sunken:#12171c;--text:var(--color-text-primary,#f5f6f7);--label:#a9b4be;
--line:#2e3742;--edge:var(--color-border-primary,#3a4a5a);--brand:#0070f2;--brand-hover:#1a85ff;--link:#4db1ff;--focus:#9ad3ff;
--btn:#1c242c;--btn-edge:#4a5c6e;--btn-hover:#28333e;--on-brand:#fff;
--pos:#97dd40;--pos-bg:#11331a;--pos-edge:#6dad1f;
--neg:#ff8f8f;--neg-bg:#350000;--neg-edge:#fa6161;--danger:#fa6161;--danger-hover:#ff8f8f;--on-danger:#12171c;
--crit:#ffdf72;--crit-bg:#382700;--crit-edge:#f7bf00;
--info:#4db1ff;--info-bg:#00144a;--info-edge:#4db1ff;
--neutral-bg:#242e38;--neutral-edge:#a9b4be}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;background:transparent}
body{padding:2px;font:14px/1.4 var(--font);color:var(--text);-webkit-font-smoothing:antialiased}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.card{background:var(--surface);border:1px solid var(--edge);border-radius:4px;max-width:820px;overflow:hidden}

/* Object header: avatar, overline, title, status */
.hd{display:flex;gap:12px;align-items:flex-start;padding:14px 16px 12px}
.hm{flex:1;min-width:0}
.over{font-size:12px;color:var(--label);display:flex;flex-wrap:wrap;gap:2px 8px;align-items:center;justify-content:space-between}
h1{font-size:16px;line-height:1.3;font-weight:700;margin:2px 0 0;overflow-wrap:anywhere}
.st{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;line-height:1;padding:4px 8px;border-radius:3px;border:1px solid var(--neutral-edge);background:var(--neutral-bg);color:var(--text);white-space:nowrap}
.card[data-state=waiting] .st{background:var(--crit-bg);border-color:var(--crit-edge);color:var(--crit)}
.card[data-state=working] .st,.card[data-state=chat] .st{background:var(--info-bg);border-color:var(--info-edge);color:var(--info)}
.card[data-state=approved] .st{background:var(--pos-bg);border-color:var(--pos-edge);color:var(--pos)}
.card[data-state=failed] .st,.card[data-state=blocked] .st{background:var(--neg-bg);border-color:var(--neg-edge);color:var(--neg)}
.card[data-state=working] .st::before,.card[data-state=preparing] .st::before{content:"";background:none;border:2px solid currentColor;border-right-color:transparent;width:9px;height:9px;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.st::before{animation:none!important}}

/* Attributes: who and where */
.facts{display:flex;flex-wrap:wrap;gap:4px 20px;margin:0;padding:0 16px 12px;font-size:13px}
.facts div{display:flex;gap:6px;min-width:0}
.facts dt{color:var(--label)}
.facts dt::after{content:":"}
.facts dd{margin:0;overflow-wrap:anywhere}
.facts .mono{font-family:var(--mono);font-size:12.5px}
@media (max-width:440px){.facts{padding-left:16px}}

/* Message strips */
.strip{display:flex;gap:8px;margin:0 16px 12px;padding:8px 12px;border-radius:8px;border:1px solid var(--neutral-edge);background:var(--neutral-bg);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.strip::before{flex:none;font-weight:700;content:"i"}
.strip.err,.strip.danger{border-color:var(--neg-edge);background:var(--neg-bg)}
.strip.err::before,.strip.danger::before{content:"!";color:var(--neg)}
.strip.warn{border-color:var(--crit-edge);background:var(--crit-bg)}
.strip.warn::before{content:"!";color:var(--crit)}
.strip.done{border-color:var(--pos-edge);background:var(--pos-bg)}
.strip.done::before{content:"✓";color:var(--pos)}
.strip.busy{border-color:var(--info-edge);background:var(--info-bg)}
.strip.danger{font-weight:700}
#m{margin-top:12px}

/* What changes */
.chh{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 16px 8px;border-top:1px solid var(--line)}
h2{font-size:13px;font-weight:700;margin:0}
.chn{font-size:12px;color:var(--label);white-space:nowrap}
.c{border-top:1px solid var(--line);background:var(--surface);padding:0 16px}
.it{background:var(--surface);padding:12px 0}
.it+.it{margin-top:8px}
/* An item with nothing but a name (a delete, mostly): one line, so a long list stays readable without a scroll box. */
.it.slim{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;padding:8px 0}
.it.slim+.it{margin-top:0;border-top:1px solid var(--line)}
.it.slim .itt{margin:0;flex:1;min-width:40%}
.it.slim .kind{font-size:12px;color:var(--label)}
.it.slim .badge{font-size:12px}
.morew{padding:0 16px 8px}
button.more{min-height:32px;min-width:0;padding:0;border:0;border-radius:2px;background:transparent;font-size:13px}
button.more:hover:not(:disabled){background:transparent;text-decoration:underline}
.it[data-op=create]{border-left-color:var(--pos-edge)}
.it[data-op=delete]{border-left-color:var(--neg-edge)}
.ih{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12px;color:var(--label)}
.badge{margin-left:auto;font-weight:700;border-radius:4px;padding:1px 6px}
.it[data-op=create] .badge{color:var(--pos);background:var(--pos-bg)}
.it[data-op=delete] .badge{color:var(--neg);background:var(--neg-bg)}
.itt{font-weight:700;margin-top:4px;overflow-wrap:anywhere}
table.fl{margin-top:10px;width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}
.fl th,.fl td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid var(--line);overflow-wrap:anywhere;white-space:pre-wrap}
.fl thead th{font-size:12px;font-weight:500;background:var(--sunken);color:var(--label)}
.fl tbody th{width:26%;font-weight:500}.fl .before{color:var(--label)}.fl .after{font-weight:600}
.note{margin-top:8px;font-size:12px;color:var(--label)}
.notes{list-style:none;margin:0;padding:8px 16px;font-size:12px;color:var(--label);border-top:1px solid var(--line)}
.notes li+li{margin-top:2px}

/* Plain-text preview for hosts without a structured change. */
details{border-top:1px solid var(--line)}
summary{padding:8px 16px;font-size:12px;color:var(--link);cursor:pointer;width:fit-content;border-radius:6px}
details.solo>summary{display:none}
pre{margin:0;padding:10px 16px;background:var(--sunken);font:12.5px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}

/* Footer toolbar: expiry on the left, one emphasized action */
.ft{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--line)}
.x{font-size:12px;color:var(--label);display:flex;gap:6px;align-items:center;min-height:20px}
.x svg{width:14px;height:14px;flex:none}
.x:empty{display:none}
.acts{display:flex;gap:8px;margin-left:auto}
button{font:700 14px/1 var(--font);min-height:36px;min-width:88px;padding:0 16px;border-radius:8px;border:1px solid var(--btn-edge);background:var(--btn);color:var(--link);cursor:pointer}
button:hover:not(:disabled){background:var(--btn-hover)}
button.ok{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
button.ok:hover:not(:disabled){background:var(--brand-hover);border-color:var(--brand-hover)}
.card[data-kind=delete] button.ok{background:var(--danger);border-color:var(--danger);color:var(--on-danger)}
.card[data-kind=delete] button.ok:hover:not(:disabled){background:var(--danger-hover);border-color:var(--danger-hover)}
button:disabled{opacity:.45;cursor:default}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.card[data-state=unknown] .acts,.card[data-state=closed] .acts,.card[data-state=approved] .acts,.card[data-state=rejected] .acts,.card[data-state=expired] .acts,.card[data-state=blocked] .acts,.card[data-state=chat] .acts,.card[data-state=info] .acts,.card[data-state=preview] .acts,.card[data-state=failed] .acts,.card[data-state=preparing] .acts{display:none}
.card[data-state=info] .ft,.card[data-state=failed] .ft,.card[data-state=preparing] .ft{display:none}
.card[data-state=rejected] .c,.card[data-state=expired] .c{opacity:.75}
@media (max-width:380px){.acts{width:100%}.acts button{flex:1}}
@media (forced-colors:active){.st,.strip,.it,button{border:1px solid CanvasText}}
.hd{border-bottom:2px solid var(--brand)}.hd h1{color:var(--link)}
.facts{padding:10px 16px}.fl thead th{background:var(--neutral-bg)}
.card[data-state=waiting] .st{border:0;background:transparent;color:var(--label)}
.mark{width:32px;height:32px;flex:none}
</style></head><body>
<main class="card" id="card" data-state="preparing">
<header class="hd" style="align-items:center"><!--brand-mark-->
  <div class="hm">
    <div class="over"><span>Cloud ALM by Didro</span><span class="st" id="st" role="status">Preparing</span></div>
    <h1 id="t">Preparing the change…</h1>
  </div>
</header>
<dl class="facts" id="facts" hidden></dl>
<p class="strip danger" id="warn" role="alert" hidden></p>
<section id="ch" aria-labelledby="chh" hidden>
  <div class="chh"><h2 id="chh">What will change</h2><span class="chn" id="chn"></span></div>
  <div class="c" id="c" role="group" aria-labelledby="chh"></div>
  <div class="morew" id="morew" hidden><button id="more" class="more" type="button"></button></div>
</section>
<ul class="notes" id="notes" hidden></ul>
<details id="pd" class="solo" hidden><summary>Change</summary><pre id="p"></pre></details>
<p class="strip" id="m" role="status" aria-live="polite" hidden></p>
<footer class="ft">
  <span class="x"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.500V8l2.3 1.5"/></svg><span id="x">Nothing is written until you approve.</span></span>
  <div class="acts"><button id="ok" class="ok" disabled>Approve</button><button id="no" disabled>Reject</button></div>
</footer>
</main>
<script type="module">
/*__APP_BUNDLE__*/
const KEY = "__META_KEY__";
const NL = String.fromCharCode(10);
const $ = (id) => document.getElementById(id);
const card = $("card");
/** Text only: every value from the server or the tenant goes through textContent. */
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const str = (v) => (v === null || v === undefined ? "" : String(v));
const cap = (v) => { const t = str(v); return t.charAt(0).toUpperCase() + t.slice(1); };
const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
const STATUS = { preparing: "Preparing", waiting: "Approval needed", working: "Writing", approved: "Approved", rejected: "Rejected", expired: "Expired", blocked: "Cannot approve here", chat: "Approve in chat", info: "No approval pending", failed: "Not proposed", unknown: "Outcome unknown", closed: "Closed" };
const state = (name, label) => { card.dataset.state = name; $("st").textContent = label ?? STATUS[name]; };
const say = (text, cls = "") => {
  const m = $("m");
  m.className = "strip " + cls;
  m.setAttribute("role", cls === "err" ? "alert" : "status");
  m.textContent = text;
  m.hidden = !text;
};
/** A delete stays locked while part of its list is folded away: the user approves what they were shown. */
let folded = false;
let live = false;
const buttons = (on) => { live = on; $("no").disabled = !on; $("ok").disabled = !on || (folded && card.dataset.kind === "delete"); };
/** Items shown before the rest folds behind "Show all". */
const SHOWN = 8;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const app = new App({ name: "cloud-alm-approval", version: "3" });
let pending;
let done = false;
let ticking;

/** Light or dark, and the host's own surface colours, when the host says. */
function theme(ctx) {
  if (ctx?.theme === "light" || ctx?.theme === "dark") applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}
app.onhostcontextchanged = theme;

/**
 * The pending change, from wherever this host put it: the result's _meta
 * (with the nonce) or structuredContent (no nonce). Never an id read from
 * the text, which a dry run or tenant data could forge.
 */
function pendingFrom(result) {
  const meta = result?._meta?.[KEY];
  if (meta?.id) return meta;
  const sc = result?.structuredContent?.approval;
  if (sc?.id) return sc;
  return undefined;
}
const OPS = { create: "create", update: "update", delete: "delete" };
const filled = (v) => v !== undefined && v !== null && v !== "";

/** One field: "before → after" on a line, or two blocks when the values are long. */
function fieldTable(fields, op) {
  const compare = op === "update";
  const table = el("table", "fl");
  const heading = table.createTHead().insertRow();
  for (const label of compare ? ["Field", "Current", "Proposed"] : ["Field", "Value"]) {
    const th = el("th", "", label); th.scope = "col"; heading.append(th);
  }
  const body = table.createTBody();
  for (const f of fields) {
    const row = body.insertRow(), th = el("th", "", str(f.field));
    th.scope = "row"; row.append(th);
    if (compare) row.append(el("td", "before", filled(f.before) ? str(f.before) : "—"));
    const next = f.after ?? f.value;
    row.append(el("td", "after", filled(next) ? str(next) : "—"));
  }
  return table;
}

/** The structured change: one block per item. False when the server sent none (the text is shown instead). */
function renderChange(change) {
  const items = Array.isArray(change?.items) ? change.items : [];
  const box = $("c");
  box.replaceChildren();
  if (!items.length) return false;
  let fields = 0;
  for (let item of items) {
    const op = OPS[item.op] ?? OPS[change.kind] ?? "update";
    const block = el("article", "it");
    block.dataset.op = op;
    const head = el("div", "ih");
    if (filled(item.type)) head.append(el("span", "", cap(item.type)));
    if (op !== "update") head.append(el("span", "badge", op === "create" ? "New" : "Will be deleted"));
    const slim = !item.fields?.length && !filled(item.note) && filled(item.title);
    if (!filled(item.title) && filled(item.id)) item = { ...item, title: str(item.id) };
    if (slim) {
      // One line: title, type, badge.
      block.classList.add("slim");
      block.append(el("div", "itt", str(item.title)));
      if (filled(item.type)) block.append(el("span", "kind", cap(item.type)));
      if (op !== "update") block.append(el("span", "badge", op === "create" ? "New" : "Will be deleted"));
      block.hidden = box.childElementCount >= SHOWN && items.length > SHOWN + 1;
      box.append(block);
      continue;
    }
    block.hidden = box.childElementCount >= SHOWN && items.length > SHOWN + 1;
    block.append(head);
    if (filled(item.title)) block.append(el("div", "itt", str(item.title)));
    if (item.fields?.length) {
      fields += item.fields.length;
      block.append(fieldTable(item.fields, op));
    }
    if (filled(item.note)) block.append(el("div", "note", cap(item.note)));
    box.append(block);
  }
  const kind = OPS[change.kind] ?? "update";
  card.dataset.kind = kind;
  folded = items.length > SHOWN + 1;
  $("morew").hidden = !folded;
  $("more").textContent = "Show all " + items.length + " items" + (kind === "delete" ? " before deleting" : "");
  $("more").onclick = () => {
    for (const block of box.children) block.hidden = false;
    folded = false;
    $("morew").hidden = true;
    buttons(live);
  };
  $("chh").textContent = kind === "create" ? "What will be created" : kind === "delete" ? "What will be deleted" : "What will change";
  $("chn").textContent = plural(items.length, "item") + (fields && kind !== "delete" ? ", " + plural(fields, "field") : "");
  $("ch").hidden = false;
  if (kind === "delete" || change.irreversible) {
    $("warn").textContent = (kind === "delete" ? "This deletes " + plural(items.length, "item") + " in Cloud ALM for good. " : "") + "It cannot be undone.";
    $("warn").hidden = false;
    if (kind === "delete") $("ok").textContent = "Delete permanently";
  }
  const notes = [...(Array.isArray(change.warnings) ? change.warnings : []), ...(Array.isArray(change.notes) ? change.notes : [])];
  $("notes").replaceChildren(...notes.map((n) => el("li", "", cap(n))));
  $("notes").hidden = !notes.length;
  return true;
}

/** Where: the project. Nothing a consultant would not say aloud (no tool name, no request id). */
function renderFacts(a) {
  const rows = [
    ["Project", a.change?.project?.name],
  ].filter(([, v]) => filled(v));
  $("facts").replaceChildren(...rows.map(([k, v]) => {
    const row = el("div");
    row.append(el("dt", "", k), el("dd", "", str(v)));
    return row;
  }));
  $("facts").hidden = !rows.length;
}
/** The plain text, only when the host passed no structured change. */
function plainText(text, alone) {
  $("p").textContent = text || "";
  $("pd").hidden = !text || !alone;
  $("pd").open = alone;
}
/** Hosts that forward a card's tool calls declare serverTools (the Claude Code tab, for one, does not). */
const canCall = () => !app.getHostCapabilities || !!app.getHostCapabilities()?.serverTools;

function tick() {
  if (done || !pending?.expiresAt) return;
  const at = new Date(pending.expiresAt).getTime();
  if (expired()) return;
  const left = Math.max(1, Math.round((at - Date.now()) / 60000));
  $("x").textContent = "Expires " + clock(at) + " (in " + left + " min). Nothing is written until you approve.";
}
/** Past the expiry the server refuses the approval; say so instead of offering dead buttons. */
function expired() {
  if (done || !pending?.expiresAt || Date.now() < new Date(pending.expiresAt).getTime()) return false;
  finish("expired", "Expired " + clock(new Date(pending.expiresAt).getTime()));
  say("This approval expired; nothing was written. Ask again in the chat to get a new one.", "warn");
  return true;
}
function finish(name, footer) {
  done = true;
  clearInterval(ticking);
  buttons(false);
  state(name);
  $("x").textContent = footer;
}

app.ontoolinput = () => { if (!pending && !done) $("t").textContent = "Preparing the change…"; };
app.ontoolcancelled = () => { if (!pending) { $("t").textContent = "Cancelled; nothing was written."; state("info", "Cancelled"); } };
app.ontoolresult = (result) => {
  const a = pendingFrom(result);
  if (!a) {
    const text = (result?.content ?? []).map((c) => c?.text ?? "").join(NL).trim();
    const chat = /calm_confirm/.test(text);
    // A dry run: the same field-by-field view as a proposal, without buttons.
    const preview = !result?.isError && result?.structuredContent?.change;
    if (preview && renderChange(preview)) {
      $("t").textContent = "Preview";
      // A state of its own: the footer line stays, and a delete is not announced as happening.
      state("preview", "Nothing sent");
      $("warn").hidden = true;
      renderFacts({ change: preview });
      plainText("", false);
      $("x").textContent = "A preview only. Nothing was sent to Cloud ALM.";
      return;
    }
    $("t").textContent = result?.isError ? "Not proposed" : chat ? "Approve in the chat" : "Nothing waits for approval here.";
    state(result?.isError ? "failed" : "info", chat ? "Approve in chat" : undefined);
    plainText(text, true);
    return;
  }
  if (pending?.id === a.id && (done || card.dataset.state === "working")) return;
  clearInterval(ticking);
  done = false;
  pending = a;
  $("t").textContent = a.title || "Change waiting for approval";
  renderFacts(a);
  plainText(a.preview, !renderChange(a.change));
  state("waiting");
  if (!a.nonce && a.chat === false) {
    state("blocked");
    $("x").textContent = "Nothing was written.";
    say("This change cannot be approved in this app. Open the chat in an app that shows approval cards.", "err");
    return;
  }
  if (expired()) return;
  if (!canCall()) {
    state(pending.chat !== false ? "chat" : "blocked");
    say(pending.chat !== false
      ? "Approving from this card is not available in this app. To approve, reply “yes” in the chat."
      : "Approving from this card is not available in this app. Open the chat in an app that shows approval cards.", pending.chat !== false ? "" : "err");
    return;
  }
  tick();
  if (a.expiresAt) ticking = setInterval(tick, 20000);
  settled(a.id).then((over) => { if (!over && pending?.id === a.id && !done && card.dataset.state === "waiting") buttons(true); });
};

/**
 * A card drawn again (a reload, another device) asks how its proposal
 * ended, and shows that instead of live buttons. Resolves false when it is
 * still pending, or the server or host does not answer.
 */
async function settled(id) {
  let s;
  try {
    const r = await Promise.race([
      // With the nonce: the server then takes approval from this card only.
      app.callServerTool({ name: "calm_approval_status", arguments: { id, ...(pending?.id === id && pending.nonce ? { nonce: pending.nonce } : {}) } }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
    if (r && !r.isError) s = r.structuredContent;
  } catch {}
  if (pending?.id !== id || done) return true;
  if (s?.status === "approved") { finish("approved", "Approved earlier"); say("The change was written to Cloud ALM.", "done"); }
  else if (s?.status === "rejected") finish("rejected", "Rejected earlier. Nothing was written.");
  else if (s?.status === "failed") { finish("closed", "Closed"); say(forPeople(s.summary), "err"); }
  else if (s?.status === "working") { finish("working", "Started from another view"); say("This change is being written. Read the record in Cloud ALM for the result.", "busy"); }
  else return false;
  return true;
}

/** A refusal, without the instructions meant for the agent. */
function forPeople(text) {
  if (/no longer matches/.test(text)) return "The items changed since this preview, so nothing was written. Ask again in the chat to get a new one.";
  if (/already approved/.test(text)) return "This change was already approved.";
  if (/already rejected/.test(text)) return "This change was already rejected. Nothing was written.";
  if (/unknown or expired/.test(text)) return "This approval is no longer valid; nothing was written. Ask again in the chat to get a new one.";
  return (text || "Cloud ALM refused the change.").replace(/\s*Propose the change again\.?/g, "") + " Ask again in the chat if you still want this change.";
}

async function decide(decision) {
  if (!pending || done || expired()) return;
  buttons(false);
  clearInterval(ticking);
  state("working", decision === "approve" ? "Writing" : "Rejecting");
  say(decision === "approve" ? "Writing to Cloud ALM…" : "Rejecting…", "busy");
  let r;
  try {
    const args = { id: pending.id, decision };
    if (pending.nonce) args.nonce = pending.nonce;
    r = await app.callServerTool({ name: "calm_approve", arguments: args });
    if (!r || !Array.isArray(r.content)) throw new Error("Missing approval response");
  } catch {
    const message = decision === "approve"
      ? "Outcome unknown. Read the record in Cloud ALM before proposing this change again."
      : "The server did not confirm rejection. Check the approval status before taking further action.";
    finish("unknown", "Confirmation unavailable");
    say(decision === "approve"
      ? "We could not confirm that the change was written. Check the item in Cloud ALM before trying again."
      : "We could not confirm the rejection. Check the item in Cloud ALM.", "warn");
    await app.updateModelContext({ content: [{ type: "text", text: message }] }).catch(() => {});
    return;
  }
  const text = (r?.content ?? []).map((c) => c?.text ?? "").join(NL);
  // Held for a moment after the proposal (a card without its token): nothing is decided, the buttons come back.
  if (r.isError && /^Too early/.test(text)) {
    state("waiting");
    say("Not yet. Try again in a few seconds.", "warn");
    tick();
    if (pending.expiresAt) ticking = setInterval(tick, 20000);
    buttons(true);
    return;
  }
  if (r.isError) finish("closed", "Closed " + clock(Date.now()));
  else finish(decision === "approve" ? "approved" : "rejected", (decision === "approve" ? "Approved " : "Rejected ") + clock(Date.now()) + (decision === "approve" ? "" : ". Nothing was written."));
  // The answer is written for the agent (ids, tool names): people get a sentence, and the answer only when it failed.
  say(r.isError ? forPeople(text) : decision === "approve" ? "The change was written to Cloud ALM." : "", r.isError ? "err" : "done");
  const note = "Approval card for " + (pending.tool ?? "a change") + " (id " + pending.id + "): the user chose " + decision + ". Server answer: " + text;
  await app.updateModelContext({ content: [{ type: "text", text: note }] }).catch(() => {});
}
$("ok").onclick = () => decide("approve");
$("no").onclick = () => decide("reject");
await app.connect();
theme(app.getHostContext?.());
</script></body></html>
`;
