import {
  CloudAlm,
  CloudAlmError,
  clientCredentials,
  type Grant,
  type ServiceKey,
} from "../calm/index.js";
import { type ServerOptions, TOOL_NAMES, WRITE_TOOL_NAMES } from "../server.js";
import { coverage, tokenScopes } from "./scopes.js";

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
  /** The server settings from the environment (CALM_WRITE, CALM_TOOLS, CALM_PROJECT). */
  settings?: ServerOptions;
};

/** The tools the server will offer with these settings. */
export function offeredTools(settings: ServerOptions = {}): string[] {
  const all: string[] = [
    ...TOOL_NAMES,
    ...(settings.writeMode && settings.writeMode !== "off" ? WRITE_TOOL_NAMES : []),
  ];
  return settings.tools ? all.filter((t) => settings.tools?.includes(t)) : all;
}

/** What the environment asks of the server, as one line. */
export function settingsCheck(settings: ServerOptions): Check {
  const write = settings.writeMode ?? "off";
  const parts = [
    `write ${write === "off" ? "off (CALM_WRITE=on to offer write tools)" : write}${write === "on" ? `, approval ${settings.approval ?? "off"}${settings.approvalDialog && settings.approval !== "off" ? " (+ dialog)" : ""}` : ""}`,
    settings.tools ? `tools limited to ${settings.tools.length} (CALM_TOOLS)` : "all tools",
    settings.defaultProject ? `default project ${settings.defaultProject}` : "no default project",
  ];
  return { name: "Mode", status: "ok", detail: parts.join("; ") };
}

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
  const tools = offeredTools(options.settings);
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
    // Writes are off: say whether this key could write, and how to turn it on.
    if (!options.settings?.writeMode || options.settings.writeMode === "off") {
      const writable = coverage(scopes, [...WRITE_TOOL_NAMES]).filter((r) => r.status !== "none").length;
      if (writable)
        checks.push({
          name: "Writes",
          status: "ok",
          detail: `off; this key could use ${writable} of ${WRITE_TOOL_NAMES.length} write tools. Add CALM_WRITE=on to the server's env to offer them (each change waits for the user's approval)`,
        });
    }
  }

  try {
    const projects = await new CloudAlm(grant, options).listProjects();
    checks.push({
      name: "Read",
      status: "ok",
      detail: `projects answered (${projects.length})`,
    });
    const wanted = options.settings?.defaultProject;
    if (wanted && !projects.some((p) => p.id.toLowerCase() === wanted.toLowerCase()))
      checks.push({
        name: "Project",
        status: "fail",
        detail: `CALM_PROJECT ${wanted} is not a project this key can read`,
      });
    else if (!wanted && projects.length > 1)
      checks.push({
        name: "Project",
        status: "ok",
        detail: `${projects.length} projects: agents pass projectId, or set CALM_PROJECT to a default`,
      });
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
