import { randomUUID } from "node:crypto";
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
      signal: AbortSignal.timeout(3000),
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ reportId, serverVersion: version, ...feedback }),
    });
    // A receiver's body may contain private or untrusted text. Only its status is relevant.
    await response.body?.cancel();
    if (!response.ok) throw new Error("Feedback receipt was not confirmed.");
    return reportId;
  };
}
