/**
 * The approval card's own script, run in a DOM with a stand-in for the
 * host: what the user sees and can press for each answer the server gives.
 */
import { describe, expect, test } from "bun:test";
import { Window, type HTMLElement } from "happy-dom";
import { createHash } from "node:crypto";
import { CARD_TEMPLATE } from "../src/approval-card.js";
import { CARD_URI, CARD_URIS_BEFORE, META_KEY, OVERVIEW_URI, OVERVIEW_URIS_BEFORE, appBundle, cardHtml, overviewHtml } from "../src/approval.js";
import { CONTENT_URI, CONTENT_URIS_BEFORE, contentHtml } from "../src/content-app.js";

type Call = { name: string; arguments: Record<string, unknown> };
type Result = Record<string, unknown>;

/** Draw the card; `serverTools: false` is a host that cannot pass on the card's calls. */
async function card(options: { serverTools?: boolean; answer?: (call: Call) => Result } = {}) {
  const html = CARD_TEMPLATE.replace("/*__APP_BUNDLE__*/", "").replace("__META_KEY__", META_KEY).replace("<!--sap-logo-->", "");
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  const window = new Window();
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/, ""));
  const calls: Call[] = [];
  const context: string[] = [];
  let app: { ontoolresult?: (result: Result) => void } = {};
  class App {
    constructor() { app = this as never; }
    connect = async () => {};
    getHostContext = () => ({});
    getHostCapabilities = () => (options.serverTools === false ? {} : { serverTools: {} });
    callServerTool = async (call: Call) => {
      calls.push(call);
      return options.answer?.(call) ?? { content: [{ type: "text", text: "pending" }], structuredContent: { status: "pending" } };
    };
    updateModelContext = async (update: { content: { text: string }[] }) => void context.push(update.content[0]?.text ?? "");
  }
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction("document", "App", "applyDocumentTheme", "applyHostStyleVariables", script)(window.document, App, () => {}, () => {});
  const $ = (id: string) => window.document.getElementById(id) as unknown as { textContent: string; hidden: boolean; disabled: boolean; click(): void; dataset: Record<string, string> };
  const settle = () => new Promise((r) => setTimeout(r, 5));
  return { $, calls, context, show: async (result: Result) => { app.ontoolresult?.(result); await settle(); }, settle, text: () => window.document.body.textContent ?? "" };
}

const change = {
  kind: "update",
  project: { id: "p", name: "Rollout Example" },
  items: [{ id: "3-3", type: "user story", title: "Credit exposure shown", op: "update", fields: [{ field: "Description", before: "Old", after: `${"A long description. ".repeat(200)}THE END` }] }],
};
const proposal = (extra: Record<string, unknown> = {}, meta = true) => {
  const approval = { id: "0123456789ab", tool: "calm_update", title: "Change user story", preview: "the preview", change, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), chat: true, ...extra };
  return {
    content: [{ type: "text", text: "Approval needed" }],
    structuredContent: { approval },
    ...(meta ? { _meta: { [META_KEY]: { ...approval, nonce: "N".repeat(22) } } } : {}),
  };
};

describe("the approval card", () => {
  test("shows the whole change, tells the server it is on screen, and approves with its token", async () => {
    const c = await card({ answer: (call) => (call.name === "calm_approve" ? { content: [{ type: "text", text: "Changed 3-3." }] } : { content: [], structuredContent: { status: "pending" } }) });
    await c.show(proposal());
    expect(c.$("t").textContent).toBe("Change user story");
    expect(c.$("card").dataset.state).toBe("waiting");
    // Nothing of a long value is left out.
    expect(c.text()).toContain("THE END");
    expect(c.text()).toContain("Rollout Example");
    // The status call carries the token: from here the chat cannot approve.
    expect(c.calls[0]).toEqual({ name: "calm_approval_status", arguments: { id: "0123456789ab", nonce: "N".repeat(22) } });
    expect(c.$("ok").disabled).toBe(false);
    c.$("ok").click();
    await c.settle();
    expect(c.calls[1]).toEqual({ name: "calm_approve", arguments: { id: "0123456789ab", decision: "approve", nonce: "N".repeat(22) } });
    expect(c.$("card").dataset.state).toBe("approved");
    expect(c.$("ok").disabled).toBe(true);
    expect(c.context[0]).toContain("the user chose approve");
  });

  test("a partial write shows each item both on approval and on reopening", async () => {
    const outcome = { status: "partial", items: [
      { item: '3-3 "Credit exposure shown"', status: "written", detail: "Priority changed." },
      { item: "3-4", status: "failed", detail: "Missing permission." },
    ] };
    const receipt = { content: [{ type: "text", text: "One of two completed." }], structuredContent: { outcome } };
    const first = await card({ answer: c => c.name === "calm_approve" ? receipt : { structuredContent: { status: "pending" } } });
    await first.show(proposal());
    first.$("ok").click();
    await first.settle();
    const replay = await card({ answer: () => ({ structuredContent: { status: "partial", outcome } }) });
    await replay.show(proposal());
    for (const view of [first, replay]) {
      expect(view.$("card").dataset.state).toBe("partial");
      expect(view.$("ok").disabled).toBe(true);
      expect(view.$("m").textContent).toContain("Written — 3-3");
      expect(view.$("m").textContent).toContain("Failed — 3-4");
      expect(view.$("m").textContent).toContain("Missing permission.");
    }
  });

  test("reject writes nothing and says so", async () => {
    const c = await card({ answer: (call) => (call.name === "calm_approve" ? { content: [{ type: "text", text: "Rejected by the user; nothing was written." }] } : { content: [], structuredContent: { status: "pending" } }) });
    await c.show(proposal());
    c.$("no").click();
    await c.settle();
    expect(c.calls[1]?.arguments.decision).toBe("reject");
    expect(c.$("card").dataset.state).toBe("rejected");
    expect(c.$("x").textContent).toContain("Nothing was written.");
  });

  test("in an app that cannot pass on its calls, it offers no buttons and points to the chat, without claiming the change", async () => {
    const c = await card({ serverTools: false });
    await c.show(proposal());
    expect(c.$("card").dataset.state).toBe("chat");
    expect(c.$("m").textContent).toContain("reply “yes” in the chat");
    expect(c.$("ok").disabled).toBe(true);
    expect(c.calls).toEqual([]);
    // Card only: then it says the change cannot be approved here.
    const strict = await card({ serverTools: false });
    await strict.show(proposal({ chat: false }));
    expect(strict.$("card").dataset.state).toBe("blocked");
  });

  test("drawn again after the decision, it shows the outcome instead of live buttons", async () => {
    const c = await card({ answer: () => ({ content: [], structuredContent: { status: "approved" } }) });
    await c.show(proposal());
    expect(c.$("card").dataset.state).toBe("approved");
    expect(c.$("ok").disabled).toBe(true);
  });

  test("held for a moment after the proposal, it keeps its buttons and says to try again", async () => {
    let held = true;
    const c = await card({ answer: (call) => call.name !== "calm_approve" ? { content: [], structuredContent: { status: "pending" } }
      : held ? { isError: true, content: [{ type: "text", text: "Too early; nothing was written. Confirm only after their own message says yes." }] }
      : { content: [{ type: "text", text: "Changed 3-3." }] } });
    await c.show(proposal({}, false));
    c.$("ok").click();
    await c.settle();
    expect(c.$("card").dataset.state).toBe("waiting");
    expect(c.$("m").textContent).toBe("Not yet. Try again in a few seconds.");
    expect(c.$("ok").disabled).toBe(false);
    held = false;
    c.$("ok").click();
    await c.settle();
    expect(c.$("card").dataset.state).toBe("approved");
  });

  test("an expired proposal has no live buttons", async () => {
    const c = await card();
    await c.show(proposal({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(c.$("card").dataset.state).toBe("expired");
    expect(c.$("ok").disabled).toBe(true);
  });

  test("a dry run is a preview: no buttons, no delete warning, and a line saying nothing was sent", async () => {
    const c = await card();
    await c.show({ content: [{ type: "text", text: "Dry run, nothing sent." }], structuredContent: { change: { ...change, kind: "delete", items: [{ id: "3-4", type: "defect", title: "Old defect", op: "delete" }] } } });
    expect(c.$("t").textContent).toBe("Preview");
    expect(c.$("card").dataset.state).toBe("preview");
    expect(c.$("warn").hidden).toBe(true);
    expect(c.$("x").textContent).toBe("A preview only. Nothing was sent to Cloud ALM.");
    expect(c.$("ok").disabled).toBe(true);
    expect(c.calls).toEqual([]);
  });

  test("text from the tenant is shown as text, never as markup", async () => {
    const c = await card();
    const evil = { ...change, items: [{ ...change.items[0], title: "<img src=x onerror=alert(1)>" }] };
    await c.show(proposal({ change: evil }));
    expect(c.text()).toContain("<img src=x onerror=alert(1)>");
    expect(c.$("c").textContent).toContain("<img");
  });
});

/** Run the actual content card with the host bridge stubbed, as for the approval card. */
async function projectCard(serverTools: boolean) {
  const html = contentHtml().replace(appBundle(), "").replace(/<svg[\s\S]*?<\/svg>/, "");
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)![1]!;
  const window = new Window();
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/, ""));
  const calls: Call[] = [];
  let app!: { ontoolresult: (result: Result) => void };
  class App {
    constructor() { app = this as unknown as typeof app; }
    connect = async () => {};
    getHostContext = () => ({ availableDisplayModes: ["inline"] });
    getHostCapabilities = () => serverTools ? { serverTools: {} } : {};
    updateModelContext = async () => {};
    callServerTool = async (call: Call) => {
      calls.push(call);
      return { structuredContent: { projects: [{ id: "p2", name: "Second project" }], total: 2, offset: 1, nextOffset: null } };
    };
  }
  new Function("document", "App", "applyDocumentTheme", "applyHostStyleVariables", script)(window.document, App, () => {}, () => {});
  await Promise.resolve();
  const args = { limit: 1, query: "project" };
  app.ontoolresult({
    structuredContent: { display: { tool: "calm_projects", arguments: args } },
    _meta: { "cloud-alm/page": { structuredContent: {
      projects: [{ id: "p1", name: "First project" }], total: 2, offset: 0, nextOffset: 1,
    } } },
  });
  const element = (id: string) => window.document.querySelector<HTMLElement>(`#${id}`)!;
  return { calls, element, args };
}

test("the selected page is visible without a server tools bridge", async () => {
  const { calls, element } = await projectCard(false);
  expect(element("content").textContent).toContain("First project");
  expect(element("count").textContent).toBe("1–1 of 2");
  expect(element("more").hidden).toBe(true);
  expect(element("status").textContent).toContain("next page");
  expect(calls).toEqual([]);
});

test("a host with a bridge fetches only subsequent pages and preserves the selection filters", async () => {
  const { calls, element, args } = await projectCard(true);
  expect(calls).toEqual([]);
  expect(element("more").hidden).toBe(false);
  element("more").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toEqual([{ name: "calm_projects", arguments: { ...args, offset: 1 } }]);
  expect(element("content").textContent).toContain("First project");
  expect(element("content").textContent).toContain("Second project");
  expect(element("more").hidden).toBe(true);
});

/**
 * Apps keep a card by its address. When this fails, the card's HTML changed
 * (yours, or the bundled app library's): give the card a new address (raise
 * the number in its URI), move the address it had to the list of earlier
 * ones, and put the new fingerprint here.
 */
test("a card that changes gets a new address", () => {
  const fingerprint = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 16);
  expect({
    [CARD_URI]: fingerprint(cardHtml()),
    [OVERVIEW_URI]: fingerprint(overviewHtml()),
    [CONTENT_URI]: fingerprint(contentHtml(false)),
  }).toEqual({
    "ui://cloud-alm/approve-v6.html": "8c981a973b1734a8",
    "ui://cloud-alm/overview-v3.html": "c037ff94a43df9a9",
    "ui://cloud-alm/content-v5.html": "d5d7aff1d25a243a",
  });
  // The address before stays answerable, and no address is listed twice.
  const all = [CARD_URI, ...CARD_URIS_BEFORE, OVERVIEW_URI, ...OVERVIEW_URIS_BEFORE, CONTENT_URI, ...CONTENT_URIS_BEFORE];
  expect(new Set(all).size).toBe(all.length);
  expect(CARD_URIS_BEFORE.length + OVERVIEW_URIS_BEFORE.length + CONTENT_URIS_BEFORE.length).toBeGreaterThanOrEqual(6);
});

test("the cards use no middle dots or bullets as separators, and Reject stands left of Approve", () => {
  // The app library is not ours and not text anyone reads: only the cards' own markup and script are checked.
  for (const html of [cardHtml(), overviewHtml(), contentHtml(false), contentHtml(true)])
    expect(html.replace(appBundle(), "")).not.toMatch(/[·•∙⋅‧]|&middot;|&bull;/);
  const buttons = [...CARD_TEMPLATE.matchAll(/<button id="(ok|no)"/g)].map((m) => m[1]);
  expect(buttons).toEqual(["no", "ok"]);
});
