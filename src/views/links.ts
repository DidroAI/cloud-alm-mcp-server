/**
 * Links back to the Cloud ALM web UI, so a user can open what the agent
 * talks about. The UI lives on the tenant's own host
 * (`https://<tenant>.<region>.alm.cloud.sap`), which the API host does not
 * name: it comes from the service key's token host, or is configured.
 * Routes were read from a live tenant (Nov 2026); items the UI cannot open
 * by id link to their list app.
 */

/** The UI root from a service key: `<subdomain>.authentication.<region>…` + the API's region. */
export function webBaseFromKey(key: { uaa: { url: string }; endpoints: { Api: string } }): string | undefined {
  try {
    const sub = new URL(key.uaa.url).hostname.split(".")[0];
    const api = new URL(key.endpoints.Api).hostname; // eu20.alm.cloud.sap
    if (!sub || !/^[a-z0-9-]+\.alm\.cloud\.sap$/i.test(api)) return undefined;
    return `https://${sub}.${api}`;
  } catch {
    return undefined;
  }
}

/** A configured UI root (CALM_WEB_URL): https on an alm.cloud.sap host only. */
export function webBaseFrom(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || !/\.alm\.cloud\.sap$/i.test(u.hostname)) return undefined;
    return `https://${u.hostname}`;
  } catch {
    return undefined;
  }
}

const APP = {
  requirement: "ptmRequirement-management?sap-ui-app-id-hint=com.sap.calm.imp.ptm.requirements.ui",
  defect: "ptmDefect-management?sap-ui-app-id-hint=com.sap.calm.imp.ptm.defects.ui",
  task: "task-management?sap-ui-app-id-hint=com.sap.calm.imp.tkm.ui",
  feature: "feature-display?sap-ui-app-id-hint=com.sap.calm.imp.cdm.features.ui",
  testCase: "test-displayTestCaseList?sap-ui-app-id-hint=com.sap.calm.imp.tm.preparation",
  testPlan: "testPlan-display?sap-ui-app-id-hint=com.sap.calm.imp.tm.planning",
  document: "DocumentationObject-manage?sap-ui-app-id-hint=com.sap.calm.imp.sd.docu.ui",
  process: "ProcessScopingList-display?sap-ui-app-id-hint=sap.calm.imp.pm.processScopingList",
} as const;

const enc = encodeURIComponent;

export type LinkTarget =
  | { kind: "task"; type: string | null; displayId: string | null }
  | { kind: "feature"; id: string }
  | { kind: "document"; displayId: string | null }
  | { kind: "testCase"; id: string; manual: boolean }
  | { kind: "testPlan" | "process" };

/** The page of an item in the Cloud ALM UI; undefined without a UI root. */
export function webUrl(base: string | undefined, t: LinkTarget): string | undefined {
  if (!base) return undefined;
  const at = (app: string, route = "") => `${base}/launchpad#${app}${route}`;
  switch (t.kind) {
    case "task": {
      const app = t.type === "CALMREQU" ? APP.requirement : t.type === "CALMDEF" ? APP.defect : APP.task;
      return t.displayId ? at(app, `&/taskDetail/${enc(t.displayId)}`) : at(app);
    }
    case "feature":
      return at(APP.feature, `&/list/details/${enc(t.id)}`);
    case "document":
      return t.displayId ? at(`DocumentationObject-manage?displayId=${enc(t.displayId)}`) : at(APP.document);
    case "testCase":
      return at(APP.testCase, t.manual ? `&/manual/${enc(t.id)}/tab/content` : `&/automated/${enc(t.id)}/tab/general`);
    default:
      return at(APP[t.kind]);
  }
}

/**
 * The id inside a Cloud ALM UI link, so a pasted link works as an id:
 * `…#…&/taskDetail/3-17` → 3-17, `…/details/6-1` → 6-1, `…/manual/<GUID>/…`
 * → the GUID. Anything else is returned as given.
 */
export function idFromUrl(raw: string): string {
  const text = raw.trim();
  if (!/^https:\/\/[^/]+\.alm\.cloud\.sap\//i.test(text)) return text;
  const hash = decodeURIComponent(text.split("#")[1] ?? "");
  const m =
    /\/taskDetail\/([0-9]+-[0-9]+(?:-[0-9]+)?)/.exec(hash) ??
    /\/details\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|[/?&])/i.exec(hash) ??
    /^DocumentationObject-manage\?displayId=([0-9]+-[0-9]+)(?:$|&)/.exec(hash) ??
    /\/details\/([0-9]+-[0-9]+(?:-[0-9]+)?)/.exec(hash) ??
    /\/(?:manual|automated)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(hash);
  return m?.[1] ?? text;
}
