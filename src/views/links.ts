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
  | { kind: "feature"; displayId: string | null }
  | { kind: "testCase"; id: string; manual: boolean }
  | { kind: "testPlan" | "document" | "process" };

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
      return t.displayId ? at(APP.feature, `&/list/details/${enc(t.displayId)}`) : at(APP.feature);
    case "testCase":
      return t.manual ? at(APP.testCase, `&/manual/${enc(t.id)}/tab/content`) : at(APP.testCase);
    default:
      return at(APP[t.kind]);
  }
}
