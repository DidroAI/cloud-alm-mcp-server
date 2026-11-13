/**
 * Short plain text for agent tools. Each formatter names what it shows, ids
 * an agent can pass to the next call, and how to get the next page.
 */
import type {
  AnalyticsProvider,
  AnalyticsResult,
  DocumentDetail,
  DocumentSummary,
  Feature,
  FeatureDetail,
  HierarchyNode,
  LandscapeObject,
  LibraryItem,
  LinkedTestCase,
  Page,
  Project,
  ProjectDetail,
  Scope,
  SolutionProcess,
  StatusEvent,
  Task,
  TaskSummary,
  TestCase,
  TestCaseDetail,
  TestCoverage,
  TestPlan,
  TestPlanDetail,
} from "./model.js";

const join = (parts: (string | null | undefined | false)[], sep = " · ") =>
  parts.filter(Boolean).join(sep);

function pageFooter(page: Page<unknown>, noun: string): string {
  const shown = page.items.length;
  const range = shown ? `${page.offset + 1}–${page.offset + shown}` : "none";
  const total = page.total !== null ? ` of ${page.total}` : "";
  const more =
    page.nextOffset !== null
      ? ` More: call again with offset ${page.nextOffset}.`
      : "";
  return `${noun}: ${range}${total}.${more}`;
}

function list<T>(
  page: Page<T>,
  noun: string,
  line: (item: T) => string,
): string {
  if (!page.items.length)
    return page.offset ? `No more ${noun}.` : `No ${noun} found.`;
  return `${page.items.map((item) => `- ${line(item)}`).join("\n")}\n${pageFooter(page, noun)}`;
}

export function formatProjects(projects: Project[]): string {
  if (!projects.length) return "No projects found.";
  return projects
    .map(
      (p) =>
        `- ${p.name ?? "(no name)"} [${p.id}] ${join([p.purpose, p.status && `status ${p.status}`, p.operationalStatus])}`,
    )
    .join("\n");
}

export function formatProject(p: ProjectDetail): string {
  const lines = [
    `${p.name ?? "(no name)"} [${p.id}]`,
    join([p.purpose, p.status && `status ${p.status}`, p.operationalStatus]),
  ];
  if (p.timeboxes.length)
    lines.push(
      `Timeboxes: ${p.timeboxes
        .map((t) =>
          join(
            [
              t.name,
              t.startDate && t.endDate && `${t.startDate}–${t.endDate}`,
              t.closed && "closed",
            ],
            " ",
          ),
        )
        .join("; ")}`,
    );
  if (p.teams.length)
    lines.push(`Teams: ${p.teams.map((t) => t.name).join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

const taskLine = (t: TaskSummary) =>
  `${t.displayId ?? "?"} ${t.title ?? "(no title)"} [${t.id}] ${join([
    t.typeName ?? t.type,
    t.status,
    t.priority !== null && `priority ${t.priority}`,
    t.assigneeName && `assignee ${t.assigneeName}`,
    t.dueDate && `due ${t.dueDate}`,
    t.tags.length > 0 && `tags ${t.tags.join(", ")}`,
  ])}`;

const linkedTestCase = (t: LinkedTestCase) =>
  `${t.displayId ?? "?"} ${t.title ?? "(no title)"} [${t.id}]${t.kind === "automated" ? " automated" : ""}`;

export function formatTasks(page: Page<TaskSummary>): string {
  return list(page, "tasks", taskLine);
}

export function formatTask(t: Task): string {
  const lines = [
    `${t.displayId ?? "?"} ${t.title ?? "(no title)"} [${t.id}]`,
    join([
      t.typeName ?? t.type,
      t.status && `status ${t.status}${t.subStatus ? ` / ${t.subStatus}` : ""}`,
      t.priority !== null && `priority ${t.priority}`,
      t.scopeName && `scope ${t.scopeName}`,
      t.timeboxName && `timebox ${t.timeboxName}`,
    ]),
    join([
      t.assigneeName && `assignee ${t.assigneeName}`,
      t.dueDate && `due ${t.dueDate}`,
      t.createdAt && `created ${t.createdAt.slice(0, 10)}`,
      t.changedAt && `changed ${t.changedAt.slice(0, 10)}`,
      t.tags.length > 0 && `tags ${t.tags.join(", ")}`,
    ]),
  ];
  if (t.description) lines.push("", t.description);
  if (t.externalReferences.length)
    lines.push(
      "",
      "References:",
      ...t.externalReferences.map((r) => `- ${join([r.name, r.url], " ")}`),
    );
  if (t.links) {
    const l = t.links;
    lines.push(
      "",
      "Links:",
      `- requirement: ${l.requirementId ? `[${l.requirementId}]` : "none"}`,
      `- test cases: ${l.testCases.length ? l.testCases.map(linkedTestCase).join("; ") : "none"}`,
      `- features: ${l.featureIds.length ? l.featureIds.map((f) => `[${f}]`).join(", ") : "none"}`,
      `- solution processes: ${l.solutionProcessIds.length ? l.solutionProcessIds.join(", ") : "none"}`,
    );
    if (l.unavailable.length)
      lines.push(`- not readable with this key: ${l.unavailable.join(", ")}`);
  }
  if (t.comments.length)
    lines.push(
      "",
      `Comments (${t.comments.length}):`,
      ...t.comments.map(
        (c) =>
          `- ${join([c.createdAt?.slice(0, 10), c.author], " ")}: ${c.text ?? ""}`,
      ),
    );
  return lines
    .filter((line) => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

const featureLine = (f: Feature) =>
  `${f.displayId ?? "?"} ${f.title ?? "(no title)"} [${f.id}] ${join([
    f.statusCode && `status ${f.statusCode}`,
    f.priorityCode !== null && `priority ${f.priorityCode}`,
    f.modifiedAt && `changed ${f.modifiedAt.slice(0, 10)}`,
  ])}`;

export function formatFeatures(page: Page<Feature>): string {
  return list(page, "features", featureLine);
}

export function formatFeature(f: FeatureDetail): string {
  const lines = [featureLine(f)];
  if (f.description) lines.push("", f.description);
  lines.push(
    "",
    f.transports.length
      ? `Transports: ${f.transports.join(", ")}`
      : "No transports.",
  );
  return lines.join("\n");
}

const documentLine = (d: DocumentSummary) =>
  `${d.displayId ?? "?"} ${d.title ?? "(no title)"} [${d.id}] ${join([
    d.documentTypeCode && `type ${d.documentTypeCode}`,
    d.statusCode !== null && `status ${d.statusCode}`,
    d.isTemplate && "template",
    d.modifiedAt && `changed ${d.modifiedAt.slice(0, 10)}`,
  ])}`;

export function formatDocuments(page: Page<DocumentSummary>): string {
  return list(page, "documents", documentLine);
}

export function formatDocument(d: DocumentDetail): string {
  return `${documentLine(d)}\n\n${d.content ?? "(no content)"}`;
}

const testCaseLine = (t: TestCase) =>
  `${t.displayId ?? "?"} ${t.title ?? "(no title)"} [${t.id}] ${join([
    t.kind,
    t.isPrepared === true
      ? "prepared"
      : t.isPrepared === false && "not prepared",
    t.priorityCode !== null && `priority ${t.priorityCode}`,
  ])}`;

export function formatTestCases(page: Page<TestCase>): string {
  return list(page, "test cases", testCaseLine);
}

export function formatTestCase(t: TestCaseDetail): string {
  const lines = [testCaseLine(t)];
  lines.push(
    `Covers: ${
      t.tasks.length
        ? t.tasks
            .map((k) =>
              join([k.displayId, k.typeName ?? k.type, `[${k.taskId}]`], " "),
            )
            .join("; ")
        : "no task"
    }`,
  );
  if (t.tags.length)
    lines.push(
      `Tags: ${t.tags.map((g) => (g.group ? `${g.group}: ${g.label}` : g.label)).join(", ")}`,
    );
  t.activities.forEach((activity, i) => {
    lines.push(
      `${i + 1}. ${activity.title ?? "(activity)"}${activity.inScope === false ? " (out of scope)" : ""}`,
    );
    activity.actions.forEach((action, j) => {
      lines.push(
        `   ${i + 1}.${j + 1} ${action.title ?? "(step)"}${action.evidenceRequired ? " [evidence required]" : ""}`,
      );
      if (action.description)
        lines.push(`      Do: ${action.description.replace(/\n+/g, " ")}`);
      if (action.expectedResult)
        lines.push(
          `      Expect: ${action.expectedResult.replace(/\n+/g, " ")}`,
        );
    });
  });
  if (!t.activities.length) lines.push("No activities.");
  return lines.join("\n");
}

const testPlanLine = (p: TestPlan) =>
  `${p.displayId ?? "?"} ${p.title ?? "(no title)"} [${p.id}] ${join([
    p.statusCode !== null && `status ${p.statusCode}`,
    p.startDate && `${p.startDate}–${p.endDate ?? "?"}`,
  ])}`;

export function formatTestPlans(page: Page<TestPlan>): string {
  return list(page, "test plans", testPlanLine);
}

export function formatTestPlan(p: TestPlanDetail): string {
  const lines = [testPlanLine(p)];
  if (p.description) lines.push("", p.description);
  lines.push("", `Test cases (${p.testCases.length}):`);
  for (const t of p.testCases)
    lines.push(
      `- ${t.displayId ?? "?"} ${t.title ?? ""} [${t.testCaseId ?? "?"}] ${t.type ?? ""}`.trimEnd(),
    );
  return lines.join("\n");
}

export function formatScopes(scopes: Scope[]): string {
  if (!scopes.length) return "No scopes found.";
  return scopes
    .map(
      (s) =>
        `- ${s.name ?? "(no name)"} [${s.id}]${s.description ? `: ${s.description}` : ""}`,
    )
    .join("\n");
}

export function formatSolutionProcesses(page: Page<SolutionProcess>): string {
  return list(
    page,
    "solution processes",
    (p) =>
      `${p.name ?? "(no name)"} [${p.id}] ${join([
        p.isScoped === true
          ? "in scope"
          : p.isScoped === false && "not in scope",
        p.status,
        p.countryCount > 0 && `${p.countryCount} countries`,
      ])}`,
  );
}

export function formatHierarchy(page: Page<HierarchyNode>): string {
  return list(page, "hierarchy nodes", (n) =>
    `${n.displayId ?? ""} ${n.title ?? "(no title)"} [${n.id}]${n.parentId ? ` parent ${n.parentId}` : " (root)"}`.trim(),
  );
}

export function formatLandscape(page: Page<LandscapeObject>): string {
  return list(
    page,
    "landscape objects",
    (o) =>
      `${o.name ?? "(no name)"} [${o.id}] ${join([
        o.objectType,
        o.serviceType,
        o.systemNumber && `system number ${o.systemNumber}`,
        o.role && `role ${o.role}`,
        o.deploymentModel,
      ])}`,
  );
}

export function formatLibrary(page: Page<LibraryItem>, kind: string): string {
  return list(
    page,
    kind,
    (i) =>
      `${i.displayId ?? "?"} ${i.title ?? "(no title)"} [${i.id}] ${join([
        i.typeCode,
        i.objectId,
        i.sender && i.receiver && `${i.sender} → ${i.receiver}`,
        i.solutionComponentName ?? i.systemGroupName,
        i.readinessCode && `readiness ${i.readinessCode}`,
      ])}`,
  );
}

export function formatAnalyticsProviders(
  providers: AnalyticsProvider[],
): string {
  if (!providers.length) return "No analytics providers.";
  return providers
    .map((p) =>
      `- ${p.name}: ${p.description ?? ""} ${p.scopes.length ? `(scopes: ${p.scopes.join(", ")})` : ""}`.trimEnd(),
    )
    .join("\n");
}

export function formatAnalytics(result: AnalyticsResult): string {
  if (!result.rows.length) return `No ${result.provider} rows.`;
  const header = result.columns.join(" | ");
  const rows = result.rows.map((row) =>
    result.columns
      .map((c) =>
        row[c] === null || row[c] === undefined ? "" : String(row[c]),
      )
      .join(" | "),
  );
  const footer = `${result.rows.length} rows${result.total !== null ? ` of ${result.total}` : ""}${result.truncated ? " (more exist; raise limit or filter)" : ""}. Rows are aggregates, not records.`;
  return [header, ...rows, footer].join("\n");
}

export function formatStatusEvents(page: Page<StatusEvent>): string {
  return list(
    page,
    "status events",
    (e) =>
      `${e.name ?? "?"} ${join([
        e.type,
        e.status,
        e.startTime && `from ${e.startTime}`,
        e.serviceType,
        e.systemNumber && `system number ${e.systemNumber}`,
      ])}`,
  );
}

export function formatCoverage(c: TestCoverage): string {
  const lines = [
    `Test coverage of project ${c.projectId} (${c.types.join(", ")}): ${c.rows.length} tasks, ${c.covered} with a test case, ${c.uncovered} without; ${c.testCaseCount} test cases, ${c.unlinkedTestCases.length} linked to no task.`,
    "Direct links only: a requirement covered only through its user stories counts as without.",
  ];
  if (c.truncated)
    lines.push(
      "Incomplete: a list reached the read cap of 500; counts are lower bounds.",
    );
  const uncovered = c.rows.filter((r) => !r.testCases.length);
  const covered = c.rows.filter((r) => r.testCases.length);
  if (uncovered.length)
    lines.push(
      "",
      "Without a test case:",
      ...uncovered.map((r) => `- ${taskLine(r.task)}`),
    );
  if (covered.length)
    lines.push(
      "",
      "With a test case:",
      ...covered.map(
        (r) =>
          `- ${r.task.displayId ?? "?"} ${r.task.title ?? "(no title)"} [${r.task.id}] ${r.task.typeName ?? r.task.type ?? ""} <- ${r.testCases
            .map((t) => `${t.displayId ?? "?"} ${t.title ?? ""}`.trim())
            .join("; ")}`,
      ),
    );
  if (c.unlinkedTestCases.length)
    lines.push(
      "",
      "Test cases linked to no task:",
      ...c.unlinkedTestCases.map((t) => `- ${linkedTestCase(t)}`),
    );
  return lines.join("\n");
}
