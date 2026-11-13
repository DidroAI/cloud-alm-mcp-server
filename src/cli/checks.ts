import {
  CloudAlm,
  CloudAlmError,
  clientCredentials,
  type Grant,
  type ServiceKey,
} from "../calm/index.js";
import { coverage, otherScopes, tokenScopes } from "./scopes.js";

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

export type KeyCheckOptions = { fetch?: typeof fetch; now?: () => number };

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
  if (!scopes)
    checks.push({
      name: "Scopes",
      status: "warn",
      detail: "the token does not list its scopes; cannot check them",
    });
  else {
    const areas = coverage(scopes);
    const readable = areas.filter((a) => !a.missing.length).length;
    const extra = otherScopes(scopes);
    checks.push({
      name: "Scopes",
      status: readable === 0 ? "fail" : readable < areas.length ? "warn" : "ok",
      detail:
        readable === 0
          ? "the key has no calm-api read scope: it can read nothing"
          : `${readable} of ${areas.length} areas readable`,
      lines: [
        ...areas.map((a) =>
          a.missing.length
            ? `  ✗ ${a.name}: missing ${a.missing.join(", ")}`
            : `  ✓ ${a.name}`,
        ),
        ...(extra.length ? [`  also: ${extra.join(", ")}`] : []),
      ],
    });
  }

  try {
    const projects = await new CloudAlm(grant, options).listProjects();
    checks.push({
      name: "Read",
      status: "ok",
      detail: `projects answered (${projects.length})`,
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
