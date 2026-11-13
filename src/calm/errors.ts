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
  forbidden: "the token lacks the scope for this read",
  not_found: "not found",
  rate_limited: "SAP Cloud ALM is rate limiting requests; try again shortly",
  unavailable: "SAP Cloud ALM did not answer usably",
  bad_request: "SAP Cloud ALM rejected the request",
};

const MAX_REASON = 200;

/**
 * Shorten a provider's message to one safe line. Anything that looks like a
 * token (a JWT or a long opaque string) is removed, so an echoed header can
 * never travel further in an error.
 */
export function cleanReason(text: string): string {
  const line = text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[redacted]")
    .replace(/[A-Za-z0-9+/_=-]{60,}/g, "[redacted]")
    // Control characters and line breaks become single spaces.
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  return line.length > MAX_REASON ? `${line.slice(0, MAX_REASON - 1)}…` : line;
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
