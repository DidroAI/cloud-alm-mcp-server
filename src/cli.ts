#!/usr/bin/env node
/**
 * The cloud-alm-mcp-server command.
 *
 *   cloud-alm-mcp-server init ~/Downloads/calm-key.json   # check and save a key
 *   cloud-alm-mcp-server doctor                           # check the setup
 *   cloud-alm-mcp-server                                  # stdio server (default)
 *   PORT=3333 CALM_API_URL=https://eu20.alm.cloud.sap/api cloud-alm-mcp-server http
 */
import { createServer as createHttpServer } from "node:http";
import { text } from "node:stream/consumers";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { COMMANDS, runCommand } from "./cli/main.js";
import { canAsk, terminalPrompts } from "./cli/prompts.js";
import { feedbackSinkFromEnv } from "./feedback.js";
import { createHttpHandler } from "./http.js";
import { toNodeListener } from "./node-http.js";
import { stdioFactory } from "./stdio.js";

const mode = process.argv[2] ?? "stdio";

if (COMMANDS.includes(mode)) {
  process.exitCode = await runCommand(
    {
      env: process.env,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
      readStdin: () => text(process.stdin),
      stdinIsTTY: Boolean(process.stdin.isTTY),
      // Questions only for a person: an agent or a script gets none.
      ...(canAsk(process.env, Boolean(process.stdin.isTTY), Boolean(process.stdout.isTTY))
        ? { prompts: () => terminalPrompts() }
        : {}),
    },
    process.argv.slice(2),
  );
} else if (mode === "stdio") {
  try {
    // Serves 2026-07-28 clients and, on the same pipe, 2025-era ones.
    serveStdio(stdioFactory(), { onerror: (e) => console.error(e.message) });
  } catch (error) {
    // stdout carries the protocol; messages go to stderr.
    console.error(error instanceof Error ? error.message : "Could not start.");
    process.exit(2);
  }
} else if (mode === "http") {
  const port = Number(process.env.PORT ?? 3333);
  const host = process.env.HOST ?? "127.0.0.1";
  const feedbackSink = feedbackSinkFromEnv(process.env);
  // On the loopback address, only this computer's own names are answered (no DNS rebinding, no web pages).
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  const handler = createHttpHandler(
    {
      ...(loopback ? { allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`] } : {}),
      ...(feedbackSink ? { feedbackSink } : {}),
      ...(process.env.CALM_API_URL ? { baseUrl: process.env.CALM_API_URL } : {}),
      ...(process.env.CALM_WEB_URL ? { webUrl: process.env.CALM_WEB_URL } : {}),
    },
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
  console.error(`Unknown command ${mode}. See cloud-alm-mcp-server --help.`);
  process.exit(2);
}
