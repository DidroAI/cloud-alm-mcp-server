import { randomUUID } from "node:crypto";
import { json, limited, senderOf } from "./http.mjs";

const HOUR = 3_600_000;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const VERSION = /^\d+\.\d+\.\d+[a-z0-9.-]{0,40}$/i;
const TOOL = /^calm_[a-z_]{1,50}$/;
const OUTCOMES = new Set(["blocked", "recovered", "completed_with_extra_work"]);
// The same check the server applies before it sends: links, e-mail addresses, bearer tokens, GUIDs and
// characters a reader cannot see (control and direction marks) are refused.
const PRIVATE = /https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+|\bBearer\s+\S+|\bclient[_-]?secret\b|\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/i;
const UNSEEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/;
const text = (value, min, max) => typeof value === "string" && value.trim().length >= min && value.length <= max && !PRIVATE.test(value) && !UNSEEN.test(value);

/** The report's fields, or undefined when it is not one. Nothing else is kept. */
export function reportFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { reportId, serverVersion, tool, outcome, observation, suggestion, ...rest } = value;
  if (Object.keys(rest).length) return undefined;
  if (typeof reportId !== "string" || !UUID.test(reportId)) return undefined;
  if (typeof serverVersion !== "string" || !VERSION.test(serverVersion)) return undefined;
  if (typeof tool !== "string" || !TOOL.test(tool) || !OUTCOMES.has(outcome)) return undefined;
  if (!text(observation, 8, 400) || (suggestion !== undefined && !text(suggestion, 3, 240))) return undefined;
  // The id kept is ours: a sender cannot choose which record it writes.
  return { reportId: randomUUID(), serverVersion, tool, outcome, observation, ...(suggestion === undefined ? {} : { suggestion }) };
}

/**
 * The public inbox for local installations: `cloud-alm-mcp-server` on a
 * user's computer posts its agent's reports here, without a credential.
 * Only a well-formed report is kept, under an id of ours, by `save`; without
 * `save` there is no inbox. Limits are per running instance: a first line
 * against a flood, next to the store's own bounded insert.
 */
export function createFeedbackIntake({ save, note, now = Date.now, perSender = 20, perInstance = 300, maxSenders = 20_000 }) {
  const senders = new Map();
  let all = [];
  let swept = 0;
  const fresh = (times, at) => times.filter((t) => at - t < HOUR);
  return async (req) => {
    if (!save) return json({ error: "not_found" }, 404);
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    // A server sends these, not a web page.
    if (req.headers.get("origin") || !req.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "unsupported" }, 415);
    const at = now();
    const sender = senderOf(req);
    const mine = fresh(senders.get(sender) ?? [], at);
    all = fresh(all, at);
    // A sender not seen before is turned away while the table of senders is full.
    if (mine.length >= perSender || all.length >= perInstance || (!senders.has(sender) && senders.size >= maxSenders)) {
      note?.({ kind: "report", outcome: "limited" });
      return json({ error: "slow_down" }, 429, { "retry-after": "3600" });
    }
    // Every attempt counts against its sender; only reports that are kept count against everyone.
    mine.push(at);
    all.push(at);
    senders.set(sender, mine);
    // Forget senders whose hour has passed, a few times an hour at most: not on every request.
    if (senders.size > 5000 && at - swept > HOUR / 10) {
      swept = at;
      for (const [key, times] of senders) if (!fresh(times, at).length) senders.delete(key);
    }
    const giveBack = () => void all.splice(all.lastIndexOf(at), 1);
    let report;
    try {
      report = reportFrom(JSON.parse((await limited(req, 4096)).toString("utf8")));
    } catch (error) {
      // Too large, or no body: refused, and it does not use up everyone's allowance either.
      if (error instanceof Response) {
        giveBack();
        note?.({ kind: "report", outcome: "invalid" });
        throw error;
      }
    }
    if (!report) {
      giveBack();
      note?.({ kind: "report", outcome: "invalid" });
      return json({ error: "invalid_report" }, 400);
    }
    const stored = await save(report).then(() => true, () => false);
    note?.({ kind: "report", outcome: stored ? "accepted" : "not_delivered" });
    return stored ? new Response(null, { status: 204 }) : json({ error: "not_delivered" }, 502);
  };
}
