import { existsSync } from "node:fs";
import {
  CloudAlm,
  type CloudAlmOptions,
  serviceKeyGrants,
} from "./calm/index.js";
import {
  expandHome,
  keySource,
  loadServiceKey,
  SERVICE_KEY_ENV,
} from "./cli/key.js";
import { createServer } from "./server.js";

export { SERVICE_KEY_ENV };

function readerFrom(
  key: ReturnType<typeof loadServiceKey>,
  options: CloudAlmOptions,
): CloudAlm {
  const fetcher = options.fetch;
  return new CloudAlm(
    serviceKeyGrants(key, fetcher ? { fetch: fetcher } : {}),
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
  return readerFrom(
    loadServiceKey({ kind: "file", path: expandHome(path), label: path }, {}),
    options,
  );
}

/**
 * The MCP server for stdio mode. The key comes from `CALM_SERVICE_KEY` (a
 * file path or the JSON itself), else from the file `init` saved.
 */
export function stdioServer(
  env: Record<string, string | undefined> = process.env,
  options: CloudAlmOptions = {},
) {
  const source = keySource(env, existsSync);
  if (!source)
    throw new Error(
      `No Cloud ALM service key: run \`cloud-alm-mcp-server init\`, or set ${SERVICE_KEY_ENV} to the key file's path (or its JSON).`,
    );
  return createServer(readerFrom(loadServiceKey(source, env), options));
}
