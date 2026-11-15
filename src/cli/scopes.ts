/**
 * Which `calm-api.*` scopes a token carries, against what each tool of the
 * server needs: `core` scopes make the tool work at all, `extra` scopes fill
 * in parts of its answer (a part the key cannot read is named as such).
 * A test checks every tool of `src/server.ts` has an entry here.
 */

export type ToolScopes = { core: string[]; extra: string[]; write?: boolean };

const s = (...names: string[]) => names.map((n) => `calm-api.${n}`);

export const TOOL_SCOPES: Record<string, ToolScopes> = {
  calm_overview: {
    core: s("projects.read", "tasks.read"),
    extra: s("features.read", "documents.read", "testcases.read", "testplans.read", "processmanagement.read", "analytics.read", "tests.read"),
  },
  calm_projects: { core: s("projects.read"), extra: [] },
  calm_team: { core: s("projects.read"), extra: [] },
  calm_list: {
    core: s("projects.read"),
    extra: s("tasks.read", "features.read", "documents.read", "testcases.read", "testplans.read", "processmanagement.read", "lib.read"),
  },
  calm_get: {
    core: s("projects.read"),
    extra: s("tasks.read", "features.read", "documents.read", "testcases.read", "testplans.read", "analytics.read", "tests.read"),
  },
  calm_trace: {
    core: s("projects.read", "tasks.read"),
    extra: s("features.read", "documents.read", "testcases.read", "processmanagement.read", "analytics.read", "tests.read"),
  },
  calm_gaps: {
    core: s("projects.read", "tasks.read"),
    extra: s("features.read", "testcases.read", "processmanagement.read", "analytics.read", "tests.read"),
  },
  calm_analytics: {
    core: s("analytics.read"),
    // Each dataset also needs its area's scope.
    extra: s("tasks.read", "defects.read", "requirements.read", "tests.read", "jobs.read", "exm.read", "metrics.read"),
  },
  calm_landscape: { core: s("landscape.read"), extra: s("bsm.read") },
  calm_create_task: { core: s("projects.read", "tasks.read", "tasks.write"), extra: [], write: true },
  calm_create_test_case: {
    core: s("projects.read", "tasks.read", "testcases.read", "testcases.write"),
    extra: [],
    write: true,
  },
  calm_link: {
    core: s("projects.read", "tasks.read", "testcases.read", "testcases.write", "tasks.write"),
    // Documents to link from; removing a test case's task link is a delete.
    extra: s("features.read", "documents.read", "testcases.delete"),
    write: true,
  },
  calm_tag: { core: s("projects.read", "tasks.read", "tasks.write"), extra: [], write: true },
  calm_update: {
    core: s("projects.read", "tasks.read", "tasks.write"),
    extra: s("features.read", "features.write", "testcases.read", "testcases.write"),
    write: true,
  },
  calm_delete: {
    core: s("projects.read", "tasks.read", "tasks.write"),
    extra: s("testcases.read", "testcases.delete", "testcases.force-delete", "documents.read", "documents.delete", "features.read"),
    write: true,
  },
  calm_comment: { core: s("projects.read", "tasks.read", "tasks.write"), extra: [], write: true },
  calm_create_feature: {
    core: s("projects.read", "features.read", "features.write"),
    extra: s("tasks.read", "tasks.write"),
    write: true,
  },
  calm_create_document: {
    core: s("projects.read", "documents.read", "documents.write"),
    extra: s("tasks.read"),
    write: true,
  },
};

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

export type ToolCoverage = {
  tool: string;
  status: "full" | "partial" | "none";
  missing: string[];
};

/** Each tool with the scopes the token lacks for it. */
export function coverage(scopes: string[], tools: string[]): ToolCoverage[] {
  const have = new Set(scopes);
  return tools.map((tool) => {
    const need = TOOL_SCOPES[tool] ?? { core: [], extra: [] };
    const core = need.core.filter((x) => !have.has(x));
    const extra = need.extra.filter((x) => !have.has(x));
    return {
      tool,
      status: core.length ? "none" : extra.length ? "partial" : "full",
      missing: core.length ? core : extra,
    };
  });
}
