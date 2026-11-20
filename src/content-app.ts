/** A compact source view, not a second Cloud ALM workspace. */
import { appBundle } from "./approval.js";
import { metricsCss, metricsScript } from "./project-metrics.js";
import { sapLogo } from "./sap-logo.js";

export const CONTENT_URI = "ui://cloud-alm/content-v1.html";
export const CONTENT_TOOLS = new Set([
  "calm_projects",
  "calm_overview",
  "calm_list",
  "calm_get",
]);

export function contentHtml(synthetic = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root {
  color-scheme: light dark;
  --surface: var(--color-background-primary, light-dark(#fff, #19232d));
  --ink: var(--color-text-primary, light-dark(#243341, #edf3f8));
  --muted: var(--color-text-secondary, light-dark(#586975, #b2bfca));
  --blue: var(--color-text-info, light-dark(#0064d9, #82bcff));
  --line: var(--color-border-tertiary, light-dark(#edf0f2, #384652));
  --error: var(--color-text-danger, light-dark(#aa0808, #ffb6b6));
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--surface);
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
.badge {
  display: inline-block;
  border-radius: 4px;
  padding: 1px 7px;
  background: var(--color-background-secondary, light-dark(#f3f5f6, #303d48));
  color: var(--muted);
  border: 0;
  font-size: 11px;
  line-height: 18px;
}
.badge.good {
  color: var(--color-text-success, light-dark(#256f3a, #a3dfac));
  background: var(--color-background-success, light-dark(#f1f8f2, #203b29));
}
.badge.bad {
  color: var(--error);
  background: var(--color-background-danger, light-dark(#fff1f1, #512827));
}
.description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 12px 0 0;
  color: var(--ink);
  font-size: 13px;
}
.detail h3 {
  font-size: 13px;
  margin: 14px 0 4px;
}
.detail p {
  margin: 4px 0;
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
  color: var(--error);
}
.empty {
  padding: 24px 0;
  color: var(--muted);
}
[hidden] {
  display: none !important;
}
body.expanded main {
  padding: 24px;
}
@media (max-width: 420px) {
  main,
  body.expanded main {
    padding: 16px;
  }

}
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
.properties {display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:12px;padding:12px;background:var(--color-background-secondary,light-dark(#f4f7fa,#24313d));border-radius:7px}.properties dt {color:var(--muted);font-size:12px}.properties dd {margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}
.demo {margin-inline-start:6px;padding:2px 7px;border:1px solid var(--line);border-radius:4px;color:var(--ink)}
main {max-width:1100px;margin:auto}
.panel,.grid-wrap {border:1px solid var(--line);border-radius:9px;background:var(--surface)}
.panel {padding:16px;margin-bottom:10px}
.record-head {display:flex;align-items:center;justify-content:space-between;gap:12px}
.record-head h2 {font-size:20px;margin:2px 0}
main a {color:var(--blue);text-decoration:underline;text-underline-offset:3px}
small {display:block;color:var(--muted);font-size:12px}
.metrics {display:grid;grid-template-columns:repeat(3,1fr);margin:16px 0;background:var(--color-background-secondary,light-dark(#f4f7fa,#24313d));border-radius:7px}
.metrics div {padding:10px 12px;border-inline-end:1px solid var(--line)}
.metrics div:last-child {border:0}
.metrics strong,.metrics span {display:block}
.metrics strong {font-size:20px;font-variant-numeric:tabular-nums}
.metrics span {font-size:12px;color:var(--muted)}
.grid-wrap {overflow-x:auto;margin:8px 0 0}
table {width:100%;border-collapse:collapse;font-size:13px;text-align:start}
th,td {text-align:start;padding:9px 12px;vertical-align:top;overflow-wrap:anywhere}
th {color:var(--muted);font-size:12px;background:var(--color-background-secondary,light-dark(#f4f7fa,#24313d))}
td {border-top:1px solid var(--line)}
.references {display:grid;gap:4px}
@media(max-width:480px){.panel{padding:10px}td,th,.metrics div{padding:7px}.metrics strong{font-size:17px}}
${metricsCss}
body.dashboard{background:var(--color-background-secondary,light-dark(#f5f6f7,#171e25));--metric-edge:var(--line);--metric-track:var(--color-background-secondary,light-dark(#eff1f2,#31404e))}
.dashboard header,.dashboard .grid-wrap{background:var(--surface);padding:12px;border:1px solid var(--line);border-radius:10px}
.dashboard .grid-wrap{padding:0}
</style></head><body><main>
<header>${sapLogo}<div><div class="brand">SAP Cloud ALM${synthetic ? ' <span class="demo">Demo data</span>' : ""}</div><h1 id="title">Loading results…</h1><p id="project"></p></div></header>
<div id="content" aria-live="polite"></div>
<footer><span id="count">Loading…</span><button id="more" hidden>View all</button></footer><p id="status" role="status"></p>
</main><script type="module">${appBundle()}\n${metricsScript}
${contentScript}</script></body></html>`;
}

const contentScript = String.raw`
const app = new App({ name: "cloud-alm-content", version: "2" });
const $ = (id) => document.getElementById(id);
let input = {},
  current = null,
  expanded = false,
  busy = false,
  canExpand = false,
  displayMode = "inline";
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
function recordLink(label, value) {
  const url = safeLink(value);
  if (!url) return node("span", label);
  const a = node("a", label + " ↗");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.onclick = event => {
    event.preventDefault();
    app.openLink({ url }).catch(() => status("Could not open Cloud ALM.", true));
  };
  return a;
}
function sourceAction(item) {
  const url = safeLink(item.url);
  if (!url) return null;
  const hash = new URL(url).hash;
  let label = "Open record";
  if (!hash) label = "Open launchpad";
  else if (hash.startsWith("#testPlan-display")) label = "Open Test Plans";
  else if (hash.startsWith("#ProcessScopingList")) label = "Open process list";
  else if (hash.startsWith("#test-display") && !hash.includes("&/manual/")) label = "Open test case list";
  return recordLink(label, url);
}
function table(headers, rows, title) {
  const wrap = node("div", null, "grid-wrap");
  const grid = node("table"), head = grid.createTHead().insertRow();
  grid.setAttribute("aria-label", title);
  for (const heading of headers) {
    const th = node("th", heading);
    th.scope = "col";
    head.append(th);
  }
  const tbody = grid.createTBody();
  for (const cells of rows) {
    const tr = tbody.insertRow();
    for (const cell of cells) tr.insertCell().append(cell || "—");
  }
  wrap.append(grid);
  return wrap;
}
function appendDetails(body, item) {
  if (item.description) body.append(node("p", item.description, "description"));
  if (item.steps?.length) body.append(table(["Step", "Action", "Expected result"],
    item.steps.map(step => [step.step, step.do, step.expect]), "Test steps"));
  const fields = [
    ["Priority", item.priority], ["Classification", item.fields?.classification],
    ["Approval", item.fields?.approval], ["Assignee", item.fields?.assignee],
    ["Phase", item.fields?.phase], ["Scope", item.fields?.scope],
    ["Due", item.fields?.dueDate], ["Start", item.fields?.startDate],
    ["End", item.fields?.endDate], ["Tags", item.fields?.tags?.join(", ")],
    ["Transports", item.fields?.transports?.join(", ")],
  ].filter(([, value]) => value != null && value !== "");
  if (fields.length) {
    const facts = node("dl", null, "properties");
    for (const [label, value] of fields) {
      const pair = node("div");
      pair.append(node("dt", label), node("dd", value));
      facts.append(pair);
    }
    body.append(facts);
  }
  if (item.results?.length) {
    body.append(node("h3", "Execution results"), table(["Plan", "Result", "Steps passed", "Date"],
      item.results.map(r => [r.plan, badge(r.status), r.passed + " / " + r.actions, r.date]), "Execution results"));
  }
  const relations = { children:"Child task", requirement:"Requirement", raisedFrom:"Raised from", testCases:"Test case", features:"Feature", documents:"Document", processes:"Process", defects:"Defect", covers:"Covers", delivers:"Delivers", tasks:"Task" };
  const related = Object.entries(item.links || {}).flatMap(([kind, links]) =>
    links.map(link => {
      const title = node("div");
      title.append(recordLink(link.title || link.id || "Unnamed record", link.url), node("small", link.id));
      return [relations[kind] || kind, title, link.status || link.result || "—"];
    }));
  if (related.length) body.append(node("h3", "Related records"), table(["Relationship", "Record", "Status / result"], related, "Related records"));
  if (item.comments?.length) body.append(node("h3", "Comments"), table(["Author", "Date", "Comment"],
    item.comments.map(c => [c.author, c.date, c.text]), "Comments"));
  const progress = item.fields?.progress;
  if (progress) {
    const facts = node("div", null, "metrics");
    for (const [value, label] of [[progress.executed + " / " + progress.total, "Executed"], [String(progress.passed), "Passed"], [progress.executed ? progress.passRate + "%" : "—", "Pass rate of executed"]]) {
      const metric = node("div");
      metric.append(node("strong", value), node("span", label));
      facts.append(metric);
    }
    body.append(facts);
  }
  const population = item.fields?.population;
  if (population?.assignmentOnly > 0) body.append(node("p", population.assignmentOnly + " assigned cases have no analytics result and count as not run."));
  if (!item.testCases?.length) return;
  body.append(node("h3", population?.assigned > item.testCases.length ? "Test cases (" + item.testCases.length + " of " + population.assigned + ")" : "Test cases (" + item.testCases.length + ")"));
  body.append(table(["Test case", "Result", "Defects"], item.testCases.map(tc => {
    const name = node("div");
    name.append(recordLink(tc.title || tc.id, tc.url), node("small", tc.id));
    const result = node("div"), [word, ...detail] = (tc.result || "Unknown").split(", ");
    result.append(badge(word));
    if (tc.resultSource === "assignment") result.append(node("small", "No analytics result"));
    if (detail.length) result.append(node("small", detail.join(", ")));
    const defects = node("div", null, "references");
    for (const id of tc.defects || []) defects.append(recordLink(id, tc.defectUrls?.[id]));
    return [name, result, defects.childNodes.length ? defects : tc.defects === null ? "Unknown" : "—"];
  }), "Test case results"));
}
function itemList(items, details) {
  if (!details) {
    const hasSource = items.some(item => safeLink(item.url));
    const headers = ["Item", "Status"];
    const priority = items.some(item => item.priority);
    if (priority) headers.push("Priority");
    if (hasSource) headers.push("Cloud ALM");
    return table(headers, items.map(item => {
      const name = node("div");
      name.append(node("strong", item.title || item.name || item.id), node("small", item.id));
      const cells = [name, item.result || item.status ? badge(item.result || item.status) : "—"];
      if (priority) cells.push(item.priority || "—");
      if (hasSource) cells.push(sourceAction(item));
      return cells;
    }), "Cloud ALM records");
  }
  const group = node("div");
  for (const item of items) {
    const section = node("section", null, "detail panel");
    const top = node("div", null, "record-head"), heading = node("div");
    heading.append(node("small", (labels[itemKind(item)] || item.kind || "Item") + " · " + (item.id || "")), node("h2", item.title || item.name || item.id));
    top.append(heading);
    const action = sourceAction(item);
    if (action) top.append(action);
    section.append(top);
    if (item.status) section.append(badge(item.status));
    appendDetails(section, item);
    group.append(section);
  }
  return group;
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
  document.body.classList.toggle("dashboard", !list && !!data.project);
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
    if (visible.length) root.append(itemList(visible, isDetails));
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
    root.append(projectMetrics(data));
    const counts = Object.entries(data.tasks || {}).map(([type, value]) => [plurals[type.replaceAll(" ", "_")] || type, String(value.total)]);
    if (data.features) counts.push(["Features", String(data.features.total)]);
    if (data.testCases) counts.push(["Manual test cases", String(data.testCases.manual)], ["Automated test cases", String(data.testCases.automated)]);
    if (counts.length) root.append(table(["Project scope", "Count"], counts, "Project scope"));
    const results = Object.entries(data.testResults || {}).filter(([, count]) => count > 0);
    if (results.length) root.append(node("h3", "Test results"), table(["Result", "Count"], results.map(([status, count]) => [badge(status === "notInPlan" ? "Outside test plans" : status), String(count)]), "Test results"));
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
    const collection = name === "calm_projects" ? "projects" : "items";
    if (
      append &&
      !result.isError &&
      Array.isArray(result.structuredContent?.[collection]) &&
      Array.isArray(current?.result.structuredContent?.[collection])
    ) {
      result.structuredContent = {
        ...result.structuredContent,
        offset: current.result.structuredContent.offset,
        [collection]: [
          ...current.result.structuredContent[collection],
          ...result.structuredContent[collection],
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
function applyHostContext(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.availableDisplayModes)
    canExpand = context.availableDisplayModes.includes("fullscreen");
  if (context?.displayMode) displayMode = context.displayMode;
  const showAll = !canExpand || displayMode === "fullscreen";
  if (expanded === showAll) return;
  expanded = showAll;
  document.body.classList.toggle("expanded", expanded);
  if (current) render(current.result, current.args);
}
app.onhostcontextchanged = applyHostContext;
$("more").onclick = async () => {
  if (!expanded) {
    if (canExpand) {
      try {
        const r = await app.requestDisplayMode({ mode: "fullscreen" });
        applyHostContext({ displayMode: r.mode });
      } catch {
        status("Use the expand button above to view all results.", true);
      }
    }
  } else if (current?.result.structuredContent?.nextOffset != null)
    call(
      current.result.structuredContent.projects ? "calm_projects" : "calm_list",
      {
        ...input,
        ...(current.result.structuredContent.project ? { projectId: current.result.structuredContent.project.id } : {}),
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
  .then(() => applyHostContext(app.getHostContext()))
  .catch(() =>
    status("Open this view in a host that supports MCP Apps.", true),
  );
`;
