/**
 * Which `calm-api.*` scopes a token carries, against what each area of
 * Cloud ALM the server reads needs. Areas, not tool names: the tool set
 * changes, the areas and their scopes do not.
 */

export type Area = { name: string; scopes: string[] };

export const AREAS: Area[] = [
  { name: "Projects", scopes: ["calm-api.projects.read"] },
  {
    name: "Tasks (requirements, user stories, defects)",
    scopes: ["calm-api.tasks.read"],
  },
  { name: "Features", scopes: ["calm-api.features.read"] },
  { name: "Documents", scopes: ["calm-api.documents.read"] },
  { name: "Test cases", scopes: ["calm-api.testcases.read"] },
  { name: "Test plans", scopes: ["calm-api.testplans.read"] },
  {
    name: "Project scopes and solution processes",
    scopes: ["calm-api.processmanagement.read"],
  },
  { name: "Process hierarchy", scopes: ["calm-api.processhierarchy.read"] },
  { name: "Landscape", scopes: ["calm-api.landscape.read"] },
  { name: "Cross-library", scopes: ["calm-api.lib.read"] },
  {
    name: "Analytics (plus each dataset's area scope)",
    scopes: ["calm-api.analytics.read", "calm-api.analytics.providers.read"],
  },
  { name: "Service status events", scopes: ["calm-api.bsm.read"] },
];

/**
 * The `scope` claim of a JWT access token, reduced to the `calm-api.*` part
 * (XSUAA prefixes each scope with the app name, e.g. `xyz!b1.calm-api.tasks.read`).
 * Reads the payload only; the token is not verified, kept or printed.
 */
export function tokenScopes(accessToken: string): string[] | undefined {
  const payload = accessToken.split(".")[1];
  if (!payload) return undefined;
  let claims: { scope?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const raw = Array.isArray(claims.scope)
    ? claims.scope
    : typeof claims.scope === "string"
      ? claims.scope.split(" ")
      : undefined;
  if (!raw) return undefined;
  const scopes = new Set<string>();
  for (const s of raw)
    if (typeof s === "string") {
      const match = /(?:^|\.)(calm-api\.[A-Za-z0-9_.-]+)$/.exec(s);
      if (match?.[1]) scopes.add(match[1]);
    }
  return [...scopes].sort();
}

export type AreaCoverage = Area & { missing: string[] };

/** Each area with the scopes the token lacks for it. */
export function coverage(scopes: string[]): AreaCoverage[] {
  const have = new Set(scopes);
  return AREAS.map((area) => ({
    ...area,
    missing: area.scopes.filter((s) => !have.has(s)),
  }));
}

/** `calm-api.*` scopes the token has that no area above uses (extras). */
export function otherScopes(scopes: string[]): string[] {
  const known = new Set(AREAS.flatMap((a) => a.scopes));
  return scopes.filter((s) => !known.has(s));
}
