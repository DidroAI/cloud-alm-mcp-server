import { existsSync } from "node:fs";
import {
  CloudAlm,
  type CloudAlmOptions,
  serviceKeyGrants,
} from "./calm/index.js";
import { CloudAlmWriter } from "./calm/writer.js";
import {
  expandHome,
  keySource,
  loadServiceKey,
  SERVICE_KEY_ENV,
} from "./cli/key.js";
import { createServer, serverOptionsFromEnv } from "./server.js";

export { SERVICE_KEY_ENV };

/** Reader and opt-in writer over one service key; they share its tokens. */
function clientsFrom(
  key: ReturnType<typeof loadServiceKey>,
  options: CloudAlmOptions,
): { reader: CloudAlm; writer: CloudAlmWriter } {
  const fetcher = options.fetch;
  const grants = serviceKeyGrants(key, fetcher ? { fetch: fetcher } : {});
  return {
    reader: new CloudAlm(grants, options),
    writer: new CloudAlmWriter(grants, options),
  };
}

/** Reader and writer over a service key file. The key is never echoed. */
export function clientsFromKeyFile(
  path: string,
  options: CloudAlmOptions = {},
): { reader: CloudAlm; writer: CloudAlmWriter } {
  return clientsFrom(
    loadServiceKey({ kind: "file", path: expandHome(path), label: path }, {}),
    options,
  );
}

/**
 * A reader over a service key file: tokens come from the key's client
 * credentials and stay in memory. The key's contents are never echoed.
 */
export function readerFromKeyFile(
  path: string,
  options: CloudAlmOptions = {},
): CloudAlm {
  return clientsFromKeyFile(path, options).reader;
}

/**
 * The MCP server for stdio mode. The key comes from `CALM_SERVICE_KEY` (a
 * file path or the JSON itself), else from the file `init` saved. Tool
 * options (`CALM_WRITE`, `CALM_TOOLS`, `CALM_PROJECT`) come from `env`.
 */
export function stdioServer(
  env: Record<string, string | undefined> = process.env,
  options: CloudAlmOptions = {},
) {
  return stdioFactory(env, options)();
}

/**
 * A factory for `serveStdio`: the key is read and its clients built once,
 * so every server it makes (one per connection, and the 2026-07-28
 * discovery probe) shares the token and the cached project reads.
 */
export function stdioFactory(
  env: Record<string, string | undefined> = process.env,
  options: CloudAlmOptions = {},
) {
  const source = keySource(env, existsSync);
  if (!source)
    throw new Error(
      `No Cloud ALM service key: run \`cloud-alm-mcp-server init\`, or set ${SERVICE_KEY_ENV} to the key file's path (or its JSON).`,
    );
  const serverOptions = serverOptionsFromEnv(env);
  const { reader, writer } = clientsFrom(loadServiceKey(source, env), options);
  return () =>
    createServer(reader, {
      ...serverOptions,
      ...(serverOptions.writeMode && serverOptions.writeMode !== "off"
        ? { writer }
        : {}),
    });
}
