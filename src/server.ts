import {
  ANALYTICS_DATASETS,
  type CloudAlm,
  CloudAlmError,
} from "./calm/index.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  createRequestStateCodec,
  inputRequired,
  McpServer,
} from "@modelcontextprotocol/server";
import type { CallToolResult, ClientCapabilities, ServerContext } from "@modelcontextprotocol/server";
import { randomBytes } from "node:crypto";
import {
  APPROVAL_MODES,
  TTL_MS,
  ApprovalError,
  type ApprovalMode,
  CARD_URI,
  cardHtml,
  META_KEY,
  peek,
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
import { forgetSnapshots } from "./views/snapshot.js";
import { GET_OUT, LIST_OUT } from "./schemas.js";
import { NOTHING_TO_DO } from "./views/items.js";
import {
  comment,
  createDocument,
  createFeature,
  DOCUMENT_TYPE_HELP,
  remove,
  update,
} from "./views/edit.js";
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
export const SERVER_VERSION = "0.1.0-beta.0";

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
/** A read's answer: text for the model, and the same as data when the tool declares an output schema. */
export type Out = string | { text: string; data: Record<string, unknown> };

async function answer(read: () => Promise<Out>): Promise<CallToolResult> {
  try {
    const out = await read();
    return typeof out === "string"
      ? { content: [{ type: "text", text: out }] }
      : { content: [{ type: "text", text: out.text }], structuredContent: out.data };
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

/** Write tools that can remove or overwrite what is there. */
const DESTRUCTIVE = new Set(["calm_update", "calm_delete", "calm_link", "calm_tag"]);

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
   * Also ask in the client's confirm dialog (MCP elicitation) when it
   * declares one. Off by default: only terminal clients show it reliably;
   * others decline unseen. Never over stateless HTTP.
   */
  approvalDialog?: boolean;
  /** Who may approve a pending write: a hash of the caller's token, or "local". */
  approvalSubject?: string;
};

/** Tools of the approval flow; offered with approval on, outside CALM_TOOLS. */
export const APPROVAL_TOOL_NAMES = ["calm_approve", "calm_confirm"] as const;

/** A dry run's answer without its "nothing sent" lead, for the user. */
const previewText = (text: string) => text.replace(/^Dry run[^\n]*?nothing sent\.\s*/, "").trim();

const INSTRUCTIONS =
  "SAP Cloud ALM. Start with calm_overview. Items have short display ids (3-17 task, 6-1 feature, 7-1 document, 8-1-2 test case, 8-3-1 test plan) that every tool accepts, as do codes in titles (REQ-03). calm_find lists (status \"failed\" finds failed test cases), calm_get reads several items at once, calm_trace follows links (requirement → user stories → features → transports, test cases, defects, documents, process), calm_gaps lists what is missing or failing. SAP service status, outages and maintenance: calm_landscape. Counts across the tenant by status, priority or day (defects by status, test results, jobs, messages): calm_analytics.";

/**
 * An MCP server with a few task-shaped tools over one `CloudAlm` reader.
 * Every tool is read-only; the server holds no credentials of its own.
 */
/** Process-wide: a dialog's retry reaches the process that asked. */
const STATE_KEY = randomBytes(32);

export function createServer(
  calm: CloudAlm,
  options: ServerOptions = {},
): McpServer {
  const subject = options.approvalSubject ?? "local";
  // Signs the proposal id that rides the client's confirm dialog (2026-07-28).
  const stateCodec = createRequestStateCodec<{ id: string }>({ key: STATE_KEY, ttlSeconds: TTL_MS / 1000, bind: () => subject });
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      requestState: { verify: stateCodec.verify },
      instructions: `${INSTRUCTIONS} ${
        options.writer && options.writeMode === "on"
          ? options.approval && options.approval !== "off"
            ? `Write tools are on, with the user's approval: a write only proposes the change and answers with a preview; nothing is written until the user approves it (in the approval card${options.approval === "prefer" ? ", or by saying yes in the chat, after which you call calm_confirm with the id" : ""}). Never call calm_confirm without the user's yes to that exact change. calm_delete cannot be undone; features cannot be deleted at all.`
            : "Write tools are on: confirm with the user before each write (show the dryRun preview); calm_delete cannot be undone, and features cannot be deleted at all."
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
  /** Write tools by name, so an approval can run the stored call. */
  const writes = new Map<string, { title: string; run: (args: Record<string, unknown>) => Promise<string> }>();

  type Extra = ServerContext;
  const approveSchema = z.object({ approve: z.boolean().describe("Approve this change") });
  /** The client's capabilities: per request in the 2026-07-28 era, from the handshake before. */
  const capabilitiesOf = (ctx: Extra): ClientCapabilities | undefined =>
    ctx.mcpReq.envelope
      ? ((ctx.mcpReq.envelope as Record<string, unknown>)[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities | undefined)
      : server.server.getClientCapabilities();
  const runApproved = async (id: string, nonce: string | undefined, run: (args: Record<string, unknown>) => Promise<string>, args: Record<string, unknown>) => {
    try {
      take(id, subject, nonce, Date.now(), true);
    } catch (error) {
      if (error instanceof ApprovalError) return { isError: true, content: [{ type: "text", text: error.message }] } as CallToolResult;
      throw error;
    }
    return answer(() => run({ ...args, dryRun: false }));
  };
  const gated = async (
    name: string,
    title: string,
    args: Record<string, unknown>,
    run: (args: Record<string, unknown>) => Promise<string>,
    ctx: Extra,
  ): Promise<CallToolResult> => {
    // "Create a defect" rather than the tool's generic "Create a task".
    if (name === "calm_create_task" && typeof args.type === "string") title = `Create a ${args.type.replace(/_/g, " ")}`;
    // 2026-07-28: the retry after the client's confirm dialog carries the
    // proposal id in the signed request state and the user's answer.
    const state = ctx.mcpReq.envelope ? ctx.mcpReq.requestState<{ id: string }>() : undefined;
    if (state && typeof state === "object" && state.id) {
      if (acceptedContent(ctx.mcpReq.inputResponses, "approve", approveSchema)?.approve === true) return runApproved(state.id, undefined, run, args);
      const kept = peek(state.id, subject);
      if (kept) return proposalAnswer(name, title, kept.preview, { id: state.id, nonce: kept.nonce, expiresAt: kept.expiresAt });
    }
    const preview = await answer(() => run({ ...args, dryRun: true }));
    if (preview.isError) return preview;
    const text = previewText(String((preview.content[0] as { text?: string })?.text ?? ""));
    // Nothing would change: say so, and ask nobody to approve it.
    if (text.startsWith(NOTHING_TO_DO)) return { content: [{ type: "text", text }] };
    // Always a proposal: a host may draw the card without declaring MCP Apps,
    // so every answer carries what the card needs, and the text a fallback.
    const p = propose({ tool: name, args, preview: text, subject, allowChat: approval === "prefer" });
    if (options.approvalDialog && capabilitiesOf(ctx)?.elicitation) {
      const message = `Cloud ALM: ${title}\n\n${text}`;
      if (ctx.mcpReq.envelope)
        return inputRequired({
          inputRequests: { approve: inputRequired.elicit({ message, requestedSchema: approveSchema }) },
          requestState: await stateCodec.mint({ id: p.id }, ctx),
        }) as unknown as CallToolResult;
      const result = await ctx.mcpReq
        .elicitInput(
          {
            mode: "form",
            message,
            requestedSchema: {
              type: "object",
              properties: { approve: { type: "boolean", title: "Approve this change", default: true } },
              required: ["approve"],
            },
          },
          { signal: ctx.mcpReq.signal, timeout: 5 * 60_000 },
        )
        .catch(() => undefined);
      if (result?.action === "accept" && result.content?.approve === true) return runApproved(p.id, p.nonce, run, args);
      // Some clients decline without showing the dialog: keep the proposal.
    }
    return proposalAnswer(name, title, text, p);
  };
  const proposalAnswer = (name: string, title: string, text: string, p: { id: string; nonce: string; expiresAt: number }): CallToolResult => {
    const ttl = `until ${new Date(p.expiresAt).toISOString().slice(11, 16)} UTC`;
    const ask =
      approval === "prefer"
        ? `Approval needed; nothing is written yet. The user approves in the approval card if their app shows one, or by saying yes in the chat: show them this change and ask. Only after their yes to this exact change, call calm_confirm with id "${p.id}" (valid ${ttl}). Do not call ${name} again for this change.`
        : `Approval needed; nothing is written yet. The user approves in the approval card (id "${p.id}", valid ${ttl}); this server does not accept approval in the chat. Do not call ${name} again for this change.`;
    return {
      content: [{ type: "text", text: `${ask}\n\n${title}:\n${text}` }],
      // Some hosts show the model only structuredContent, so it repeats the
      // ask; the nonce stays in _meta.
      structuredContent: { approval: { id: p.id, tool: name, title, preview: text, expiresAt: new Date(p.expiresAt).toISOString(), chat: approval === "prefer", next: ask } },
      _meta: { [META_KEY]: { ...p, title, tool: name, preview: text, chat: approval === "prefer" } },
    };
  };

  const tool = <Shape extends z.ZodRawShape>(
    name: (typeof TOOL_NAMES)[number] | (typeof WRITE_TOOL_NAMES)[number],
    title: string,
    description: string,
    inputSchema: Shape,
    write: (args: z.infer<z.ZodObject<Shape>>) => Promise<Out>,
    outputSchema?: z.ZodObject,
  ) => {
    if (allowed && !allowed.has(name)) return;
    const isWrite = (WRITE_TOOL_NAMES as readonly string[]).includes(name);
    // After a write, cached reads of the project are stale: drop them.
    const run = isWrite
      ? async (args: z.infer<z.ZodObject<Shape>>) => {
          try {
            return await write(args);
          } finally {
            if ((args as { dryRun?: boolean }).dryRun !== true) forgetSnapshots(calm);
          }
        }
      : write;
    const config = {
      title,
      description,
      inputSchema: z.object(inputSchema),
      ...(outputSchema ? { outputSchema } : {}),
      annotations: isWrite ? { ...WRITE, destructiveHint: DESTRUCTIVE.has(name), title } : { ...READ_ONLY, title },
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
    .describe("Display id (3-17, 6-1, 8-1-2), GUID, process id (ERL-…), or a code in a title (REQ-03)");

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
      status: z.string().max(40).optional().describe('e.g. "open", "new", "done", "in testing"; test cases: "failed", "passed" (latest result)'),
      tag: z.string().max(256).optional().describe("Tasks, features, test cases"),
      projectId,
      limit: z.number().int().min(1).max(100).optional().describe("Default 30"),
      offset: z.number().int().min(0).max(5000).optional(),
    },
    (a) => find(calm, defined(a), options),
  );
  tool(
    "calm_get",
    "Get items",
    "Details of 1–10 items by id (from calm_list): description, fields (assignee, dates, scope, phase), comments, test case steps and latest results, defects and the test case they came from, a test plan's results, document content, feature transports, and every link with its id and title.",
    {
      ids: z.array(ref).min(1).max(10),
      detail: z.enum(["summary", "full"]).optional().describe("summary: fields and links, text cut to 600 characters; full (default): text up to 8000 characters per item"),
      projectId,
    },
    (a) => get(calm, defined(a), options),
    GET_OUT,
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
    "Cloud ALM analytics, refreshed daily, tenant-wide: tasks, defects, test runs, jobs, exceptions, integration messages… Without dataset: the list and the columns to group by. groupBy counts on the latest day, or per day when groupBy includes date; `status` means the dataset's status column.",
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
      "Create a manual test case with activities and steps, linked to the tasks it covers. Refuses a duplicate title. Test cases cannot be tagged through the API; deleting one needs the key's testcases.delete scope.",
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
      "Link or unlink items",
      "Link items to tasks, or with unlink: true remove the links. from = a manual test case (tests the tasks), a feature (delivers them), a document (documents them), a requirement (its user stories or project tasks go under it), or a user story or project task (with tasks = its one requirement). Skips links that exist (or, unlinking, that do not).",
      {
        from: ref.describe("Test case, feature, document, requirement, user story or project task id"),
        tasks: z.array(ref).min(1).max(20),
        unlink: z.boolean().optional().describe("true: remove these links instead"),
        projectId,
        dryRun,
      },
      (a) => link(calm, writer, defined(a) as never, w),
    );
    tool(
      "calm_tag",
      "Tag tasks",
      "Add or remove tags on requirements, user stories, defects or tasks; other tags stay. (Test cases and features cannot be tagged through the API.)",
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
        description: z.string().min(1).max(8000).optional().describe("Plain text; blank lines separate paragraphs. Leave out rather than invent one"),
        requirement: ref.optional().describe("Parent requirement of a user story or project task"),
        priority: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(40)]).optional().describe("10 very high, 20 high, 30 medium (default), 40 low"),
        assignee: z.string().min(1).max(100).optional().describe("User id of a project team member"),
        startDate: z.string().optional().describe("YYYY-MM-DD"),
        dueDate: z.string().optional().describe("YYYY-MM-DD"),
        tags: z.array(z.string().min(1).max(256)).max(20).optional(),
        projectId,
        dryRun,
      },
      (a) => createTask(calm, writer, defined(a) as never, w),
    );
    const priority = z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(40)]).describe("10 very high, 20 high, 30 medium, 40 low");
    const date = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "YYYY-MM-DD, or empty to clear");
    tool(
      "calm_update",
      "Change items",
      "Change 1–20 tasks, features or manual test cases (same changes for each). Tasks: title, description, status, priority, assignee, startDate, dueDate, timebox, obsolete. Features: title, description, status, priority. Manual test cases: title, prepared, priority, addActivity (appends an activity with steps). Only changed fields are sent; answers before → after per field. Documents cannot be changed after create.",
      {
        ids: z.array(ref).min(1).max(20),
        title: z.string().min(1).max(250).optional().describe("One item at a time"),
        description: z.string().min(1).max(8000).optional().describe("Plain text; blank lines separate paragraphs. Replaces the description"),
        status: z
          .string()
          .min(1)
          .max(40)
          .optional()
          .describe(
            "Plain words. Tasks: open, in progress, blocked, in review, done, not relevant (as the type allows); requirements also to be approved, approved, in realization, approved for deployment, rejected; defects also retest. Features: in specification, not planned, in realization, in testing, successfully tested, deployed",
          ),
        priority: priority.optional(),
        assignee: z.string().max(120).optional().describe("User id or e-mail of a project member; empty to unassign"),
        startDate: date.optional(),
        dueDate: date.optional(),
        timebox: z.string().min(1).max(120).optional().describe("Phase or sprint of the project, by name or id"),
        obsolete: z.boolean().optional(),
        prepared: z.boolean().optional().describe("Test case is ready to run"),
        addActivity: z
          .object({ title: z.string().min(1).max(250), steps: z.array(step).min(1).max(50) })
          .optional()
          .describe("Test cases: append an activity with these steps"),
        projectId,
        dryRun,
      },
      (a) => update(calm, writer, defined(a) as never, w),
    );
    tool(
      "calm_delete",
      "Delete items",
      "Delete 1–20 tasks, manual test cases or documents; cannot be undone. soft: true marks tasks obsolete instead (SAP recommends it). force: true deletes a test case with its test runs and results. Features cannot be deleted through the API; approved requirements cannot be deleted. Test cases and documents need the key's testcases.delete / documents.delete scope.",
      {
        ids: z.array(ref).min(1).max(20),
        soft: z.boolean().optional().describe("Tasks: mark obsolete instead of deleting"),
        force: z.boolean().optional().describe("Test cases: also delete their test runs and results (testcases.force-delete scope)"),
        projectId,
        dryRun,
      },
      (a) => remove(calm, writer, defined(a) as never, w),
    );
    tool(
      "calm_comment",
      "Comment on a task",
      "Add a comment to a requirement, user story, defect or other task.",
      {
        task: ref,
        text: z.string().min(1).max(8000).describe("Plain text; blank lines separate paragraphs"),
        projectId,
        dryRun,
      },
      (a) => comment(calm, writer, defined(a) as never, w),
    );
    tool(
      "calm_create_feature",
      "Create a feature",
      "Create a feature, optionally linked to the requirements or user stories it delivers. Features cannot be deleted through the API: check with the user first; refuses a duplicate title.",
      {
        title: z.string().min(1).max(600),
        description: z.string().min(1).max(8000).optional().describe("Plain text; blank lines separate paragraphs"),
        status: z.string().min(1).max(40).optional().describe("Default in specification"),
        priority: priority.optional().describe("Default 30 medium"),
        tasks: z.array(ref).max(20).optional().describe("Tasks it delivers"),
        projectId,
        dryRun,
      },
      (a) => createFeature(calm, writer, defined(a) as never, w),
    );
    tool(
      "calm_create_document",
      "Create a document",
      "Create a document with content, linked to tasks. Its title, content, status, priority and type cannot be changed through the API afterwards; refuses a duplicate title.",
      {
        title: z.string().min(1).max(250),
        content: z.string().min(1).max(50000).describe("Plain text; blank lines separate paragraphs"),
        type: z.string().min(1).max(60).optional().describe(`Code or name: ${DOCUMENT_TYPE_HELP}`),
        status: z.enum(["in progress", "in review", "released"]).optional().describe("Default in progress"),
        priority: priority.optional().describe("Default 30 medium"),
        tasks: z.array(ref).max(20).optional().describe("Tasks it documents"),
        projectId,
        dryRun,
      },
      (a) => createDocument(calm, writer, defined(a) as never, w),
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
          // Absent when the host dropped the result's _meta: then only a
          // change that may also be approved in the chat (mode prefer).
          nonce: z.string().min(16).max(64).optional(),
          decision: z.enum(["approve", "reject"]),
        } as never,
        annotations: { ...WRITE, title: "Approve" },
        _meta: { ui: { resourceUri: CARD_URI, visibility: ["app"] } },
      },
      ((a: { id: string; nonce?: string; decision: string }) => decide(a.id, a.nonce, a.decision === "approve")) as never,
    );
    if (approval === "prefer")
      /* @mcp-codemod-error Could not verify `inputSchema` is a schema object. Raw shapes are deprecated in v2 — pass a Standard Schema object (e.g. z.object({ … })); no change is needed if it already is one. */
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
  const dialog = env.CALM_APPROVAL_DIALOG?.trim().toLowerCase();
  if (dialog) {
    if (!["on", "off"].includes(dialog)) throw new Error("CALM_APPROVAL_DIALOG must be on or off.");
    options.approvalDialog = dialog === "on";
  }
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
  "calm_update",
  "calm_delete",
  "calm_comment",
  "calm_create_feature",
  "calm_create_document",
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
