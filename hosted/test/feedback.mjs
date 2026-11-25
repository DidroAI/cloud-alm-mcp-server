import assert from "node:assert/strict";
import test from "node:test";
import { createFeedbackIntake, reportFrom } from "../lib/feedback.mjs";
import { createLimiter } from "../lib/http.mjs";

const report = {
  reportId: "11111111-2222-3333-4444-555555555555",
  serverVersion: "0.4.0",
  tool: "calm_list",
  outcome: "recovered",
  observation: "A filter by status was refused and worked on the second try.",
};
const post = (body, headers = {}) =>
  new Request("https://connector.example/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const keeping = (options = {}) => {
  const kept = [];
  return { kept, intake: createFeedbackIntake({ save: async (r) => void kept.push(r), ...options }) };
};

test("a well-formed report is kept with its fields and nothing else, under an id of ours", async () => {
  const { kept, intake } = keeping();
  assert.equal((await intake(post({ ...report, suggestion: "Say which values are allowed." }))).status, 204);
  const { reportId, ...fields } = kept[0];
  assert.match(reportId, /^[a-f0-9-]{36}$/);
  assert.notEqual(reportId, report.reportId, "the sender does not choose the record");
  const { reportId: _, ...wanted } = { ...report, suggestion: "Say which values are allowed." };
  assert.deepEqual(fields, wanted);
});

test("anything else is refused and never kept", async () => {
  const { kept, intake } = keeping();
  assert.equal((await intake(post({ ...report, extra: "x" }))).status, 400);
  assert.equal((await intake(post({ ...report, tool: "rm_rf" }))).status, 400);
  assert.equal((await intake(post({ ...report, observation: "x".repeat(401) }))).status, 400);
  assert.equal((await intake(post("not json"))).status, 400);
  // What the server refuses before sending, the public address refuses too.
  assert.equal((await intake(post({ ...report, observation: "See https://tenant.example/item for the case." }))).status, 400);
  assert.equal((await intake(post({ ...report, suggestion: "Ask jane.doe@example.com about it." }))).status, 400);
  assert.equal((await intake(post({ ...report, observation: "Record 0a1b2c3d-1111-2222-3333-444455556666 was missing." }))).status, 400);
  // Characters a reader cannot see: control characters and marks that reverse the direction of text.
  assert.equal((await intake(post({ ...report, observation: "A filter was refused\u0000 and then worked." }))).status, 400);
  assert.equal((await intake(post({ ...report, suggestion: "Read this ‮backwards‬ please." }))).status, 400);
  assert.equal((await intake(post({ ...report, observation: "A filter was refused.\nIt worked on the second try." }))).status, 204, "a line break is fine");
  assert.equal((await intake(post(report, { origin: "https://evil.example" }))).status, 415);
  assert.equal((await intake(new Request("https://connector.example/feedback"))).status, 405);
  assert.equal(kept.length, 1);
  assert.equal(reportFrom([report]), undefined);
  // A deployment that keeps no reports has no inbox.
  assert.equal((await createFeedbackIntake({})(post(report))).status, 404);
});

test("one sender and one instance are limited per hour; a failed store is reported", async () => {
  let at = 0;
  const { intake } = keeping({ now: () => at, perSender: 2, perInstance: 3 });
  assert.equal((await intake(post(report))).status, 204);
  assert.equal((await intake(post(report))).status, 204);
  assert.equal((await intake(post(report))).status, 429);
  assert.equal((await intake(post(report, { "x-real-ip": "198.51.100.8" }))).status, 204);
  assert.equal((await intake(post(report, { "x-real-ip": "198.51.100.9" }))).status, 429);
  at = 3_600_001;
  assert.equal((await intake(post(report))).status, 204);
  const down = createFeedbackIntake({ save: async () => { throw new Error("database is away"); } });
  assert.equal((await down(post(report))).status, 502);
});

test("junk and oversized posts use up their sender's limit, not everyone's", async () => {
  const { intake } = keeping({ now: () => 0, perSender: 5, perInstance: 2 });
  for (let i = 0; i < 4; i++) assert.equal((await intake(post("not json", { "x-real-ip": "203.0.113.1" }))).status, 400);
  // Too large to be a report: refused with 413, and the shared allowance is untouched.
  for (let i = 0; i < 4; i++) {
    const big = await intake(post("x".repeat(5000), { "x-real-ip": "203.0.113." + (10 + i) })).catch((thrown) => thrown);
    assert.equal(big.status, 413);
  }
  assert.equal((await intake(post(report, { "x-real-ip": "203.0.113.2" }))).status, 204);
  assert.equal((await intake(post(report, { "x-real-ip": "203.0.113.3" }))).status, 204);
  assert.equal((await intake(post(report, { "x-real-ip": "203.0.113.4" }))).status, 429);
});

test("the table of senders has a ceiling, and old senders are forgotten", async () => {
  let at = 0;
  const { intake } = keeping({ now: () => at, maxSenders: 3, perInstance: 100 });
  for (const n of [1, 2, 3]) assert.equal((await intake(post(report, { "x-real-ip": "192.0.2." + n }))).status, 204);
  assert.equal((await intake(post(report, { "x-real-ip": "192.0.2.4" }))).status, 429, "a new sender waits while the table is full");
  assert.equal((await intake(post(report, { "x-real-ip": "192.0.2.1" }))).status, 204, "a known sender is still served");
  const allow = createLimiter({ max: 1, windowMs: 1000, now: () => at, maxSenders: 2 });
  assert.equal(allow("a"), true);
  assert.equal(allow("b"), true);
  assert.equal(allow("c"), false);
  assert.equal(allow("a"), false);
});

test("the sign-in limiter allows a few requests per sender in its window", () => {
  let at = 0;
  const allow = createLimiter({ max: 2, windowMs: 1000, now: () => at });
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true);
  at = 1001;
  assert.equal(allow("a"), true);
});
