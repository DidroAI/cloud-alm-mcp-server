import assert from "node:assert/strict";
import test from "node:test";
import { createFeedbackIntake, reportFrom } from "../lib/feedback.mjs";

const report = {
  reportId: "11111111-2222-3333-4444-555555555555",
  serverVersion: "0.4.0",
  tool: "calm_list",
  outcome: "recovered",
  observation: "A filter by status was refused and worked on the second try.",
};
const post = (body, headers = {}) =>
  new Request("https://calm.example/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("a well-formed report is passed on with the receiver's token and nothing else", async () => {
  const sent = [];
  const intake = createFeedbackIntake({
    token: "receiver-token",
    deliver: async (url, init) => (sent.push({ url, init }), new Response(null, { status: 204 })),
  });
  assert.equal((await intake(post({ ...report, suggestion: "Say which values are allowed." }))).status, 204);
  assert.equal(sent[0].url, "https://docs.didro.ai/cloud-alm/feedback");
  assert.equal(sent[0].init.headers.Authorization, "Bearer receiver-token");
  assert.deepEqual(JSON.parse(sent[0].init.body), { ...report, suggestion: "Say which values are allowed." });
});

test("anything else is refused and never passed on", async () => {
  let delivered = 0;
  const intake = createFeedbackIntake({ token: "t", deliver: async () => (delivered++, new Response(null, { status: 204 })) });
  assert.equal((await intake(post({ ...report, extra: "x" }))).status, 400);
  assert.equal((await intake(post({ ...report, tool: "rm_rf" }))).status, 400);
  assert.equal((await intake(post({ ...report, observation: "x".repeat(401) }))).status, 400);
  assert.equal((await intake(post("not json"))).status, 400);
  assert.equal((await intake(post(report, { origin: "https://evil.example" }))).status, 415);
  assert.equal((await intake(new Request("https://calm.example/feedback"))).status, 405);
  assert.equal(delivered, 0);
  assert.equal(reportFrom([report]), undefined);
  assert.equal((await createFeedbackIntake({ token: undefined })(post(report))).status, 404);
});

test("one sender and one instance are limited per hour; a failed delivery is reported", async () => {
  let at = 0;
  const intake = createFeedbackIntake({ token: "t", now: () => at, perSender: 2, perInstance: 3, deliver: async () => new Response(null, { status: 204 }) });
  assert.equal((await intake(post(report))).status, 204);
  assert.equal((await intake(post(report))).status, 204);
  assert.equal((await intake(post(report))).status, 429);
  assert.equal((await intake(post(report, { "x-real-ip": "198.51.100.8" }))).status, 204);
  assert.equal((await intake(post(report, { "x-real-ip": "198.51.100.9" }))).status, 429);
  at = 3_600_001;
  assert.equal((await intake(post(report))).status, 204);
  const down = createFeedbackIntake({ token: "t", deliver: async () => new Response(null, { status: 500 }) });
  assert.equal((await down(post(report))).status, 502);
});
