/** What went wrong, in a form a caller can branch on. */
export type CloudAlmErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "bad_request";

const DEFAULT_REASONS: Record<CloudAlmErrorCode, string> = {
  unauthorized: "no valid token for SAP Cloud ALM",
  forbidden: "the token lacks the scope for this call",
  not_found: "not found",
  rate_limited: "SAP Cloud ALM is rate limiting requests; try again shortly",
  unavailable: "SAP Cloud ALM did not answer usably",
  bad_request: "SAP Cloud ALM rejected the request",
};

/** Long enough for the server's own guidance (a list of projects to pick from). */
const MAX_REASON = 1500;
/** What SAP's own messages are cut to. */
export const MAX_PROVIDER_REASON = 200;

/**
 * Shorten a provider's message to one safe line. Anything that looks like a
 * token (a JWT or a long opaque string) is removed, so an echoed header can
 * never travel further in an error.
 */
export function cleanReason(text: string, max = MAX_REASON): string {
  const line = text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[redacted]")
    .replace(/[A-Za-z0-9+/_=-]{60,}/g, "[redacted]")
    // Control characters and line breaks become single spaces.
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The one error type of this library. `reason` is short, plain and never
 * carries a token, a secret or a raw response body.
 */
export class CloudAlmError extends Error {
  override readonly name = "CloudAlmError";
  readonly reason: string;
  constructor(
    readonly code: CloudAlmErrorCode,
    reason?: string,
    /** The HTTP status that caused it, when there was one. */
    readonly status?: number,
  ) {
    const text = reason ? cleanReason(reason) : DEFAULT_REASONS[code];
    super(`${code}: ${text}`);
    this.reason = text;
  }
}
