import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  CloudAlm,
  type CloudAlmOptions,
  parseServiceKey,
  serviceKeyGrants,
} from "./calm/index.js";
import { createServer } from "./server.js";

/** Env var naming the path of the developer's own service key (JSON). */
export const SERVICE_KEY_ENV = "CALM_SERVICE_KEY";

/**
 * A reader over a service key file: tokens come from the key's client
 * credentials and stay in memory. The key's contents are never echoed.
 */
export function readerFromKeyFile(
  path: string,
  options: CloudAlmOptions = {},
): CloudAlm {
  const resolved = path.replace(/^~(?=$|\/)/, homedir());
  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch {
    throw new Error(
      `Cannot read the service key file named by ${SERVICE_KEY_ENV}.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("The service key file is not JSON.");
  }
  const fetcher = options.fetch;
  return new CloudAlm(
    serviceKeyGrants(parseServiceKey(json), fetcher ? { fetch: fetcher } : {}),
    options,
  );
}

/** The MCP server for stdio mode, from `CALM_SERVICE_KEY`. */
export function stdioServer(
  env: Record<string, string | undefined> = process.env,
) {
  const path = env[SERVICE_KEY_ENV]?.trim();
  if (!path)
    throw new Error(
      `Set ${SERVICE_KEY_ENV} to the path of your Cloud ALM API service key (JSON).`,
    );
  return createServer(readerFromKeyFile(path));
}
