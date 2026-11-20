import { expect, test } from "bun:test";
import { CloudAlm } from "../src/calm/index.js";
import { analytics } from "../src/views/tools.js";
import { BASE_URL, fakeCloudAlm, PROJECT_ID, TENANT } from "./tenant.js";

const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";

function reader(rows: unknown[] = []) {
  const fake = fakeCloudAlm({
    ...TENANT,
    "calm-analytics/v1/odata/v4/analytics/Tests": { value: rows },
  });
  const calm = new CloudAlm({ accessToken: "test", baseUrl: BASE_URL }, { fetch: fake.fetch });
  return { calm, requests: fake.seen };
}

test("project job failures cannot silently become tenant-wide counts", async () => {
  const { calm, requests } = reader();
  for (const selection of [{ projectId: PROJECT_ID }, { filters: { ProjectGUID: PROJECT_ID } }]) {
    await expect(analytics(calm, { dataset: "Jobs", ...selection })).rejects.toThrow("tenant-wide");
  }
  expect(requests).toHaveLength(0);
});

test("project counts require verifiable project ids on nonempty SAP results", async () => {
  const { calm } = reader([{ date: "2026-11-20", status: "Failed", total: 22 }]);
  await expect(analytics(calm, { dataset: "Tests", projectId: PROJECT_ID })).rejects.toThrow("cannot be verified");
});

test("conflicting project selectors never replace the requested project", async () => {
  const { calm, requests } = reader();
  await expect(analytics(calm, {
    dataset: "Tests", projectId: PROJECT_ID, filters: { projectGUID: OTHER },
  })).rejects.toThrow("Conflicting project filters");
  expect(requests.some(r => r.url.pathname.endsWith("/Tests"))).toBe(false);
});

test("project aliases filter locally before grouping or suggesting other statuses", async () => {
  const { calm } = reader([
    { date: "2026-11-20", projectGUID: PROJECT_ID, status: "Passed", total: 3 },
    { date: "2026-11-20", projectGUID: OTHER, status: "OtherTenantStatus", total: 99 },
  ]);
  const picked = await analytics(calm, { dataset: "Tests", filters: { ProjectID: PROJECT_ID }, groupBy: ["status"] });
  expect(picked.data).toMatchObject({ groups: [{ key: { status: "passed" }, values: { total: 3 } }] });
  const noFailures = await analytics(calm, {
    dataset: "Tests", projectId: "Rollout Example", filters: { projectGUID: PROJECT_ID, status: "Failed" },
  });
  expect(noFailures.data).toMatchObject({ outcome: "empty", rows: [] });
  expect(noFailures.text).not.toContain("OtherTenantStatus");
});

test("a page containing only other projects cannot produce totals for the requested project", async () => {
  const { calm } = reader([{ projectGUID: OTHER, date: "2026-11-20", status: "Passed", total: 99 }]);
  const result = await analytics(calm, { dataset: "Tests", projectId: PROJECT_ID });
  expect(result.data).toMatchObject({ outcome: "empty", rows: [] });
  expect(result.text).not.toContain(OTHER);
});
