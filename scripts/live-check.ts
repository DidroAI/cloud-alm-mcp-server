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
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
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

// Display ids (3-17, 6-1, 8-1-2) as the tools print them.
const firstDisplayId = (text: string, prefix: string) =>
  new RegExp(`- (${prefix}-[0-9-]+) `).exec(text)?.[1];

await call("calm_overview");
const all = await call("calm_list", { limit: 100 });
await call("calm_list", { query: "order | invoice", types: ["requirement", "user_story", "defect"] });
await call("calm_list", { types: ["application", "development", "interface", "configuration"] });
const ids = [
  firstDisplayId(all, "3"),
  firstDisplayId(all, "6"),
  firstDisplayId(all, "7"),
  firstDisplayId(all, "8-1"),
  firstDisplayId(all, "8-3"),
].filter((x): x is string => !!x);
if (ids.length) await call("calm_get", { ids });
const requirement = firstDisplayId(await call("calm_list", { types: ["requirement"] }), "3");
if (requirement) await call("calm_trace", { id: requirement });
await call("calm_gaps");
await call("calm_analytics");
await call("calm_analytics", { dataset: "Tasks", groupBy: ["type", "statusText"] });
await call("calm_analytics", { dataset: "Tests", period: "C30D", limit: 10 });
await call("calm_landscape");

const notCalled = tools.map((t) => t.name).filter((n) => !called.has(n));
console.log(
  `\ncalled ${called.size} of ${tools.length} tools${notCalled.length ? `; not called: ${notCalled.join(", ")}` : ""}`,
);
console.log(
  failures
    ? `${failures} call(s) answered with an error.`
    : "All calls answered.",
);
await client.close();
stopHttp();
