import { afterEach, describe, expect, test } from "bun:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CARD_TEMPLATE } from "../src/approval-card.js";
import { approvalFromEnv, CARD_URI, cardHtml, CHAT_HOLD_MS, clearPending, META_KEY, propose, settle, statusOf, take } from "../src/approval.js";
import { CloudAlm } from "../src/calm/index.js";
import { CloudAlmWriter } from "../src/calm/writer.js";
import { createHttpHandler } from "../src/http.js";
import { createServer, type ServerOptions } from "../src/server.js";
import { BASE_URL, REQ, US2, fakeWritableTenant, TENANT } from "./tenant.js";

/** The fake tenant; POSTs are recorded and answered like Cloud ALM. */
function fakeTenant() {
  const posts: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/api\//, "");
    if (init?.method === "POST") {
      posts.push(path);
      return Response.json({ id: "cccccccc-0000-4000-8000-000000000099", displayId: "3-99" }, { status: 201 });
    }
    if (path === "calm-processmanagement/v1/scopes") return Response.json([]);
    const body = TENANT[path];
    return body === undefined ? Response.json({ message: "Not Found" }, { status: 404 }) : Response.json(body);
  }) as typeof fetch;
  return { fetcher, posts };
}

type ClientKind = "plain" | "ui" | "elicit-accept" | "elicit-decline";

async function connect(kind: ClientKind, options: ServerOptions, fake = fakeTenant()) {
  const grant = { accessToken: "t", baseUrl: BASE_URL };
  const calm = new CloudAlm(grant, { fetch: fake.fetcher });
  const writer = new CloudAlmWriter(grant, { fetch: fake.fetcher });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(calm, { writer, writeMode: "on", chatHoldMs: 0, ...options }).connect(serverSide);
  const capabilities =
    kind === "ui"
      ? { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] } } }
      : kind.startsWith("elicit")
        ? { elicitation: { form: {} } }
        : {};
  const client = new Client({ name: "test", version: "0" }, { capabilities: capabilities as never });
  const prompts: string[] = [];
  if (kind.startsWith("elicit"))
    client.setRequestHandler('elicitation/create', async (request) => {
      prompts.push(String(request.params.message));
      return kind === "elicit-accept" ? { action: "accept", content: { approve: true } } : { action: "decline" };
    });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
      _meta?: Record<string, unknown>;
    };
    return { error: !!r.isError, text: r.content[0]?.text ?? "", meta: r._meta, structured: (r as { structuredContent?: { approval?: Record<string, unknown> } }).structuredContent };
  };
  return { client, call, posts: fake.posts, prompts };
}

const NEW_DEFECT = { type: "defect", title: "Credit check skipped", description: "Steps to reproduce." };

afterEach(() => clearPending());

describe("approval of writes", () => {
  test("a card client gets a pending write; the card's approve runs it once", async () => {
    const { call, client, posts } = await connect("ui", { approval: "prefer" });
    const tools = await client.listTools();
    const create = tools.tools.find((t) => t.name === "calm_create_task");
    expect((create?._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe(CARD_URI);
    const r = await call("calm_create_task", NEW_DEFECT);
    expect(r.text).toContain("Approval needed");
    expect(r.text).toContain("Credit check skipped");
    expect(posts).toEqual([]);
    const a = r.meta?.[META_KEY] as { id: string; nonce: string; title: string };
    // The model-visible text never carries the nonce.
    expect(r.text).not.toContain(a.nonce);
    // The agent cannot approve a card write by itself.
    const forged = await call("calm_approve", { id: a.id, nonce: "A".repeat(22), decision: "approve" });
    expect(forged.error).toBe(true);
    expect(posts).toEqual([]);
  });

  test("the card's approve writes; a second approve is refused", async () => {
    const { call, posts } = await connect("ui", { approval: "required" });
    const r = await call("calm_create_task", NEW_DEFECT);
    const a = r.meta?.[META_KEY] as { id: string; nonce: string };
    const ok = await call("calm_approve", { ...a, decision: "approve" });
    expect(ok.error).toBe(false);
    expect(posts).toEqual(["calm-tasks/v1/tasks"]);
    const again = await call("calm_approve", { ...a, decision: "approve" });
    expect(again.error).toBe(true);
    expect(posts.length).toBe(1);
  });

  test("a card drawn again learns how its proposal ended; a second approval is told the outcome", async () => {
    const { call, posts } = await connect("ui", { approval: "required" });
    const status = async (id: string) => ((await call("calm_approval_status", { id })).structured as unknown as { status: string; summary?: string });
    const r = await call("calm_create_task", NEW_DEFECT);
    const a = r.meta?.[META_KEY] as { id: string; nonce: string };
    expect((await status(a.id)).status).toBe("pending");
    expect((await status("0".repeat(12))).status).toBe("unknown");
    const ok = await call("calm_approve", { ...a, decision: "approve" });
    const after = await status(a.id);
    expect(after.status).toBe("approved");
    expect(after.summary).toBe(ok.text);
    // Not "nothing was written": it was.
    const again = await call("calm_approve", { ...a, decision: "approve" });
    expect(again.error).toBe(true);
    expect(again.text).toContain("already approved");
    expect(again.text).not.toContain("nothing was written");
    expect(posts.length).toBe(1);

    const second = (await call("calm_create_task", NEW_DEFECT)).meta?.[META_KEY] as { id: string; nonce: string };
    await call("calm_approve", { ...second, decision: "reject" });
    expect((await status(second.id)).status).toBe("rejected");
    expect((await call("calm_approve", { ...second, decision: "approve" })).text).toContain("already rejected");
    expect(posts.length).toBe(1);
  });

  test("the outcome of a proposal is its approver's only", () => {
    const p = propose({ tool: "calm_tag", args: {}, fingerprint: "p", subject: "s", allowChat: false }, 0);
    take(p.id, "s", p.nonce, 1);
    settle(p.id, "approved", "Tagged.");
    expect(statusOf(p.id, "s", 2)).toEqual({ status: "approved", summary: "Tagged." });
    expect(statusOf(p.id, "other", 2)).toEqual({ status: "unknown" });
    expect(statusOf(p.id, "s", 61 * 60_000)).toEqual({ status: "unknown" });
  });

  test("confirmation checks the full source value and only resolves the update once", async () => {
    const tenant = fakeWritableTenant();
    const path = `calm-tasks/v1/tasks/${REQ}`;
    const prefix = "same visible description ".repeat(8);
    const changeDescription = (description: string) => tenant.fetcher(`${BASE_URL}/${path}`, {
      method: "PATCH", body: JSON.stringify({ description }),
    });
    let reads = 0;
    const fetcher = (async (input, init) => {
      if (init?.method === "GET" && new URL(String(input)).pathname.endsWith(path)) reads++;
      return tenant.fetcher(input, init);
    }) as typeof fetch;
    const { call } = await connect("plain", { approval: "prefer" }, { fetcher, posts: [] });
    await changeDescription(prefix + "first ending");
    const args = { ids: ["3-1"], description: "Approved replacement" };
    const proposeUpdate = async () => (await call("calm_update", args)).meta?.[META_KEY] as { id: string };
    const first = await proposeUpdate();
    await changeDescription(prefix + "colleague's edit");
    const writesBefore = tenant.writes.length;
    const rejected = await call("calm_confirm", { id: first.id, tool: "calm_update" });
    expect(rejected.error).toBe(true);
    expect(rejected.text).toContain("no longer matches");
    expect(tenant.writes.length).toBe(writesBefore);

    const second = await proposeUpdate();
    reads = 0;
    const accepted = await call("calm_confirm", { id: second.id, tool: "calm_update" });
    expect(accepted.error).toBe(false);
    expect(reads).toBe(2); // One read to plan and check, one to verify the actual PATCH.
    expect(tenant.writes.at(-1)?.body).toEqual({ description: "<p>Approved replacement</p>" });
  });

  test("a stale later item in a tag batch refuses the whole approval", async () => {
    const tenant = fakeWritableTenant();
    const { call } = await connect("plain", { approval: "prefer" }, { fetcher: tenant.fetcher, posts: [] });
    const result = await call("calm_tag", { tasks: ["3-1", "3-3"], add: ["Review"] });
    const proposal = result.meta?.[META_KEY] as { id: string };
    await tenant.fetcher(`${BASE_URL}/calm-tasks/v1/tasks/updateTags`, {
      method: "POST", body: JSON.stringify({ taskId: US2, tags: ["Changed"] }),
    });
    const writesBefore = tenant.writes.length;
    const refused = await call("calm_confirm", { id: proposal.id, tool: "calm_tag" });
    expect(refused.error).toBe(true);
    expect(tenant.writes.length).toBe(writesBefore);
  });

  test("reject writes nothing", async () => {
    const { call, posts } = await connect("ui", { approval: "prefer" });
    const a = (await call("calm_create_task", NEW_DEFECT)).meta?.[META_KEY] as { id: string; nonce: string };
    const r = await call("calm_approve", { ...a, decision: "reject" });
    expect(r.text).toContain("Rejected");
    expect(posts).toEqual([]);
  });

  test("every write is a proposal, whatever the client declares; no dialog is sent", async () => {
    const { call, posts, prompts } = await connect("elicit-accept", { approval: "prefer" });
    const r = await call("calm_create_task", NEW_DEFECT);
    expect(prompts).toEqual([]);
    expect(posts).toEqual([]);
    const a = r.meta?.[META_KEY] as { id: string; nonce: string };
    expect(a.nonce).toBeDefined();
    // structuredContent carries the id for hosts that drop _meta, never the nonce.
    expect(r.structured?.approval?.id).toBe(a.id);
    expect(JSON.stringify(r.structured)).not.toContain(a.nonce);
    // Hosts that show the model only structuredContent still pass on the ask.
    expect(r.structured?.approval?.next).toContain("calm_confirm");
    expect(r.structured?.approval?.title).toBe("Create a defect");
    expect(r.text).toMatch(/valid until \d\d:\d\d UTC/);
  });

  test("a card whose host dropped the nonce approves by id in prefer, not in required", async () => {
    const prefer = await connect("ui", { approval: "prefer" });
    const a = (await prefer.call("calm_create_task", NEW_DEFECT)).structured?.approval as { id: string };
    expect((await prefer.call("calm_approve", { id: a.id, decision: "approve" })).error).toBe(false);
    expect(prefer.posts).toEqual(["calm-tasks/v1/tasks"]);
    clearPending();
    const required = await connect("ui", { approval: "required" });
    const b = (await required.call("calm_create_task", NEW_DEFECT)).structured?.approval as { id: string };
    const refused = await required.call("calm_approve", { id: b.id, decision: "approve" });
    expect(refused.error).toBe(true);
    expect(required.posts).toEqual([]);
  });

  test("prefer, with neither card nor dialog: the agent asks in chat and confirms by id", async () => {
    const { call, posts } = await connect("plain", { approval: "prefer" });
    const r = await call("calm_create_task", NEW_DEFECT);
    const id = /calm_confirm with id "([0-9a-f]{12})" and tool "calm_create_task"/.exec(r.text)?.[1];
    expect(id).toBeDefined();
    expect(posts).toEqual([]);
    // The tool named must be the one that proposed it.
    expect((await call("calm_confirm", { id, tool: "calm_delete" })).error).toBe(true);
    expect(posts).toEqual([]);
    const again = /calm_confirm with id "([0-9a-f]{12})"/.exec((await call("calm_create_task", NEW_DEFECT)).text)?.[1];
    expect((await call("calm_confirm", { id: again, tool: "calm_create_task" })).error).toBe(false);
    expect(posts).toEqual(["calm-tasks/v1/tasks"]);
  });

  test("required: only the card approves; no calm_confirm", async () => {
    const { call, client, posts } = await connect("plain", { approval: "required" });
    const r = await call("calm_create_task", NEW_DEFECT);
    expect(r.error).toBe(false);
    expect(r.text).toContain("does not accept approval in the chat");
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("calm_confirm");
    expect(posts).toEqual([]);
    const a = r.meta?.[META_KEY] as { id: string; nonce: string };
    expect((await call("calm_approve", { ...a, decision: "approve" })).error).toBe(false);
    expect(posts).toEqual(["calm-tasks/v1/tasks"]);
  });

  test("dryRun previews without approval; approval off writes at once", async () => {
    const preview = await connect("plain", { approval: "required" });
    expect((await preview.call("calm_create_task", { ...NEW_DEFECT, dryRun: true })).text).toContain("Dry run");
    const off = await connect("plain", { approval: "off" });
    await off.call("calm_create_task", NEW_DEFECT);
    expect(off.posts).toEqual(["calm-tasks/v1/tasks"]);
    expect((await off.client.listTools()).tools.map((t) => t.name)).not.toContain("calm_approve");
  });

  test("the card resource is served as an MCP App", async () => {
    const { client } = await connect("ui", { approval: "prefer" });
    const r = await client.readResource({ uri: CARD_URI });
    const c = r.contents[0] as { mimeType: string; text: string };
    expect(c.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(c.text).toContain("calm_approve");
    expect(c.text).not.toMatch(/^export\s*\{/m);
  });
});

describe("approval over stateless HTTP", () => {
  test("the card's approve arrives in a later request, from the same token only", async () => {
    const fake = fakeTenant();
    const handler = createHttpHandler({
      baseUrl: BASE_URL,
      reader: { fetch: fake.fetcher },
      server: { writeMode: "on", approval: "required" },
    });
    let n = 0;
    const rpc = async (token: string, name: string, args: Record<string, unknown>, baseUrl = BASE_URL) => {
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-calm-api-url": baseUrl,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }),
        }),
      );
      return ((await response.json()) as { result: { isError?: boolean; content: { text: string }[]; _meta?: Record<string, unknown> } }).result;
    };
    const proposed = await rpc("token-a", "calm_create_task", NEW_DEFECT);
    const a = proposed._meta?.[META_KEY] as { id: string; nonce: string };
    expect(a.nonce).toBeDefined();
    expect(fake.posts).toEqual([]);
    const stranger = await rpc("token-b", "calm_approve", { ...a, decision: "approve" });
    expect(stranger.isError).toBe(true);
    expect(fake.posts).toEqual([]);
    const otherApi = await rpc("token-a", "calm_approve", { ...a, decision: "approve" }, "https://other.alm.cloud.sap/api");
    expect(otherApi.isError).toBe(true);
    expect(fake.posts).toEqual([]);
    const owner = await rpc("token-a", "calm_approve", { ...a, decision: "approve" });
    expect(owner.isError).toBeFalsy();
    expect(fake.posts).toEqual(["calm-tasks/v1/tasks"]);
  });
});

describe("pending store", () => {
  const entry = { tool: "calm_tag", args: {}, fingerprint: "p", subject: "s", allowChat: false };

  test("expires, is single use, and belongs to its subject", () => {
    const p = propose(entry, 0);
    expect(() => take(p.id, "other", p.nonce, 1)).toThrow("another session");
    expect(() => take(p.id, "s", p.nonce, 61 * 60_000)).toThrow("expired");
    const late = propose(entry, 0);
    expect(take(late.id, "s", late.nonce, 50 * 60_000).tool).toBe("calm_tag");
    const q = propose(entry, 0);
    expect(() => take(q.id, "s", undefined, 1)).toThrow("approval card");
    expect(take(q.id, "s", q.nonce, 1).tool).toBe("calm_tag");
    expect(() => take(q.id, "s", q.nonce, 1)).toThrow("already approved");
  });


  test("a proposal names items by kind and title: no ids, no tenant, no parameter names", async () => {
    const tenant = fakeWritableTenant();
    const { call } = await connect("ui", { approval: "prefer", webUrl: "https://acme.eu10.alm.cloud.sap" }, { fetcher: tenant.fetcher, posts: [] });
    const r = await call("calm_delete", { ids: [US2] });
    const approval = r.structured?.approval as { title: string; preview: string; change: { tenant?: string; items: { id: string; note?: string }[]; warnings?: string[] } };
    expect(approval.title).toBe("Delete user story");
    const forPeople = [r.text.split("\n\n").slice(1).join("\n"), approval.preview, approval.change.items[0]?.note, ...(approval.change.warnings ?? [])].join("\n");
    expect(forPeople).toContain("delete user story");
    expect(forPeople).not.toMatch(/\b3-\d+\b|soft: true|alm\.cloud\.sap/);
    expect(approval.change.tenant).toBeUndefined();
    // The card's own data still knows which item it is.
    expect(approval.change.items[0]?.id).toMatch(/^3-\d+$/);
  });

  test("the card renders text, never HTML from the preview", () => {
    const html = cardHtml();
    expect(html).toContain('$("p").textContent = text');
    expect(html).not.toContain("innerHTML");
    expect(html).toContain("This approval expired");
    // The bundle and the theme helpers are in; no marker is left.
    expect(html).not.toContain("__APP_BUNDLE__");
    expect(html).not.toContain("__META_KEY__");
    expect(html).toContain("const applyDocumentTheme = ");
    // The whole change is on the page: no scroll box inside the card, and no escapes shown as typed.
    expect(CARD_TEMPLATE).not.toMatch(/max-height|overflow:auto/);
    expect(html).toContain("Preparing the change…");
    // For consultants: no request id, no tool name on the card.
    expect(CARD_TEMPLATE).not.toMatch(/Request details|"Tool"|"Request"/);
  });
});

test("a change that changes nothing asks for no approval", async () => {
  const { call } = await connect("plain", { approval: "prefer" });
  const r = await call("calm_update", { ids: ["3-3"], priority: 20 });
  expect(r.text).toStartWith("Nothing to do:");
  expect(r.meta?.[META_KEY]).toBeUndefined();
});


test("a proposal carries the change field by field for the card", async () => {
  const { call } = await connect("ui", { approval: "prefer" });
  const r = await call("calm_create_task", { ...NEW_DEFECT, priority: 20 });
  const change = (r.structured?.approval as { change?: { kind: string; items: { title?: string; fields?: { field: string; after?: string }[] }[] } })?.change;
  expect(change?.kind).toBe("create");
  expect(change?.items[0]?.title).toBe("Credit check skipped");
  expect(change?.items[0]?.fields?.find((f) => f.field === "Priority")?.after).toBe("high");
  expect((r.meta?.[META_KEY] as { change?: unknown }).change).toEqual(change);
});

test("once a card that can approve is on screen, a yes passed on in the chat is refused", async () => {
  const { call, posts } = await connect("ui", { approval: "prefer" });
  const r = await call("calm_create_task", NEW_DEFECT);
  const a = r.meta?.[META_KEY] as { id: string; nonce: string };
  // A card whose host dropped the nonce cannot approve by it: the chat stays open.
  await call("calm_approval_status", { id: a.id });
  await call("calm_approval_status", { id: a.id, nonce: "A".repeat(22) });
  expect(statusOf(a.id, "local").status).toBe("pending");
  // The real card says it is there.
  expect((await call("calm_approval_status", { id: a.id, nonce: a.nonce })).text).toBe("pending");
  const byAgent = await call("calm_confirm", { id: a.id, tool: "calm_create_task" });
  expect(byAgent.error).toBe(true);
  expect(byAgent.text).toContain("can only be approved in the approval card");
  expect(byAgent.text).toContain("Do not confirm it for them");
  expect(posts.length).toBe(0);
  // The refusal used nothing up: the card still approves.
  expect((await call("calm_approve", { id: a.id, nonce: a.nonce, decision: "approve" })).error).toBe(false);
  expect(posts.length).toBe(1);

  const other = await call("calm_create_task", { ...NEW_DEFECT, title: "No card here" });
  const b = other.meta?.[META_KEY] as { id: string };
  expect(other.text).toContain("do not call calm_confirm (it is refused once the card is on their screen)");
  expect((await call("calm_confirm", { id: b.id, tool: "calm_create_task" })).error).toBe(false);
});

test("link, tag, test case, feature and document carry their change for the card; a dry run does too, without ids", async () => {
  const { call } = await connect("ui", { approval: "prefer" });
  type Shown = { kind: string; items: { id?: string; type?: string; title?: string; note?: string; fields?: { field: string; before?: string; after?: string }[] }[]; warnings?: string[] };
  const proposed = async (name: string, args: Record<string, unknown>) =>
    ((await call(name, args)).meta?.[META_KEY] as { change?: Shown } | undefined)?.change;
  const tag = await proposed("calm_tag", { tasks: ["3-1"], add: ["Review"] });
  expect(tag?.items[0]?.fields?.[0]).toMatchObject({ field: "Tags" });
  expect(tag?.items[0]?.fields?.[0]?.after).toContain("Review");
  const feature = await proposed("calm_create_feature", { title: "Credit limit release", tasks: ["3-1"] });
  expect(feature).toMatchObject({ kind: "create", items: [{ type: "feature", title: "Credit limit release" }] });
  expect(feature?.warnings?.[0]).toBe("A feature cannot be deleted once it is created");
  expect(JSON.stringify(feature)).not.toContain("3-1");
  const document = await proposed("calm_create_document", { title: "Workshop minutes", content: "Decisions of the day.", tasks: ["3-1"] });
  expect(document?.items[0]?.fields?.map((f) => f.field)).toEqual(["Type", "Status", "Priority", "Linked to", "Content"]);

  const dry = (await call("calm_tag", { tasks: ["3-1"], add: ["Review"], dryRun: true })) as unknown as { structured?: { change?: Shown }; meta?: Record<string, unknown> };
  expect(dry.structured?.change?.items[0]?.fields?.[0]?.field).toBe("Tags");
  expect(dry.meta?.[META_KEY]).toBeUndefined();
  const dryDelete = (await call("calm_delete", { ids: ["3-3"], dryRun: true })) as unknown as { structured?: { change?: Shown } };
  expect(dryDelete.structured?.change?.items[0]?.note ?? "").not.toMatch(/\b3-3\b/);
});

test("the card draws a dry run as a preview, field by field", () => {
  const html = cardHtml();
  expect(html).toContain("A preview only. Nothing was sent to Cloud ALM.");
  expect(html).toContain("Nothing sent");
  expect(CARD_URI).toBe("ui://cloud-alm/approve-v4.html");
});

test("calm_overview carries the overview card", async () => {
  const { client } = await connect("ui", { approval: "prefer" });
  const tool = (await client.listTools()).tools.find((t) => t.name === "calm_overview");
  const uri = (tool?._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri;
  expect(uri).toBe("ui://cloud-alm/overview-v2.html");
  const r = await client.readResource({ uri: uri as string });
  const html = (r.contents[0] as { text: string }).text;
  expect(html).not.toContain("__APP_BUNDLE__");
  expect(html).not.toContain("innerHTML");
});

test("a yes in the chat is not taken right after the proposal, so a card gets there first", async () => {
  // The default hold, as shipped.
  const { call, posts } = await connect("plain", { approval: "prefer", chatHoldMs: CHAT_HOLD_MS });
  const r = await call("calm_create_task", NEW_DEFECT);
  const id = (r.structured?.approval as { id: string }).id;
  expect(r.text).toContain("End your turn now");
  const early = await call("calm_confirm", { id, tool: "calm_create_task" });
  expect(early.error).toBe(true);
  expect(early.text).toContain("Too early; nothing was written");
  // A card without its nonce is the chat by another name: held too.
  expect((await call("calm_approve", { id, decision: "approve" })).text).toContain("Too early");
  expect(posts).toEqual([]);
  // A rejection is never held: it writes nothing and closes the proposal for the chat too.
  const other = (await call("calm_create_task", { ...NEW_DEFECT, title: "Rejected at once" })).structured?.approval as { id: string };
  expect((await call("calm_approve", { id: other.id, decision: "reject" })).text).toContain("Rejected by the user");
  expect(statusOf(other.id, "local").status).toBe("rejected");
  // The refusal used nothing up.
  expect(statusOf(id, "local").status).toBe("pending");

  const now = Date.now();
  const p = propose({ tool: "calm_update", args: {}, fingerprint: "f", subject: "s", allowChat: true }, now);
  expect(() => take(p.id, "s", undefined, now + CHAT_HOLD_MS - 1, "calm_update")).toThrow("Too early");
  // The card is never held.
  const q = propose({ tool: "calm_update", args: {}, fingerprint: "f", subject: "s", allowChat: true }, now);
  expect(take(q.id, "s", q.nonce, now, "calm_update").tool).toBe("calm_update");
  expect(take(p.id, "s", undefined, now + CHAT_HOLD_MS, "calm_update").tool).toBe("calm_update");
});

test("CALM_APPROVAL=card accepts the card only; unset or chat also the chat", () => {
  expect(approvalFromEnv({})).toBe("prefer");
  expect(approvalFromEnv({ CALM_APPROVAL: " Chat " })).toBe("prefer");
  expect(approvalFromEnv({ CALM_APPROVAL: "card" })).toBe("required");
  expect(() => approvalFromEnv({ CALM_APPROVAL: "off" })).toThrow('CALM_APPROVAL must be "card" or "chat"');
});

test("the card gets long text whole; the assistant gets its start and how much more there is", async () => {
  const { call } = await connect("ui", { approval: "prefer" });
  const description = `${"Credit exposure must include open deliveries. ".repeat(60)}LAST WORDS`;
  const content = `${"Decided in the workshop. ".repeat(400)}LAST WORDS`;
  const r = await call("calm_create_task", { ...NEW_DEFECT, description });
  type Shown = { items: { fields: { field: string; after: string }[] }[] };
  const inCard = (r.meta?.[META_KEY] as { change: Shown }).change.items[0]?.fields.find((f) => f.field === "Description")?.after;
  expect(inCard).toBe(description);
  const forModel = (r.structured?.approval as { change: Shown }).change.items[0]?.fields.find((f) => f.field === "Description")?.after ?? "";
  expect(forModel).toBe(description);
  // The words for the chat say how much was left out, instead of ending in a bare ellipsis.
  expect(r.text).toContain(`(+${description.length - 600} more characters; the whole text is written)`);
  expect(r.text).not.toContain("LAST WORDS");
  // Past a few thousand characters the assistant's copy is shortened; the card's never is.
  const doc = await call("calm_create_document", { title: "Credit decisions", content });
  const field = (c: Shown) => c.items[0]?.fields.find((f) => f.field === "Content")?.after ?? "";
  expect(field((doc.meta?.[META_KEY] as { change: Shown }).change)).toBe(content);
  expect(field((doc.structured?.approval as { change: Shown }).change)).toContain(`(+${content.length - 4000} more characters; the whole text is written)`);
});

test("a link or a tag keeps its own title; only an update or a delete is named after its item", async () => {
  const { call } = await connect("ui", { approval: "prefer" });
  const title = async (name: string, args: Record<string, unknown>) => ((await call(name, args)).structured?.approval as { title: string }).title;
  expect(await title("calm_tag", { tasks: ["3-1"], add: ["Review"] })).not.toStartWith("Change ");
  expect(await title("calm_update", { ids: ["3-3"], dueDate: "2026-12-01" })).toBe("Change user story");
});
