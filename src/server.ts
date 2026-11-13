import {
  ANALYTICS_DATASETS,
  type CloudAlm,
  CloudAlmError,
} from "./calm/index.js";
import {
  getUiCapability,
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  APPROVAL_MODES,
  ApprovalError,
  type ApprovalMode,
  CARD_URI,
  cardHtml,
  META_KEY,
  propose,
  take,
} from "./approval.js";
import { z } from "zod";
import type { CloudAlmWriter } from "./calm/writer.js";
import {
  CREATABLE_TASK_TYPES,
  createTask,
  createTestCase,
  link,
  tag,
} from "./views/write.js";
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

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export type ServerOptions = ViewOptions & {
  /** Tool names to offer; others are left out. Default: all. */
  tools?: readonly string[];
  /**
   * Writing: off (default), "on", or "dry-run" (write tools answer with
   * what they would send). Needs `writer`.
   */
  writeMode?: "off" | "on" | "dry-run";
  /** The writer write tools use; created from the same credentials. */
  writer?: CloudAlmWriter;
  /**
   * Human approval of writes (mode "on"): off (default here; the
   * environment defaults to prefer), prefer or required. See approval.ts.
   */
  approval?: ApprovalMode;
  /**
   * How to reach the user: "detect" from the client's capabilities (stdio),
   * or "card" (stateless HTTP, where capabilities are not known per call
   * and dialogs cannot be sent).
   */
  approvalChannel?: "detect" | "card";
  /** Who may approve a pending write: a hash of the caller's token, or "local". */
  approvalSubject?: string;
};

/** Tools of the approval flow; offered with approval on, outside CALM_TOOLS. */
export const APPROVAL_TOOL_NAMES = ["calm_approve", "calm_confirm"] as const;

/** A dry run's answer without its "nothing sent" lead, for the user. */
const previewText = (text: string) => text.replace(/^Dry run[^\n]*?nothing sent\.\s*/, "").trim();

const INSTRUCTIONS =
  "SAP Cloud ALM. Start with calm_overview. Items have short display ids (3-17 task, 6-1 feature, 7-1 document, 8-1-2 test case, 8-3-1 test plan) that every tool accepts. calm_find lists, calm_get reads several items at once, calm_trace follows links (requirement → user stories → features → transports, test cases, documents, process), calm_gaps lists what is missing.";

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
    {
      instructions: `${INSTRUCTIONS} ${
        options.writer && options.writeMode === "on"
          ? options.approval && options.approval !== "off"
            ? "Write tools are on, with the user's approval: a write answers with a preview the user approves (in a card, a dialog, or by saying yes in the chat when the answer asks for calm_confirm). Never call calm_confirm without the user's yes to that exact change."
            : "Write tools are on: confirm with the user before writing."
          : options.writer && options.writeMode === "dry-run"
            ? "Write tools are in dry-run mode, set by the operator (CALM_WRITE=dry-run): they only preview, even with dryRun false. Tell the user what would be written."
            : "Read-only: no write tools."
      }`,
    },
  );
  const allowed = options.tools ? new Set(options.tools) : null;
  const writeMode = options.writeMode ?? "off";
  const approval: ApprovalMode =
    options.writer && writeMode === "on" ? (options.approval ?? "off") : "off";
  const subject = options.approvalSubject ?? "local";
  /** Write tools by name, so an approval can run the stored call. */
  const writes = new Map<string, { title: string; run: (args: Record<string, unknown>) => Promise<string> }>();

  type Extra = { requestId: string | number; signal: AbortSignal };
  const gated = async (
    name: string,
    title: string,
    args: Record<string, unknown>,
    run: (args: Record<string, unknown>) => Promise<string>,
    extra: Extra,
  ): Promise<CallToolResult> => {
    const preview = await answer(() => run({ ...args, dryRun: true }));
    if (preview.isError) return preview;
    const text = previewText(String((preview.content[0] as { text?: string })?.text ?? ""));
    const caps = server.server.getClientCapabilities();
    const ui =
      options.approvalChannel === "card" ||
      Boolean(getUiCapability(caps as never)?.mimeTypes?.includes(RESOURCE_MIME_TYPE));
    if (ui) {
      const p = propose({ tool: name, args, preview: text, subject, channel: "card" });
      return {
        content: [
          {
            type: "text",
            text: `An approval card is shown to the user. Nothing is written until they approve it there; do not call ${name} again for this change. Preview:\n${text}`,
          },
        ],
        _meta: { [META_KEY]: { ...p, title, tool: name, preview: text } },
      };
    }
    if (caps?.elicitation) {
      const result = await server.server
        .elicitInput(
          {
            mode: "form",
            message: `Cloud ALM: ${title}\n\n${text}`,
            requestedSchema: {
              type: "object",
              properties: {
                approve: { type: "boolean", title: "Approve this change", default: true },
              },
              required: ["approve"],
            },
          },
          { relatedRequestId: extra.requestId, signal: extra.signal, timeout: 5 * 60_000 },
        )
        .catch(() => ({ action: "cancel" as const, content: undefined }));
      if (result.action === "accept" && result.content?.approve === true)
        return answer(() => run({ ...args, dryRun: false }));
      return {
        content: [
          {
            type: "text",
            text: `Not written: the user ${result.action === "accept" ? "did not approve" : result.action === "decline" ? "declined" : "did not answer"}.`,
          },
        ],
      };
    }
    if (approval === "prefer") {
      const p = propose({ tool: name, args, preview: text, subject, channel: "chat" });
      return {
        content: [
          {
            type: "text",
            text: `Approval needed, nothing written yet. Show the user this change and ask them to approve it; only if they say yes, call calm_confirm with id "${p.id}" (valid 10 minutes).\n${text}`,
          },
        ],
      };
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Not written: the operator requires approval (CALM_APPROVAL=required), and this client can show neither an approval card nor a confirm dialog.",
        },
      ],
    };
  };

  const tool = <Shape extends z.ZodRawShape>(
    name: (typeof TOOL_NAMES)[number] | (typeof WRITE_TOOL_NAMES)[number],
    title: string,
    description: string,
    inputSchema: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<string>,
  ) => {
    if (allowed && !allowed.has(name)) return;
    const isWrite = (WRITE_TOOL_NAMES as readonly string[]).includes(name);
    const config = {
      title,
      description,
      // A zod v4 raw shape; the SDK's compat type does not name v4 shapes.
      inputSchema: inputSchema as never,
      annotations: isWrite ? { ...WRITE, title } : { ...READ_ONLY, title },
    };
    if (isWrite && approval !== "off") {
      const runAny = run as unknown as (args: Record<string, unknown>) => Promise<string>;
      writes.set(name, { title, run: runAny });
      registerAppTool(
        server,
        name,
        { ...config, _meta: { ui: { resourceUri: CARD_URI } } },
        ((args: Record<string, unknown>, extra: Extra) =>
          args.dryRun === true ? answer(() => runAny(args)) : gated(name, title, args, runAny, extra)) as never,
      );
      return;
    }
    server.registerTool(
      name,
      config,
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
    "Full content of 1–10 items: description, test case steps and latest result, document content, feature transports, and every link with its title.",
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
    "What is missing or failing in a project: requirements and user stories without a test case, process or feature; failed test runs; features whose tasks are untested; test cases linked to nothing or not prepared.",
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

  const writer = options.writer;
  if (writer && writeMode !== "off") {
    const w = { ...options, writeMode } as const;
    const dryRun = z.boolean().optional().describe("true: answer with what would be sent, send nothing");
    const step = z.object({
      title: z.string().min(1).max(500),
      description: z.string().min(1).max(4000).describe("What to do; required by Cloud ALM"),
      expected: z.string().min(1).max(4000),
      evidence: z.boolean().optional(),
    });
    tool(
      "calm_create_test_case",
      "Create a manual test case",
      "Create a manual test case with activities and steps, linked to the tasks it covers. Cannot be deleted or tagged through the API afterwards: check with the user first; refuses a duplicate title.",
      {
        title: z.string().min(1).max(250),
        covers: z.array(ref).max(20).optional().describe("Requirements or user stories it tests"),
        activities: z.array(z.object({ title: z.string().min(1).max(250), steps: z.array(step).min(1).max(50) })).min(1).max(30),
        priority: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(40)]).optional().describe("10 very high … 40 low; default 30"),
        projectId,
        dryRun,
      },
      (a) => createTestCase(calm, writer, defined(a) as never, w),
    );
    tool(
      "calm_link",
      "Link a test case or feature to tasks",
      "Link a manual test case (it tests them) or a feature (it delivers them) to requirements or user stories. Skips links that exist.",
      { from: ref.describe("Test case or feature id"), tasks: z.array(ref).min(1).max(20), projectId, dryRun },
      (a) => link(calm, writer, defined(a) as never, w),
    );
    tool(
      "calm_tag",
      "Tag tasks",
      "Add or remove tags on requirements, user stories, defects or tasks; other tags stay. (Test cases cannot be tagged through the API.)",
      {
        tasks: z.array(ref).min(1).max(20),
        add: z.array(z.string().min(1).max(256)).max(20).optional(),
        remove: z.array(z.string().min(1).max(256)).max(20).optional(),
        projectId,
        dryRun,
      },
      (a) => tag(calm, writer, defined(a) as never, w),
    );
    tool(
      "calm_create_task",
      "Create a task",
      "Create a requirement, user story (optionally under a requirement), defect or project task. Refuses a duplicate title of the same type.",
      {
        type: z.enum(CREATABLE_TASK_TYPES as [string, ...string[]]),
        title: z.string().min(1).max(180),
        description: z.string().min(1).max(8000).describe("Plain text; blank lines separate paragraphs"),
        requirement: ref.optional().describe("Parent requirement of a user story or project task"),
        priority: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(40)]).optional(),
        tags: z.array(z.string().min(1).max(256)).max(20).optional(),
        projectId,
        dryRun,
      },
      (a) => createTask(calm, writer, defined(a) as never, w),
    );
  }
  if (approval !== "off") registerApproval();
  return server;

  /** The card resource and the tools that carry the user's decision. */
  function registerApproval() {
    registerAppResource(
      server,
      "Cloud ALM approval",
      CARD_URI,
      { description: "Approve or reject a change to SAP Cloud ALM", _meta: { ui: { csp: {}, prefersBorder: true } } },
      async () => ({ contents: [{ uri: CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: cardHtml() }] }),
    );
    const decide = async (id: string, nonce: string | undefined, approve: boolean): Promise<CallToolResult> => {
      try {
        const p = take(id, subject, nonce);
        if (!approve) return { content: [{ type: "text", text: "Rejected by the user; nothing was written." }] };
        const write = writes.get(p.tool);
        if (!write) return { isError: true, content: [{ type: "text", text: `${p.tool} is not offered by this server.` }] };
        return answer(() => write.run({ ...p.args, dryRun: false }));
      } catch (error) {
        if (error instanceof ApprovalError) return { isError: true, content: [{ type: "text", text: error.message }] };
        throw error;
      }
    };
    registerAppTool(
      server,
      "calm_approve",
      {
        title: "Approve (approval card only)",
        description: "Called by the approval card when the user clicks Approve or Reject. The assistant never calls it.",
        inputSchema: {
          id: z.string().regex(/^[0-9a-f]{12}$/),
          nonce: z.string().min(16).max(64),
          decision: z.enum(["approve", "reject"]),
        } as never,
        annotations: { ...WRITE, title: "Approve" },
        _meta: { ui: { resourceUri: CARD_URI, visibility: ["app"] } },
      },
      ((a: { id: string; nonce: string; decision: string }) => decide(a.id, a.nonce, a.decision === "approve")) as never,
    );
    if (approval === "prefer")
      server.registerTool(
        "calm_confirm",
        {
          title: "Confirm a change the user approved in the chat",
          description:
            "Runs a change a write tool proposed, after the user said yes in the chat. Only call it when the user approved that exact change.",
          inputSchema: { id: z.string().regex(/^[0-9a-f]{12}$/) } as never,
          annotations: { ...WRITE, title: "Confirm" },
        },
        ((a: { id: string }) => decide(a.id, undefined, true)) as never,
      );
  }
}

/**
 * Server options from the environment: `CALM_PROJECT` (default project
 * GUID), `CALM_TOOLS` (comma-separated tool names to offer), `CALM_WRITE`
 * (off, on, dry-run).
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
  const write = env.CALM_WRITE?.trim().toLowerCase();
  if (write) {
    if (!["off", "on", "dry-run"].includes(write)) throw new Error("CALM_WRITE must be off, on or dry-run.");
    options.writeMode = write as "off" | "on" | "dry-run";
  }
  const approval = env.CALM_APPROVAL?.trim().toLowerCase();
  if (approval) {
    if (!(APPROVAL_MODES as string[]).includes(approval))
      throw new Error("CALM_APPROVAL must be off, prefer or required.");
    options.approval = approval as ApprovalMode;
  } else if (options.writeMode === "on") options.approval = "prefer";
  const tools = env.CALM_TOOLS?.split(",").map((t) => t.trim()).filter(Boolean);
  if (tools?.length) {
    const known = [...TOOL_NAMES, ...WRITE_TOOL_NAMES] as readonly string[];
    const unknown = tools.filter((t) => !known.includes(t));
    if (unknown.length) throw new Error(`CALM_TOOLS: unknown tools ${unknown.join(", ")}; known: ${known.join(", ")}.`);
    options.tools = tools;
  }
  return options;
}

/** Write tools, offered only when writing is on. */
export const WRITE_TOOL_NAMES = [
  "calm_create_test_case",
  "calm_link",
  "calm_tag",
  "calm_create_task",
] as const;

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
