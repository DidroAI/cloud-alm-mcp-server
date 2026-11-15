import {
  CloudAlm,
  CloudAlmError,
  clientCredentials,
  type Grant,
  type ServiceKey,
} from "../calm/index.js";
import { TOOL_NAMES, WRITE_TOOL_NAMES } from "../server.js";
import { coverage, tokenScopes, writeToolsFor } from "./scopes.js";

export type Status = "ok" | "warn" | "fail";
export type Check = { name: string; status: Status; detail: string; lines?: string[] };

export const MIN_NODE = 22;

const reason = (error: unknown) =>
  error instanceof CloudAlmError
    ? error.message
    : "unexpected error (details withheld)";

export function nodeCheck(version = process.versions.node): Check {
  const major = Number(version.split(".")[0]);
  return major >= MIN_NODE
    ? { name: "Node", status: "ok", detail: `v${version}` }
    : {
        name: "Node",
        status: "fail",
        detail: `v${version}; needs ${MIN_NODE} or later`,
      };
}

export type KeyCheckOptions = {
  fetch?: typeof fetch;
  now?: () => number;
};

/**
 * Prove a key works: get a token, read its scopes, make one read. The
 * token stays in this function; only its scopes and expiry are reported.
 */
export async function keyChecks(
  key: ServiceKey,
  options: KeyCheckOptions = {},
): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push({ name: "API", status: "ok", detail: key.endpoints.Api });
  let grant: Grant;
  try {
    grant = await clientCredentials(key, options);
  } catch (error) {
    checks.push({ name: "Token", status: "fail", detail: reason(error) });
    return checks;
  }
  const now = (options.now ?? Date.now)();
  const minutes = grant.expiresAt
    ? Math.round((grant.expiresAt - now) / 60_000)
    : undefined;
  checks.push({
    name: "Token",
    status: "ok",
    detail: `issued${minutes !== undefined ? `, valid ${minutes} min` : ""}`,
  });

  const scopes = tokenScopes(grant.accessToken);
  const tools: string[] = [...TOOL_NAMES];
  if (!scopes)
    checks.push({
      name: "Scopes",
      status: "warn",
      detail: "the token does not list its scopes; cannot check them",
    });
  else {
    const rows = coverage(scopes, tools);
    const usable = rows.filter((r) => r.status !== "none").length;
    const full = rows.filter((r) => r.status === "full").length;
    const mark = { full: "✓", partial: "~", none: "✗" } as const;
    checks.push({
      name: "Scopes",
      status: usable === 0 ? "fail" : usable < rows.length ? "warn" : "ok",
      detail:
        usable === 0
          ? "the key has none of the scopes the tools need: it can read nothing"
          : `${usable} of ${rows.length} tools usable, ${full} with every part`,
      lines: rows.map((r) =>
        r.status === "full"
          ? `  ${mark.full} ${r.tool}`
          : `  ${mark[r.status]} ${r.tool}: ${r.status === "none" ? "needs" : "parts need"} ${r.missing.join(", ")}`,
      ),
    });
    // The key decides whether writing is on.
    const writable = writeToolsFor(scopes);
    checks.push({
      name: "Writes",
      status: "ok",
      detail: writable.length
        ? `on: ${writable.length} of ${WRITE_TOOL_NAMES.length} write tools (${writable.map((t) => t.replace("calm_", "")).join(", ")}); each change waits for the user's approval`
        : "off: the key has no write scopes, so the agent can only read",
    });
  }

  try {
    const projects = await new CloudAlm(grant, options).listProjects();
    checks.push({
      name: "Read",
      status: "ok",
      detail: `projects answered (${projects.length})`,
    });
    if (projects.length > 1)
      checks.push({ name: "Project", status: "ok", detail: `${projects.length} projects: agents name the one they mean (projectId takes an id or a name)` });
  } catch (error) {
    const forbidden = error instanceof CloudAlmError && error.code === "forbidden";
    checks.push({
      name: "Read",
      status: forbidden ? "warn" : "fail",
      detail: forbidden
        ? "API reached; projects refused (403, no calm-api.projects.read)"
        : reason(error),
    });
  }
  return checks;
}
