import { localFeedbackSink } from "./feedback.js";
import { webBaseFrom, webBaseFromKey } from "./views/links.js";
import { existsSync } from "node:fs";
import {
  CloudAlm,
  type CloudAlmOptions,
  serviceKeyGrants,
} from "./calm/index.js";
import { CloudAlmWriter } from "./calm/writer.js";
import { cliCommand, packageSpec, version } from "./cli/clients.js";
import {
  configDir,
  expandHome,
  keySource,
  loadServiceKey,
  SERVICE_KEY_ENV,
} from "./cli/key.js";
import { tokenScopes, writeToolsFor } from "./cli/scopes.js";
import { approvalFromEnv } from "./approval.js";
import { createServer, serverOptionsForKey } from "./server.js";

export { SERVICE_KEY_ENV };

/** Reader and opt-in writer over one service key; they share its tokens. */
function clientsFrom(
  key: ReturnType<typeof loadServiceKey>,
  options: CloudAlmOptions,
): { reader: CloudAlm; writer: CloudAlmWriter; grants: ReturnType<typeof serviceKeyGrants> } {
  const fetcher = options.fetch;
  const grants = serviceKeyGrants(key, fetcher ? { fetch: fetcher } : {});
  return {
    reader: new CloudAlm(grants, options),
    writer: new CloudAlmWriter(grants, options),
    grants,
  };
}

/** Reader and writer over a service key file. The key is never echoed. */
export function clientsFromKeyFile(
  path: string,
  options: CloudAlmOptions = {},
): { reader: CloudAlm; writer: CloudAlmWriter } {
  const { reader, writer } = clientsFrom(
    loadServiceKey({ kind: "file", path: expandHome(path), label: path }, {}),
    options,
  );
  return { reader, writer };
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
 * file path or the JSON itself), else from the file `init` saved. The key
 * decides the rest: write tools when its scopes allow them.
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
 * discovery probe) shares the token and the cached project reads. The
 * token's scopes, read once, say which write tools to offer; when no token
 * can be had, the read tools are offered and answer with the error.
 */
export function stdioFactory(
  env: Record<string, string | undefined> = process.env,
  options: CloudAlmOptions = {},
) {
  const source = keySource(env, existsSync);
  if (!source)
    throw new Error(
      "Cloud ALM is not set up yet: no service key was found. " +
        `Run \`${cliCommand(packageSpec(version()), env)} setup\` in a terminal ` +
        "(it asks for the key JSON you downloaded from SAP BTP, checks it and saves it), " +
        `or set ${SERVICE_KEY_ENV} to the key file's path. In a Claude Code plugin or ` +
        "Claude Desktop extension, choose the key file in its settings.",
    );
  const key = loadServiceKey(source, env);
  const { reader, writer, grants } = clientsFrom(key, options);
  // Links to the Cloud ALM UI: configured, else the tenant the key opens.
  const webUrl = webBaseFrom(env.CALM_WEB_URL) ?? webBaseFromKey(key);
  // On unless the user turned it off: reports go to Didro's inbox, or the receiver named.
  const feedback = localFeedbackSink(env, configDir(env));
  // The card only, when the user asked for that (CALM_APPROVAL=card).
  const approval = approvalFromEnv(env);
  let writeTools: Promise<string[]> | undefined;
  return async () => {
    writeTools ??= grants().then((g) => writeToolsFor(tokenScopes(g.accessToken)));
    // Offline at start: read tools now, and ask again on the next connection.
    const tools = await writeTools.catch(() => {
      writeTools = undefined;
      return [] as string[];
    });
    const fromKey = serverOptionsForKey(writer, tools, env.CALM_CONTENT_PRESENTATION ?? "legacy", feedback);
    return createServer(reader, { ...fromKey, ...(fromKey.approval ? { approval } : {}), ...(webUrl ? { webUrl } : {}) });
  };
}
