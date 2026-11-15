import { afterEach, describe, expect, test } from "bun:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CARD_URI, cardHtml, clearPending, META_KEY, propose, take } from "../src/approval.js";
import { CloudAlm } from "../src/calm/index.js";
import { CloudAlmWriter } from "../src/calm/writer.js";
import { createHttpHandler } from "../src/http.js";
import { createServer, type ServerOptions, serverOptionsFromEnv } from "../src/server.js";
import { BASE_URL, TENANT } from "./tenant.js";

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

async function connect(kind: ClientKind, options: ServerOptions) {
  const fake = fakeTenant();
  const grant = { accessToken: "t", baseUrl: BASE_URL };
  const calm = new CloudAlm(grant, { fetch: fake.fetcher });
  const writer = new CloudAlmWriter(grant, { fetch: fake.fetcher });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(calm, { writer, writeMode: "on", ...options }).connect(serverSide);
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

  test("reject writes nothing", async () => {
    const { call, posts } = await connect("ui", { approval: "prefer" });
    const a = (await call("calm_create_task", NEW_DEFECT)).meta?.[META_KEY] as { id: string; nonce: string };
    const r = await call("calm_approve", { ...a, decision: "reject" });
    expect(r.text).toContain("Rejected");
    expect(posts).toEqual([]);
  });

  test("every write is a proposal, whatever the client declares; the dialog is opt-in", async () => {
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

  test("with the dialog on, a dialog client is asked, and an accept writes", async () => {
    const { call, posts, prompts } = await connect("elicit-accept", { approval: "required", approvalDialog: true });
    const r = await call("calm_create_task", NEW_DEFECT);
    expect(prompts[0]).toContain("Credit check skipped");
    expect(r.error).toBe(false);
    expect(posts).toEqual(["calm-tasks/v1/tasks"]);
  });

  test("a declined dialog writes nothing and keeps the proposal (some clients decline unseen)", async () => {
    const { call, posts } = await connect("elicit-decline", { approval: "prefer", approvalDialog: true });
    const r = await call("calm_create_task", NEW_DEFECT);
    expect(posts).toEqual([]);
    const id = /calm_confirm with id "([0-9a-f]{12})"/.exec(r.text)?.[1];
    expect((await call("calm_confirm", { id })).error).toBe(false);
    expect(posts).toEqual(["calm-tasks/v1/tasks"]);
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
    const id = /calm_confirm with id "([0-9a-f]{12})"/.exec(r.text)?.[1];
    expect(id).toBeDefined();
    expect(posts).toEqual([]);
    expect((await call("calm_confirm", { id })).error).toBe(false);
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
    const rpc = async (token: string, name: string, args: Record<string, unknown>) => {
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
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
    const owner = await rpc("token-a", "calm_approve", { ...a, decision: "approve" });
    expect(owner.isError).toBeFalsy();
    expect(fake.posts).toEqual(["calm-tasks/v1/tasks"]);
  });
});

describe("pending store", () => {
  const entry = { tool: "calm_tag", args: {}, preview: "p", subject: "s", allowChat: false };

  test("expires, is single use, and belongs to its subject", () => {
    const p = propose(entry, 0);
    expect(() => take(p.id, "other", p.nonce, 1)).toThrow("another session");
    expect(() => take(p.id, "s", p.nonce, 61 * 60_000)).toThrow("expired");
    const late = propose(entry, 0);
    expect(take(late.id, "s", late.nonce, 50 * 60_000).tool).toBe("calm_tag");
    const q = propose(entry, 0);
    expect(() => take(q.id, "s", undefined, 1)).toThrow("approval card");
    expect(take(q.id, "s", q.nonce, 1).tool).toBe("calm_tag");
    expect(() => take(q.id, "s", q.nonce, 1)).toThrow("unknown");
  });

  test("CALM_APPROVAL defaults to prefer when writing is on", () => {
    expect(serverOptionsFromEnv({ CALM_WRITE: "on" }).approval).toBe("prefer");
    expect(serverOptionsFromEnv({ CALM_WRITE: "on", CALM_APPROVAL: "off" }).approval).toBe("off");
    expect(serverOptionsFromEnv({}).approval).toBeUndefined();
    expect(serverOptionsFromEnv({ CALM_WRITE: "on" }).approvalDialog).toBeUndefined();
    expect(serverOptionsFromEnv({ CALM_APPROVAL_DIALOG: "on" }).approvalDialog).toBe(true);
    expect(() => serverOptionsFromEnv({ CALM_APPROVAL_DIALOG: "yes" })).toThrow("CALM_APPROVAL_DIALOG");
    expect(() => serverOptionsFromEnv({ CALM_APPROVAL: "maybe" })).toThrow("CALM_APPROVAL");
  });

  test("the card renders text, never HTML from the preview", () => {
    expect(cardHtml()).toContain('$("p").textContent = a.preview');
    expect(cardHtml()).not.toContain("innerHTML = a.");
    expect(cardHtml()).toContain("This approval expired");
  });
});

test("a change that changes nothing asks for no approval", async () => {
  const { call } = await connect("plain", { approval: "prefer" });
  const r = await call("calm_update", { ids: ["3-3"], priority: 20 });
  expect(r.text).toStartWith("Nothing to do:");
  expect(r.meta?.[META_KEY]).toBeUndefined();
});
