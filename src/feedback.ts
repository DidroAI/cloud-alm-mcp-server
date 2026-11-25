import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const FEEDBACK_TOOL = "calm_report_feedback";

// Catch common copy/paste mistakes. Product terms can still include private names.
const privateText = /https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+|\bBearer\s+\S+|\bclient[_-]?secret\b|\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/i;
const generalText = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum)
  .refine(text => !privateText.test(text), "Describe tool behavior without URLs, email addresses, credentials or record IDs.");

/** The receiver only gets these fields and a server-assigned version and report ID. */
export const feedbackSchema = (tools: readonly [string, ...string[]]) => z.strictObject({
  tool: z.enum(tools).describe("Tool involved in the observation"),
  outcome: z.enum(["blocked", "recovered", "completed_with_extra_work"]),
  observation: generalText(8, 400).describe("What you expected and observed. Describe tool behavior in generic words."),
  suggestion: generalText(3, 240).optional().describe("A concrete improvement or workaround"),
});

type Feedback = z.infer<ReturnType<typeof feedbackSchema>>;
export type FeedbackSink = (feedback: Feedback, version: string) => Promise<string>;

/** Configuration belongs to the operator. Requests, models and tenant data cannot choose where a report goes. */
export function feedbackSinkFromEnv(env: Record<string, string | undefined>): FeedbackSink | undefined {
  if (!env.CALM_FEEDBACK_URL) return undefined;
  const receiver = URL.canParse(env.CALM_FEEDBACK_URL) ? new URL(env.CALM_FEEDBACK_URL) : undefined;
  const local = receiver && ["localhost", "127.0.0.1", "[::1]"].includes(receiver.hostname);
  if (!receiver || !(receiver.protocol === "https:" || (receiver.protocol === "http:" && local))
      || receiver.username || receiver.password || receiver.search || receiver.hash)
    throw new Error("CALM_FEEDBACK_URL must be an HTTPS endpoint (or loopback HTTP), without credentials, query or fragment.");
  const token = env.CALM_FEEDBACK_TOKEN;
  return async (feedback, version) => {
    const reportId = randomUUID();
    const response = await fetch(receiver, {
      method: "POST",
      redirect: "error",
      // Long enough for the receiver to wake from idle.
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ reportId, serverVersion: version, ...feedback }),
    });
    // A receiver's body may contain private or untrusted text. Only its status is relevant.
    await response.body?.cancel();
    if (!response.ok) throw new Error("Feedback receipt was not confirmed.");
    return reportId;
  };
}

/** Didro's public inbox for local installations. It takes a report's fields and nothing else. */
export const DIDRO_FEEDBACK_URL = "https://docs.didro.ai/cloud-alm/feedback";
/** `CALM_FEEDBACK=off` turns reports off for one client's configuration. */
export const FEEDBACK_ENV = "CALM_FEEDBACK";
/** Present in the config directory when the user turned reports off (`feedback off`). */
export const FEEDBACK_OFF_FILE = "feedback-off";

/** Reports one running local server sends at most. */
export const MAX_REPORTS = 10;

type Env = Record<string, string | undefined>;

/** Where a local installation's reports go, and why. */
export function localFeedback(env: Env, configDir: string): { on: boolean; detail: string; url?: string } {
  // Anything but a plain yes turns reports off: a typo must not leave them on.
  // A placeholder the app left unfilled ("${user_config.send_reports}") counts as not set.
  const given = env[FEEDBACK_ENV]?.trim() ?? "";
  const wanted = given.startsWith("${") ? "" : given;
  if (wanted && !/^(on|1|true|yes)$/i.test(wanted))
    return { on: false, detail: `off (${FEEDBACK_ENV}=${wanted.slice(0, 20)})` };
  if (existsSync(join(configDir, FEEDBACK_OFF_FILE))) return { on: false, detail: "off (turned off with `feedback off`)" };
  if (env.CALM_FEEDBACK_URL) return { on: true, detail: "on, to the receiver in CALM_FEEDBACK_URL", url: env.CALM_FEEDBACK_URL };
  return { on: true, detail: "on, to Didro (no records, credentials or chat text)", url: DIDRO_FEEDBACK_URL };
}

/** The sink of a local installation: Didro's inbox unless turned off or sent elsewhere. */
export function localFeedbackSink(env: Env, configDir: string): FeedbackSink | undefined {
  const { on, url } = localFeedback(env, configDir);
  if (!on || !url) return undefined;
  // The receiver token belongs to a receiver the operator named, never to Didro's inbox.
  const send = feedbackSinkFromEnv({ CALM_FEEDBACK_URL: url, ...(env.CALM_FEEDBACK_URL ? { CALM_FEEDBACK_TOKEN: env.CALM_FEEDBACK_TOKEN } : {}) });
  if (!send) return undefined;
  // One running server reports a handful of observations, not a stream of them.
  let sent = 0;
  return async (feedback, version) => {
    if (sent >= MAX_REPORTS) throw new Error("Enough reports for this session.");
    sent++;
    return send(feedback, version);
  };
}

/** Remember the user's choice for every client on this computer. */
export function setLocalFeedback(on: boolean, configDir: string) {
  const file = join(configDir, FEEDBACK_OFF_FILE);
  if (on) rmSync(file, { force: true });
  else {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(file, "Agent feedback reports are off. Delete this file, or run `feedback on`, to turn them on.\n");
  }
}
