/**
 * Calls every tool against the real tenant through the MCP server, in
 * stdio mode (a, the server started as a child process with the key) or
 * HTTP mode (b, a bearer per request, the server holding nothing). Prints
 * per tool whether it answered and the size of the answer; never its text.
 *
 *   bun run build && CALM_SERVICE_KEY=~/path/to/key.json bun scripts/live-check.ts [stdio|http]
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { clientCredentials, parseServiceKey } from "../src/calm/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpHandler } from "../src/http.js";

const keyPath = process.env.CALM_SERVICE_KEY;
if (!keyPath) {
  console.error(
    "Set CALM_SERVICE_KEY to the path of a Cloud ALM API service key (JSON).",
  );
  process.exit(2);
}

const mode = process.argv[2] === "http" ? "http" : "stdio";
const client = new Client({ name: "live-check", version: "0" });
let stopHttp = () => {};
if (mode === "stdio") {
  // Mode (a): the server reads the key itself.
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: [new URL("../dist/cli.js", import.meta.url).pathname, "stdio"],
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        CALM_SERVICE_KEY: keyPath,
      },
      stderr: "inherit",
    }),
  );
} else {
  // Mode (b): the server holds nothing; this script plays the broker and
  // sends a token it got from the key, in memory only, as a bearer.
  const key = parseServiceKey(
    JSON.parse(readFileSync(keyPath.replace(/^~(?=\/)/, homedir()), "utf8")),
  );
  const grant = await clientCredentials(key);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: createHttpHandler({ baseUrl: grant.baseUrl }),
  });
  stopHttp = () => server.stop(true);
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${grant.accessToken}` },
        },
      },
    ),
  );
}
console.log(`mode: ${mode}`);

const { tools } = await client.listTools();
console.log(`tools: ${tools.length}`);

const GUID =
  /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/i;
let failures = 0;
const called = new Set<string>();

async function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  called.add(name);
  const started = performance.now();
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text?: string }[];
  };
  const text = result.content.map((c) => c.text ?? "").join("\n");
  const ms = Math.round(performance.now() - started);
  const label = `${name}${Object.keys(args).length ? ` ${Object.keys(args).join(",")}` : ""}`;
  if (result.isError) {
    failures++;
    // Error texts are the library's own short reasons: no tenant data.
    console.log(`ERR  ${label.padEnd(44)} ${ms} ms  ${text}`);
  } else {
    const lines = text.split("\n").length;
    console.log(
      `ok   ${label.padEnd(44)} ${ms} ms  ${lines} lines, ${text.length} chars`,
    );
  }
  return text;
}

const firstId = (text: string) => GUID.exec(text)?.[1];

const projectId = firstId(await call("calm_list_projects"));
if (projectId) await call("calm_get_project", { projectId });
await call("calm_search_tasks", { limit: 20 });
const defectId = firstId(await call("calm_search_tasks", { type: "defect" }));
await call("calm_search_tasks", { type: "requirement" });
await call("calm_search_tasks", { query: "invoice" });
if (defectId) await call("calm_get_task", { taskId: defectId });
const featureId = firstId(await call("calm_list_features"));
if (featureId) await call("calm_get_feature", { featureId });
const documentId = firstId(await call("calm_list_documents"));
if (documentId) await call("calm_get_document", { documentId });
const testCaseId = firstId(await call("calm_list_test_cases"));
await call("calm_list_test_cases", { kind: "automated" });
if (testCaseId) await call("calm_get_test_case", { testCaseId });
const testPlanId = firstId(await call("calm_list_test_plans"));
if (testPlanId) await call("calm_get_test_plan", { testPlanId });
await call("calm_list_scopes");
await call("calm_list_processes", { limit: 5 });
await call("calm_list_process_hierarchy");
await call("calm_list_landscape");
for (const kind of [
  "applications",
  "developments",
  "interfaces",
  "configurations",
])
  await call("calm_list_library", { kind });
await call("calm_list_analytics_providers");
await call("calm_query_analytics", { dataset: "Tasks", limit: 10 });
await call("calm_query_analytics", {
  dataset: "Tests",
  period: "C30D",
  limit: 10,
});
await call("calm_list_status_events", { limit: 5 });

const notCalled = tools.map((t) => t.name).filter((n) => !called.has(n));
console.log(
  `\ncalled ${called.size} of ${tools.length} tools${notCalled.length ? `; not called (no item to get): ${notCalled.join(", ")}` : ""}`,
);
console.log(
  failures
    ? `${failures} call(s) answered with an error.`
    : "All calls answered.",
);
await client.close();
stopHttp();
