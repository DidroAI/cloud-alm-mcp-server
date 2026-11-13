#!/usr/bin/env node
/**
 * Start the Cloud ALM MCP server.
 *
 *   CALM_SERVICE_KEY=~/keys/calm.json cloud-alm-mcp-server            # stdio (default)
 *   PORT=3333 CALM_API_URL=https://eu20.alm.cloud.sap/api cloud-alm-mcp-server http
 */
import { createServer as createHttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpHandler } from "./http.js";
import { toNodeListener } from "./node-http.js";
import { stdioServer } from "./stdio.js";

const mode = process.argv[2] ?? "stdio";

if (mode === "stdio") {
  try {
    await stdioServer().connect(new StdioServerTransport());
  } catch (error) {
    // stdout carries the protocol; messages go to stderr.
    console.error(error instanceof Error ? error.message : "Could not start.");
    process.exit(2);
  }
} else if (mode === "http") {
  const port = Number(process.env.PORT ?? 3333);
  const host = process.env.HOST ?? "127.0.0.1";
  const handler = createHttpHandler(
    process.env.CALM_API_URL ? { baseUrl: process.env.CALM_API_URL } : {},
  );
  createHttpServer(
    toNodeListener((request) =>
      new URL(request.url).pathname === "/mcp"
        ? handler(request)
        : Promise.resolve(new Response("Not found", { status: 404 })),
    ),
  ).listen(port, host, () => {
    console.error(`Cloud ALM MCP server on http://${host}:${port}/mcp`);
  });
} else {
  console.error("Usage: cloud-alm-mcp-server [stdio | http]");
  process.exit(2);
}
