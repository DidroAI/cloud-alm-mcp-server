import {
  ANALYTICS_DATASETS,
  type CloudAlm,
  CloudAlmError,
} from "./calm/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  analytics,
  FIND_TYPES,
  find,
  GAP_CHECKS,
  gaps,
  get,
  landscape,
  overview,
  trace,
  type ViewOptions,
} from "./views/tools.js";
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
const projectId = guid("Project id").optional().describe("Project GUID; omit when the tenant has one project or a default is set");

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

export type ServerOptions = ViewOptions & {
  /** Tool names to offer; others are left out. Default: all. */
  tools?: readonly string[];
};

const INSTRUCTIONS =
  "SAP Cloud ALM, read-only. Start with calm_overview. Items have short display ids (3-17 task, 6-1 feature, 7-1 document, 8-1-2 test case, 8-3-1 test plan) that every tool accepts. calm_find lists, calm_get reads several items at once, calm_trace follows links (requirement → user stories → features → transports, test cases, documents, process), calm_gaps lists what is missing.";

/**
 * An MCP server with a few task-shaped tools over one `CloudAlm` reader.
 * Every tool is read-only; the server holds no credentials of its own.
 */
export function createServer(
  calm: CloudAlm,
  options: ServerOptions = {},
): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  const allowed = options.tools ? new Set(options.tools) : null;
  const tool = <Shape extends z.ZodRawShape>(
    name: (typeof TOOL_NAMES)[number],
    title: string,
    description: string,
    inputSchema: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<string>,
  ) => {
    if (allowed && !allowed.has(name)) return;
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
  };
  const ref = z
    .string()
    .min(1)
    .max(80)
    .describe("Display id (3-17, 6-1, 8-1-2), GUID, or process id (ERL-…)");

  tool(
    "calm_overview",
    "Overview",
    "Start here. A project at a glance: current phase, counts of requirements, user stories, defects, features, test cases, documents by status, tags in use, and gaps.",
    { projectId },
    (a) => overview(calm, defined(a), options),
  );
  tool(
    "calm_find",
    "Find items",
    "List or search items of a project in one call: tasks (requirements, user stories, defects…), features, documents, test cases, test plans, processes, library. Words match titles and tags; `a b | c` means (a and b) or c.",
    {
      query: z.string().max(200).optional().describe("Words in the title or tags"),
      types: z.array(z.enum(FIND_TYPES)).optional().describe("Default: all project items (not library)"),
      status: z.string().max(40).optional().describe('e.g. "open", "done", "in testing"'),
      tag: z.string().max(256).optional(),
      projectId,
      limit: z.number().int().min(1).max(100).optional().describe("Default 30"),
      offset: z.number().int().min(0).max(5000).optional(),
    },
    (a) => find(calm, defined(a), options),
  );
  tool(
    "calm_get",
    "Get items",
    "Full content of 1–10 items: description, steps of a test case, content of a document, transports of a feature, and every link with its title.",
    { ids: z.array(ref).min(1).max(10), projectId },
    (a) => get(calm, defined(a), options),
  );
  tool(
    "calm_trace",
    "Trace links",
    "Follow an item's links both ways: requirement → user stories → features (status, transports), test cases, documents, solution process. Start from a task, feature, test case, document or process.",
    { id: ref, projectId },
    (a) => trace(calm, defined(a), options),
  );
  tool(
    "calm_gaps",
    "Find gaps",
    "What is missing in a project: requirements and user stories without a test case, process or feature; features whose tasks are untested; test cases linked to nothing or not prepared.",
    {
      checks: z.array(z.enum(GAP_CHECKS)).optional().describe("Default: all"),
      max: z.number().int().min(1).max(200).optional().describe("Items listed per check, default 20"),
      projectId,
    },
    (a) => gaps(calm, defined(a), options),
  );
  tool(
    "calm_analytics",
    "Analytics",
    "Cloud ALM analytics, refreshed daily, tenant-wide: tasks, defects, test runs, jobs, exceptions, integration messages… Without dataset: the list. groupBy counts by columns.",
    {
      dataset: z.enum(ANALYTICS_DATASETS).optional(),
      groupBy: z.array(z.string().max(60)).max(4).optional(),
      filters: z.record(z.string(), z.string().max(200)).optional().describe('Column equalities, e.g. {"project":"<id>"}'),
      period: z.string().regex(/^[A-Za-z0-9]{1,10}$/).optional().describe("e.g. C1D, C7D, C30D"),
      limit: z.number().int().min(1).max(200).optional(),
    },
    (a) => analytics(calm, defined(a)),
  );
  tool(
    "calm_landscape",
    "Landscape and service status",
    "Systems and cloud services of the tenant, and SAP service status events (outages, maintenance), open ones first.",
    {},
    () => landscape(calm),
  );
  return server;
}

/**
 * Server options from the environment: `CALM_PROJECT` (default project
 * GUID), `CALM_TOOLS` (comma-separated tool names to offer).
 */
export function serverOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ServerOptions {
  const options: ServerOptions = {};
  const project = env.CALM_PROJECT?.trim();
  if (project) {
    if (!GUID.test(project)) throw new Error("CALM_PROJECT must be a project GUID.");
    options.defaultProject = project;
  }
  const tools = env.CALM_TOOLS?.split(",").map((t) => t.trim()).filter(Boolean);
  if (tools?.length) {
    const unknown = tools.filter((t) => !(TOOL_NAMES as readonly string[]).includes(t));
    if (unknown.length) throw new Error(`CALM_TOOLS: unknown tools ${unknown.join(", ")}; known: ${TOOL_NAMES.join(", ")}.`);
    options.tools = tools;
  }
  return options;
}

/** Tool names, for documentation, tests and the allow list. */
export const TOOL_NAMES = [
  "calm_overview",
  "calm_find",
  "calm_get",
  "calm_trace",
  "calm_gaps",
  "calm_analytics",
  "calm_landscape",
] as const;
