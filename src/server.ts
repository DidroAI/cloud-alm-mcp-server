import {
  ANALYTICS_DATASETS,
  type CloudAlm,
  CloudAlmError,
  formatAnalytics,
  formatAnalyticsProviders,
  formatCoverage,
  formatDocument,
  formatDocuments,
  formatFeature,
  formatFeatures,
  formatHierarchy,
  formatLandscape,
  formatLibrary,
  formatProject,
  formatProjects,
  formatScopes,
  formatSolutionProcesses,
  formatStatusEvents,
  formatTask,
  formatTasks,
  formatTestCase,
  formatTestCases,
  formatTestPlan,
  formatTestPlans,
  LIBRARY_KINDS,
  MAX_LIMIT,
} from "./calm/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const SERVER_NAME = "cloud-alm";
export const SERVER_VERSION = "0.1.0";

/**
 * Any 8-4-4-4-12 hex id. Not `z.uuid()`: Cloud ALM ids need not be RFC 4122
 * (some tenants use project ids like `11111111-1111-1111-1111-111111111111`).
 */
const GUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const guid = (what: string) =>
  z
    .string()
    .regex(GUID, "must be a GUID")
    .describe(`${what} (a GUID, as shown in [brackets] by list tools)`);
const projectId = guid("Project id").optional();
const paging = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Items per page, 1–${MAX_LIMIT}, default 50`),
  offset: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .optional()
    .describe("Items to skip; use the offset a previous page gave"),
};

/** Drop undefined keys: the library's options use exact optional types. */
function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}

/** Run a read; a CloudAlmError becomes a tool error the model can read. */
async function answer(read: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: await read() }] };
  } catch (error) {
    if (error instanceof CloudAlmError)
      return {
        isError: true,
        content: [
          { type: "text", text: `Cloud ALM ${error.code}: ${error.reason}` },
        ],
      };
    return {
      isError: true,
      content: [{ type: "text", text: "Cloud ALM read failed unexpectedly." }],
    };
  }
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * An MCP server whose tools are thin wrappers over one `CloudAlm` reader.
 * Every tool is read-only; the server holds no credentials of its own.
 */
export function createServer(calm: CloudAlm): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Read-only access to one SAP Cloud ALM tenant. Start with calm_list_projects; list tools show ids in [brackets] to pass to get tools. Lists page with limit and offset.",
    },
  );
  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    title: string,
    description: string,
    inputSchema: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<string>,
  ) =>
    server.registerTool(
      name,
      {
        title,
        description,
        // A zod v4 raw shape; the SDK's compat type does not name v4 shapes.
        inputSchema: inputSchema as never,
        annotations: { ...READ_ONLY, title },
      },
      // The SDK has validated `args` against `inputSchema`.
      ((args: z.infer<z.ZodObject<Shape>>) => answer(() => run(args))) as never,
    );

  tool(
    "calm_list_projects",
    "List projects",
    "List the Cloud ALM projects (id, name, purpose, status).",
    {},
    async () => formatProjects(await calm.listProjects()),
  );
  tool(
    "calm_get_project",
    "Get a project",
    "One project with its timeboxes (phases, sprints) and teams.",
    { projectId: guid("Project id") },
    async (a) => formatProject(await calm.getProject(a.projectId)),
  );
  tool(
    "calm_search_tasks",
    "Search tasks",
    "Tasks of a project: requirements, user stories, defects, roadmap tasks, risks… Filter by type, status code or words in the title. Without projectId, searches every project.",
    {
      projectId,
      type: z
        .string()
        .max(40)
        .optional()
        .describe(
          "Task type: requirement, user story, defect, roadmap task, project task, sub-task, quality gate, risk, or a code like CALMREQU",
        ),
      status: z
        .string()
        .max(40)
        .optional()
        .describe("Status code, e.g. CIPDFCTOPEN"),
      query: z
        .string()
        .max(200)
        .optional()
        .describe("Words that must all appear in the title"),
      ...paging,
    },
    async (a) => formatTasks(await calm.listTasks(defined(a))),
  );
  tool(
    "calm_get_task",
    "Get a task",
    "One task with its description, references, comments, tags and links: its requirement, the test cases covering it, its features and solution processes.",
    { taskId: guid("Task id") },
    async (a) => formatTask(await calm.getTask(a.taskId)),
  );
  tool(
    "calm_list_features",
    "List features",
    "Features (deliverable changes, linked to transports), optionally for one project.",
    { projectId, ...paging },
    async (a) => formatFeatures(await calm.listFeatures(defined(a))),
  );
  tool(
    "calm_get_feature",
    "Get a feature",
    "One feature with its description and transport request ids.",
    { featureId: guid("Feature id") },
    async (a) => formatFeature(await calm.getFeature(a.featureId)),
  );
  tool(
    "calm_list_documents",
    "List documents",
    "Documents (specifications, designs…), optionally for one project.",
    { projectId, ...paging },
    async (a) => formatDocuments(await calm.listDocuments(defined(a))),
  );
  tool(
    "calm_get_document",
    "Get a document",
    "One document with its content as plain text.",
    { documentId: guid("Document id") },
    async (a) => formatDocument(await calm.getDocument(a.documentId)),
  );
  tool(
    "calm_list_test_cases",
    "List test cases",
    "Manual (default) or automated test cases, optionally for one project.",
    {
      projectId,
      kind: z
        .enum(["manual", "automated"])
        .optional()
        .describe("manual (default) or automated"),
      ...paging,
    },
    async (a) => formatTestCases(await calm.listTestCases(defined(a))),
  );
  tool(
    "calm_get_test_case",
    "Get a test case",
    "One manual test case with its activities and steps (what to do, what to expect), the tasks it covers and its tags.",
    { testCaseId: guid("Test case id") },
    async (a) => formatTestCase(await calm.getTestCase(a.testCaseId)),
  );
  tool(
    "calm_test_coverage",
    "Test coverage",
    "Which requirements and user stories of a project have a test case linked to them and which have none, plus test cases linked to no task. Direct links only. Use it to find what still needs a test.",
    {
      projectId: guid("Project id"),
      types: z
        .array(z.string().max(40))
        .max(9)
        .optional()
        .describe(
          'Task types to check (default ["requirement", "user story"]); names or codes like CALMREQU',
        ),
    },
    async (a) => formatCoverage(await calm.testCoverage(defined(a))),
  );
  tool(
    "calm_list_test_plans",
    "List test plans",
    "Test plans (test cycles such as UAT), optionally for one project.",
    { projectId, ...paging },
    async (a) => formatTestPlans(await calm.listTestPlans(defined(a))),
  );
  tool(
    "calm_get_test_plan",
    "Get a test plan",
    "One test plan with its dates and assigned test cases.",
    { testPlanId: guid("Test plan id") },
    async (a) => formatTestPlan(await calm.getTestPlan(a.testPlanId)),
  );
  tool(
    "calm_list_scopes",
    "List scopes",
    "Project scopes: the sets of processes a project implements.",
    { projectId },
    async (a) => formatScopes(await calm.listScopes(defined(a))),
  );
  tool(
    "calm_list_processes",
    "List solution processes",
    "Solution processes (SAP Best Practices or custom end-to-end processes) and whether each is in scope.",
    { projectId, scopeId: guid("Scope id").optional(), ...paging },
    async (a) =>
      formatSolutionProcesses(await calm.listSolutionProcesses(defined(a))),
  );
  tool(
    "calm_list_process_hierarchy",
    "List process hierarchy",
    "Nodes of the customer's process hierarchy, with their parents.",
    { ...paging },
    async (a) => formatHierarchy(await calm.listProcessHierarchy(defined(a))),
  );
  tool(
    "calm_list_landscape",
    "List landscape",
    "Landscape objects: systems, cloud services and business services, with system numbers and roles.",
    {
      objectType: z
        .string()
        .regex(/^[A-Za-z]{1,40}$/)
        .optional()
        .describe("e.g. CloudService, BusinessService, TechnicalSystem"),
      ...paging,
    },
    async (a) => formatLandscape(await calm.listLandscapeObjects(defined(a))),
  );
  tool(
    "calm_list_library",
    "List library items",
    "Cross-library items: applications (apps, transactions), developments (custom objects), interfaces, configurations.",
    { kind: z.enum(LIBRARY_KINDS), ...paging },
    async ({ kind, ...rest }) =>
      formatLibrary(await calm.listLibraryItems(kind, defined(rest)), kind),
  );
  tool(
    "calm_list_analytics_providers",
    "List analytics providers",
    "Analytics data providers the tenant offers, with the scopes each needs.",
    {},
    async () => formatAnalyticsProviders(await calm.listAnalyticsProviders()),
  );
  tool(
    "calm_query_analytics",
    "Query analytics",
    "Aggregated rows of one analytics dataset (tasks, defects, tests, jobs, exceptions…). Rows are aggregates, not records.",
    {
      dataset: z.enum(ANALYTICS_DATASETS),
      period: z
        .string()
        .regex(/^[A-Za-z0-9]{1,10}$/)
        .optional()
        .describe("Period code, e.g. C1D, C7D, C30D"),
      resolution: z
        .string()
        .regex(/^[A-Za-z0-9]{1,10}$/)
        .optional()
        .describe("Resolution code, e.g. D, W"),
      filters: z
        .record(z.string(), z.string().max(200))
        .optional()
        .describe('Dimension equalities, e.g. { "project": "<id>" }'),
      limit: paging.limit,
    },
    async (a) => formatAnalytics(await calm.queryAnalytics(defined(a))),
  );
  tool(
    "calm_list_status_events",
    "List status events",
    "Service status events: outages, maintenance and communications for the tenant's services.",
    { ...paging },
    async (a) => formatStatusEvents(await calm.listStatusEvents(defined(a))),
  );
  return server;
}

/** Tool names, for documentation and tests. */
export const TOOL_NAMES = [
  "calm_list_projects",
  "calm_get_project",
  "calm_search_tasks",
  "calm_get_task",
  "calm_list_features",
  "calm_get_feature",
  "calm_list_documents",
  "calm_get_document",
  "calm_list_test_cases",
  "calm_get_test_case",
  "calm_test_coverage",
  "calm_list_test_plans",
  "calm_get_test_plan",
  "calm_list_scopes",
  "calm_list_processes",
  "calm_list_process_hierarchy",
  "calm_list_landscape",
  "calm_list_library",
  "calm_list_analytics_providers",
  "calm_query_analytics",
  "calm_list_status_events",
] as const;
