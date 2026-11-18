/** A compact source view, not a second Cloud ALM workspace. */
import { appBundle } from "./approval.js";
import { sapLogo } from "./sap-logo.js";

export const CONTENT_URI = "ui://cloud-alm/content-v1.html";
export const CONTENT_TOOLS = new Set([
  "calm_projects",
  "calm_overview",
  "calm_list",
  "calm_get",
]);

export function contentHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root {
  color-scheme: light;
  --ink: #243341;
  --muted: #697782;
  --blue: #0064d9;
  --line: #edf0f2;
  --soft: #f5f8fc;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: #fff;
  color: var(--ink);
  font:
    14px/1.5 "72",
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
}
main {
  padding: 20px 24px;
}
header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
.sap-logo {
  width: 48px;
  height: 24px;
  flex-shrink: 0;
}
.brand {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
h1 {
  font-size: 18px;
  line-height: 1.3;
  margin: 2px 0 0;
  font-weight: 600;
}
#project {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  gap: 12px;
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
  align-items: flex-start;
}
.item:first-child {
  padding-top: 4px;
}
.item:last-child {
  border-bottom: 0;
}
.name a {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  justify-content: space-between;
  color: inherit;
  text-decoration: none;
  border-radius: 3px;
}
.name a:hover {
  color: var(--blue);
}
.name a:hover .external {
  opacity: 1;
}
.name a:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 5px;
}
.external {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  margin-top: 3px;
  opacity: 0.55;
  transition: opacity 0.15s;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
}
.body {
  min-width: 0;
  flex: 1;
}
.name {
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
  margin: 0;
}
.meta {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
.badge {
  display: inline-block;
  border-radius: 4px;
  padding: 1px 7px;
  background: #f3f5f6;
  color: #56636e;
  border: 0;
  font-size: 11px;
  line-height: 18px;
}
.badge.good {
  color: #256f3a;
  background: #f1f8f2;
  border-color: #c6dfc9;
}
.badge.bad {
  color: #aa0808;
  background: #fff1f1;
  border-color: #f3caca;
}
.description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 12px 0 0;
  color: #354a5f;
  font-size: 13px;
}
.detail h3 {
  font-size: 13px;
  margin: 14px 0 4px;
}
.detail p {
  margin: 4px 0;
}
.plan-cases {
  margin-top: 10px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.plan-cases summary {
  cursor: pointer;
  color: var(--blue);
  font-weight: 600;
}
.plan-cases ul {
  padding-inline-start: 20px;
}
.plan-cases li {
  margin: 6px 0;
}
.facts {
  display: flex;
  gap: 8px 24px;
  flex-wrap: wrap;
  padding: 12px 0;
}
.fact {
  min-width: 100px;
}
.fact strong {
  font-size: 22px;
  display: block;
}
.fact span {
  font-size: 12px;
  color: var(--muted);
}
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
}
button {
  font: inherit;
  background: transparent;
  border: 0;
  color: var(--blue);
  padding: 5px 0;
  cursor: pointer;
  font-weight: 600;
}
button:hover {
  text-decoration: underline;
}
button:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 4px;
  border-radius: 2px;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
#status {
  font-size: 12px;
  color: var(--muted);
  margin: 8px 0 0;
}
#status:empty {
  display: none;
}
#status.error {
  color: #aa0808;
}
.empty {
  padding: 24px 0;
  color: var(--muted);
}
[hidden] {
  display: none !important;
}
.item {
  transition: background 0.15s;
}
body.expanded main {
  padding: 24px;
}
body.expanded .item {
  padding: 20px 0;
}
@media (max-width: 420px) {
  main,
  body.expanded main {
    padding: 16px;
  }
  .item {
    gap: 10px;
  }
  .name {
    font-size: 13px;
  }
}
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
</style></head><body><main>
<header>${sapLogo}<div><div class="brand">SAP Cloud ALM</div><h1 id="title">Loading results…</h1><p id="project"></p></div></header>
<div id="content" aria-live="polite"></div>
<footer><span id="count">From your connected Cloud ALM</span><button id="more" hidden>View all</button></footer><p id="status" role="status"></p>
</main><script type="module">${appBundle()}\n${contentScript}</script></body></html>`;
}

const contentScript = String.raw`
const app = new App({ name: "cloud-alm-content", version: "2" });
const $ = (id) => document.getElementById(id);
let input = {},
  current = null,
  expanded = false,
  busy = false,
  canExpand = false;
const labels = {
  project: "Project",
  requirement: "Requirement",
  user_story: "User story",
  test_case: "Test case",
  defect: "Defect",
  feature: "Feature",
  document: "Document",
  task: "Task",
  test_plan: "Test plan",
};
const plurals = {
  requirement: "Requirements",
  user_story: "User stories",
  test_case: "Test cases",
  defect: "Defects",
  feature: "Features",
  document: "Documents",
  task: "Tasks",
  test_plan: "Test plans",
};
const node = (tag, value, cls) => {
  const n = document.createElement(tag);
  if (value != null) n.textContent = String(value);
  if (cls) n.className = cls;
  return n;
};
function itemKind(item) {
  return (
    item.type ||
    item.kind ||
    (current?.result.structuredContent?.projects ? "project" : "")
  )
    .replace(/^(manual|automated) test case$/, "test case")
    .replaceAll(" ", "_");
}
function status(message, error = false) {
  $("status").textContent = message;
  $("status").className = error ? "error" : "";
}
function badge(value) {
  const s = String(value),
    lower = s.toLowerCase();
  const label =
    lower === "open (in refinement)"
      ? "In refinement"
      : s.charAt(0).toUpperCase() + s.slice(1);
  return node(
    "span",
    label,
    "badge" +
      (/^(passed|done|completed|approved)$/.test(lower)
        ? " good"
        : /^(failed|blocked)$/.test(lower)
          ? " bad"
          : ""),
  );
}
function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      /^[a-z0-9-]+\.[a-z0-9-]+\.alm\.cloud\.sap$/.test(url.hostname) &&
      url.pathname === "/launchpad" &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function appendDetails(body, item) {
  if (item.description)
    body.append(node("div", item.description, "description"));
  for (const step of item.steps || []) {
    body.append(node("h3", "Step " + step.step), node("p", step.do));
    if (step.expect) body.append(node("p", "Expected: " + step.expect));
  }
  if (itemKind(item) !== "test_plan") return;
  const progress = item.fields?.progress;
  if (progress) {
    body.append(node("h3", "Execution progress"));
    if (progress.total === 0) {
      body.append(node("p", "No test cases assigned."));
    } else {
      body.append(node("p", progress.executed + " of " + progress.total +
        " executed · " + progress.passed + " passed"));
      if (progress.executed > 0)
        body.append(node("p", "Pass rate among executed cases: " + progress.passRate + "%"));
    }
  }
  if (!item.testCases?.length) return;
  const cases = node("details", null, "plan-cases");
  cases.append(node("summary", "Test cases (" + item.testCases.length + ")"));
  const list = node("ul");
  for (const testCase of item.testCases) {
    const entry = node("li", [testCase.id, testCase.title].filter(Boolean).join(" · "));
    if (testCase.result) entry.append(node("p", testCase.result));
    if (testCase.defects?.length)
      entry.append(node("p", "Defects: " + testCase.defects.join(", ")));
    list.append(entry);
  }
  cases.append(list);
  body.append(cases);
}
function row(item, showType, isDetails) {
  const li = node("li", null, "item"),
    body = node("div", null, isDetails ? "body detail" : "body"),
    title = node(isDetails ? "h2" : "p", null, "name"),
    label = item.title || item.name || item.id;
  const url = safeLink(item.url);
  if (url) {
    const link = node("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = "Open " + (item.id || label) + " in SAP Cloud ALM";
    link.setAttribute("aria-label", label + " — open in SAP Cloud ALM");
    link.append(node("span", label));
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("class", "external");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<path d="M14 4h6v6M20 4l-9 9M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5"/>';
    link.append(icon);
    link.onclick = (e) => {
      e.preventDefault();
      app
        .openLink({ url })
        .catch(() =>
          status("Could not open Cloud ALM. Try the link again.", true),
        );
    };
    title.append(link);
  } else title.textContent = label;
  body.append(title);
  const meta = node("div", null, "meta");
  const kind = itemKind(item);
  if (item.id)
    meta.append(
      node(
        "span",
        (labels[kind] ||
          (kind
            ? kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll("_", " ")
            : "Item")) +
          " ID: " +
          item.id,
      ),
    );
  if (kind && showType && !item.id)
    meta.append(
      node("span", labels[kind] || String(kind).replaceAll("_", " ")),
    );
  if (item.status) meta.append(badge(item.status));
  if (item.result) meta.append(badge(item.result));
  body.append(meta);
  if (isDetails) appendDetails(body, item);
  li.append(body);
  return li;
}
function render(result, args = {}) {
  if (result.isError) {
    status(
      (result.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n") ||
        "Couldn't load Cloud ALM results. Try again in the chat.",
      true,
    );
    $("title").textContent = "Cloud ALM results";
    return;
  }
  current = { result, args };
  input = args;
  const data = result.structuredContent || {},
    root = $("content");
  root.replaceChildren();
  status("");
  const items = data.items || data.projects;
  const list = Array.isArray(items);
  const isDetails = Array.isArray(data.items) && typeof data.total !== "number";
  const kinds = [...new Set((items || []).map(itemKind).filter(Boolean))];
  $("title").textContent = Array.isArray(data.projects)
    ? "Projects"
    : isDetails
      ? "Item details"
      : kinds.length === 1
        ? plurals[kinds[0]] || "Items"
        : args.types?.length === 1
          ? plurals[args.types[0]] || "Items"
          : list
            ? "Cloud ALM items"
            : "Project summary";
  $("project").textContent = data.project?.name || "";
  if (list) {
    const visible = expanded ? items : items.slice(0, 5);
    const ul = node("ul", null, "items");
    for (const item of visible) ul.append(row(item, kinds.length !== 1, isDetails));
    root.append(ul);
    if (!items.length)
      root.append(node("p", "No items match this request.", "empty"));
    const total = typeof data.total === "number" ? data.total : items.length;
    const offset = data.offset || 0;
    $("count").textContent = total
      ? offset || visible.length < total
        ? offset + 1 + "–" + (offset + visible.length) + " of " + total
        : total + " " + (total === 1 ? "item" : "items")
      : "0 items";
    $("more").hidden = expanded
      ? data.nextOffset == null
      : !(items.length > 5 || data.nextOffset != null);
    $("more").textContent = expanded ? "Load more" : "View all";
  } else if (data.project) {
    const facts = node("div", null, "facts");
    for (const [type, value] of Object.entries(data.tasks || {})) {
      const f = node("div", null, "fact");
      f.append(
        node("strong", value.total),
        node("span", plurals[type] || type),
      );
      facts.append(f);
    }
    if (data.testCases) {
      const f = node("div", null, "fact");
      f.append(
        node("strong", data.testCases.manual || 0),
        node("span", "Manual test cases"),
      );
      facts.append(f);
    }
    root.append(facts);
    $("count").textContent =
      [data.project.phase, data.project.status].filter(Boolean).join(" · ") ||
      "Project summary";
    $("more").hidden = true;
  } else {
    for (const c of result.content || [])
      if (c.type === "text") root.append(node("p", c.text, "description"));
    $("more").hidden = true;
  }
  for (const e of data.errors || [])
    root.append(node("p", e.id + ": " + e.error, "description"));
  for (const note of data.notes || [])
    root.append(node("p", note, "description"));
  app
    .updateModelContext({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            project: data.project,
            items: (items || [])
              .slice(0, 50)
              .map((i) => ({ id: i.id, title: i.title || i.name })),
            filters: args,
          }),
        },
      ],
    })
    .catch(() => {});
}
async function call(name, args, append = false) {
  if (busy) return;
  busy = true;
  $("more").disabled = true;
  status("Loading…");
  try {
    const result = await app.callServerTool({ name, arguments: args });
    if (
      append &&
      !result.isError &&
      Array.isArray(result.structuredContent?.items) &&
      Array.isArray(current?.result.structuredContent?.items)
    ) {
      result.structuredContent = {
        ...result.structuredContent,
        offset: current.result.structuredContent.offset,
        items: [
          ...current.result.structuredContent.items,
          ...result.structuredContent.items,
        ],
      };
    }
    render(result, args);
  } catch {
    $("title").textContent = current
      ? $("title").textContent
      : "Cloud ALM results";
    status("Couldn't load results. Try again in the chat.", true);
  } finally {
    busy = false;
    $("more").disabled = false;
  }
}
function mode(context) {
  if (context?.availableDisplayModes)
    canExpand = context.availableDisplayModes.includes("fullscreen");
  expanded = !canExpand || context?.displayMode === "fullscreen";
  document.body.classList.toggle("expanded", expanded);
  if (current) render(current.result, current.args);
}
app.onhostcontextchanged = mode;
$("more").onclick = async () => {
  if (!expanded) {
    if (canExpand) {
      try {
        const r = await app.requestDisplayMode({ mode: "fullscreen" });
        mode({ displayMode: r.mode });
      } catch {
        status("Use the expand button above to view all results.", true);
      }
    }
  } else if (current?.result.structuredContent?.nextOffset != null)
    call(
      "calm_list",
      {
        ...input,
        projectId:
          current.result.structuredContent.project?.id || input.projectId,
        offset: current.result.structuredContent.nextOffset,
      },
      true,
    );
};
app.ontoolinput = (e) => {
  input = e.arguments || {};
};
app.ontoolresult = (result) => {
  const display = result.structuredContent?.display;
  if (
    display &&
    ["calm_projects", "calm_overview", "calm_list", "calm_get"].includes(
      display.tool,
    )
  )
    call(display.tool, display.arguments || {});
  else render(result, input);
};
app.ontoolcancelled = () => status("This request was cancelled.");
app
  .connect()
  .then(() => {
    const context = app.getHostContext();
    canExpand = context?.availableDisplayModes?.includes("fullscreen") === true;
    mode(context);
  })
  .catch(() =>
    status("Open this view in a host that supports MCP Apps.", true),
  );
`;
