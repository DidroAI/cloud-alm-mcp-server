import { expect, test } from "bun:test";
import { CloudAlm } from "../src/calm/index.js";
import { changes } from "../src/views/tools.js";
import { BASE_URL, fakeCloudAlm, PROJECT_ID, TENANT } from "./tenant.js";

const now = () => Date.parse("2026-11-20T15:30:00Z");
const path = "calm-analytics/v1/odata/v4/analytics/Tests";

async function query(rows: unknown, since = "2026-11-18") {
  const fake = fakeCloudAlm({ ...TENANT, [path]: rows });
  const calm = new CloudAlm({ accessToken: "test", baseUrl: BASE_URL }, { fetch: fake.fetch });
  const result = await changes(calm, { since }, { now });
  return { ...result, requests: fake.seen.map(s => s.url.searchParams.get("$filter")) };
}

const record = (date: string, testPlan: string, status: string) => ({
  date, projectGUID: PROJECT_ID, testcaseId: "case-1", testPlan, status,
});

test("daily comparison counts only reported case/plan pairs within UTC dates", async () => {
  const r = await query({ value: [
    record("2026-11-17", "UAT", "Failed"), record("2026-11-18", "UAT", "Initial"),
    record("2026-11-18", "UAT", "Initial"), record("2026-11-18", "(None)", "Failed"),
    record("2026-11-18", "SIT", "Failed"), record("2026-11-20", "UAT", "Passed"),
    record("2026-11-21", "UAT", "Failed"),
    { ...record("2026-11-18", "Other", "Failed"), projectGUID: "another-project" },
  ] });
  expect(r.data.testResults).toEqual({
    from: { date: "2026-11-18", total: 2, counts: { "not run": 1, failed: 1 } },
    to: { date: "2026-11-20", total: 1, counts: { passed: 1 } },
  });
  expect(r.data.testHistory.status).toBe("compared");
  expect(r.requests.some(q => q?.includes("period eq 'C3D'"))).toBe(true);
});

test("history distinguishes empty results, denied access, one snapshot and conflicting observations", async () => {
  expect((await query({ value: [] })).data.testHistory.status).toBe("empty");
  expect((await query(new Response(null, { status: 403 }))).data.testHistory.status).toBe("forbidden");
  const r = await query({ value: [record("2026-11-20", "UAT", "Passed"), record("2026-11-20", "UAT", "Failed")] });
  expect(r.data.testHistory.status).toBe("single_day");
  expect(r.data.testResults?.to.counts).toEqual({ unknown: 1 });
  expect(r.text).toContain("Only one daily snapshot");
});

test("a capped history cannot imply exact test movements", async () => {
  const r = await query((url: URL) => ({
    value: url.searchParams.get("$filter")?.includes("'C3D'") ?
      Array.from({ length: 201 }, () => record("2026-11-20", "UAT", "Passed")) : [],
  }));
  expect(r.data.testHistory.status).toBe("partial");
  expect(r.data.testResults).toBeNull();
});

test("future and impossible dates fail before reading changes", async () => {
  for (const since of ["2026-11-21", "2026-02-31", "2026-11-18T99:00Z"])
    await expect(query({ value: [] }, since)).rejects.toThrow("since");
});
