import { afterAll, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createHostedPreview } from "../scripts/hosted-preview.js";

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createHostedPreview() });
afterAll(() => server.stop(true));

test("preview identifies the fixtures and respects the MCP route", async () => {
  expect(await (await fetch(new URL("/health", server.url))).json()).toEqual({ status: "ok", data: "synthetic" });
  expect((await fetch(new URL("/", server.url))).status).toBe(404);
});

for (const mode of ["legacy", "auto"] as const) {
  test(`preview serves an anonymous ${mode} client, ignores tenant overrides and hydrates its card`, async () => {
    const client = new Client({ name: "test", version: "1" }, { versionNegotiation: { mode } });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
        requestInit: { headers: { "x-calm-api-url": "https://unused.invalid", "x-calm-web-url": "https://foreign.eu20.alm.cloud.sap" } },
      }));
      expect(client.getNegotiatedProtocolVersion()).toMatch(mode === "auto" ? /^2026-07-28$/ : /^2025-/);
      const names = (await client.listTools()).tools;
      expect(names.every(tool => tool.annotations?.readOnlyHint)).toBe(true);
      const argumentsForList = { types: ["test_case"], limit: 2 };
      const show = await client.callTool({ name: "calm_show", arguments: { tool: "calm_list", arguments: argumentsForList } });
      expect(show.structuredContent).toEqual({ display: { tool: "calm_list", arguments: argumentsForList } });
      const resource = await client.readResource({ uri: "ui://cloud-alm/content-v1.html" });
      const content = resource.contents[0];
      expect(content && "text" in content && content.text).toContain("cloud-alm-content");
      const list = await client.callTool({ name: "calm_list", arguments: argumentsForList });
      expect(list.structuredContent).toMatchObject({ project: { name: "Rollout Example" }, total: 4, nextOffset: 2 });
      expect(JSON.stringify(list.structuredContent)).not.toContain("foreign.eu20.alm.cloud.sap");
    } finally {
      await client.close();
    }
  });
}
