import { json, limited } from "./http.mjs";

const RECEIVER = "https://docs.didro.ai/cloud-alm/feedback";
const HOUR = 3_600_000;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const VERSION = /^\d+\.\d+\.\d+[a-z0-9.-]{0,40}$/i;
const TOOL = /^calm_[a-z_]{1,50}$/;
const OUTCOMES = new Set(["blocked", "recovered", "completed_with_extra_work"]);
const text = (value, min, max) => typeof value === "string" && value.trim().length >= min && value.length <= max;

/** The report's fields, or undefined when it is not one. Nothing else is passed on. */
export function reportFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { reportId, serverVersion, tool, outcome, observation, suggestion, ...rest } = value;
  if (Object.keys(rest).length) return undefined;
  if (typeof reportId !== "string" || !UUID.test(reportId)) return undefined;
  if (typeof serverVersion !== "string" || !VERSION.test(serverVersion)) return undefined;
  if (typeof tool !== "string" || !TOOL.test(tool) || !OUTCOMES.has(outcome)) return undefined;
  if (!text(observation, 8, 400) || (suggestion !== undefined && !text(suggestion, 3, 240))) return undefined;
  return { reportId, serverVersion, tool, outcome, observation, ...(suggestion === undefined ? {} : { suggestion }) };
}

/**
 * The public inbox for local installations: `cloud-alm-mcp-server` on a
 * user's computer posts its agent's reports here, without a credential.
 * Only a well-formed report is passed on, with the receiver's token, which
 * never leaves this service. Limits are per running instance: a first line
 * against a flood, next to the receiver's own bounded insert.
 */
export function createFeedbackIntake({ token, deliver = fetch, now = Date.now, perSender = 20, perInstance = 300 }) {
  const senders = new Map();
  let all = [];
  const fresh = (times, at) => times.filter((t) => at - t < HOUR);
  return async (req) => {
    if (!token) return json({ error: "not_found" }, 404);
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    // A server sends these, not a web page.
    if (req.headers.get("origin") || !req.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "unsupported" }, 415);
    const at = now();
    const sender = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const mine = fresh(senders.get(sender) ?? [], at);
    all = fresh(all, at);
    if (mine.length >= perSender || all.length >= perInstance) return json({ error: "slow_down" }, 429, { "retry-after": "3600" });
    mine.push(at);
    all.push(at);
    senders.set(sender, mine);
    if (senders.size > 5000) for (const [key, times] of senders) if (!fresh(times, at).length) senders.delete(key);
    let report;
    try {
      report = reportFrom(JSON.parse((await limited(req, 4096)).toString("utf8")));
    } catch (error) {
      if (error instanceof Response) throw error;
    }
    if (!report) return json({ error: "invalid_report" }, 400);
    const response = await deliver(RECEIVER, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(report),
    });
    await response.body?.cancel();
    return response.ok ? new Response(null, { status: 204 }) : json({ error: "not_delivered" }, 502);
  };
}
