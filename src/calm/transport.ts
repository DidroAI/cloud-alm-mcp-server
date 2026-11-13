import { CloudAlmError } from "./errors.js";

/**
 * A bearer token and the Cloud ALM API it is for. `baseUrl` is the API root
 * from the service key (`endpoints.Api`), e.g. `https://eu20.alm.cloud.sap/api`.
 * The shape matches a credential broker's `{ accessToken, baseUrl, expiresAt }`.
 */
export type Grant = {
  accessToken: string;
  baseUrl: string;
  /** Milliseconds since the epoch. A token within 30 s of it is not sent. */
  expiresAt?: number;
};

/** A grant, or a callback that supplies one (called once per operation). */
export type GrantSource = Grant | (() => Grant | Promise<Grant>);

export type CloudAlmOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Whole-operation deadline. Default 30 seconds. */
  timeoutMs?: number;
  /**
   * Hosts a token may be sent to. Default: `*.alm.cloud.sap`. Change it only
   * for a test double or an SAP sandbox you trust.
   */
  hostPattern?: RegExp;
};

export const DEFAULT_HOST_PATTERN = /(^|\.)alm\.cloud\.sap$/i;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
/** Requests one operation may make, retries included. */
const REQUEST_BUDGET = 40;
const MAX_RETRIES = 2;
const MAX_WAIT_MS = 5_000;
const EXPIRY_MARGIN_MS = 30_000;

export type Query = Record<string, string | number | boolean | undefined>;

/** Check a grant's base URL and return it without a trailing slash. */
export function apiRoot(
  baseUrl: string,
  hostPattern: RegExp = DEFAULT_HOST_PATTERN,
): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CloudAlmError("bad_request", "baseUrl is not a URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hostPattern.test(url.hostname)
  )
    throw new CloudAlmError(
      "bad_request",
      "baseUrl must be an https Cloud ALM API address",
    );
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Query keys go in verbatim (Cloud ALM's process services want a literal
 * `$top`, not `%24top`); values are percent-encoded.
 */
export function queryString(query: Query = {}): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (!/^\$?[A-Za-z][A-Za-z0-9]*$/.test(key))
      throw new CloudAlmError("bad_request", `bad query key ${key}`);
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/** The provider's own explanation of an error, from any of its shapes. */
export function providerMessage(body: unknown): string | undefined {
  const first = Array.isArray(body) ? body[0] : body;
  if (!first || typeof first !== "object") return undefined;
  const record = first as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  for (const key of ["message", "details", "error"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

async function boundedText(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new CloudAlmError("unavailable", "answer too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > limit)
        throw new CloudAlmError("unavailable", "answer too large");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One operation's connection to Cloud ALM: GET only, one API root, no
 * redirects, a deadline and a request budget. The token stays inside.
 */
export class Session {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly abort = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private remaining = REQUEST_BUDGET;
  readonly root: string;

  constructor(
    private readonly grant: Grant,
    options: CloudAlmOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const now = options.now ?? Date.now;
    const { accessToken, expiresAt } = grant;
    if (
      typeof accessToken !== "string" ||
      !accessToken ||
      accessToken.length > 32_768 ||
      /\s/.test(accessToken)
    )
      throw new CloudAlmError("unauthorized");
    if (
      expiresAt !== undefined &&
      (!Number.isFinite(expiresAt) || expiresAt <= now() + EXPIRY_MARGIN_MS)
    )
      throw new CloudAlmError("unauthorized", "the token has expired");
    this.root = apiRoot(grant.baseUrl, options.hostPattern);
    this.timer = setTimeout(
      () => this.abort.abort(),
      options.timeoutMs ?? 30_000,
    );
  }

  close() {
    clearTimeout(this.timer);
    this.abort.abort();
  }

  /**
   * GET `path` (relative to the API root, built by this library from fixed
   * service names and validated ids) and return the parsed JSON.
   */
  async get(path: string, query?: Query): Promise<unknown> {
    if (!/^[A-Za-z0-9_\-/]+$/.test(path) || path.startsWith("/"))
      throw new CloudAlmError("bad_request", "bad path");
    const url = `${this.root}/${path}${queryString(query)}`;
    for (let attempt = 0; ; attempt++) {
      if (--this.remaining < 0 || this.abort.signal.aborted)
        throw new CloudAlmError("unavailable", "took too long");
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.grant.accessToken}`,
            Accept: "application/json",
          },
          redirect: "manual",
          signal: this.abort.signal,
        });
      } catch {
        throw new CloudAlmError(
          "unavailable",
          this.abort.signal.aborted ? "took too long" : "network error",
        );
      }
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await response.body?.cancel().catch(() => undefined);
        const header = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(header) && header > 0 ? header * 1000 : 0;
        const backoff = Math.max(wait, 500 * 2 ** attempt);
        if (backoff > MAX_WAIT_MS) throw new CloudAlmError("rate_limited");
        await this.sleep(backoff);
        continue;
      }
      return this.read(response);
    }
  }

  private async read(response: Response): Promise<unknown> {
    const { status } = response;
    if (status >= 200 && status < 300) {
      const body = parseJson(await boundedText(response, MAX_BODY_BYTES));
      if (body === undefined)
        throw new CloudAlmError("unavailable", "answer is not JSON", status);
      return body;
    }
    let message: string | undefined;
    try {
      message = providerMessage(
        parseJson(await boundedText(response, MAX_ERROR_BYTES)),
      );
    } catch {
      message = undefined;
    }
    if (status === 400 || status === 422 || status === 428)
      throw new CloudAlmError("bad_request", message, status);
    if (status === 401)
      throw new CloudAlmError("unauthorized", undefined, status);
    if (status === 403)
      throw new CloudAlmError(
        "forbidden",
        message
          ? `the token lacks the scope for this read (${message})`
          : undefined,
        status,
      );
    if (status === 404 || status === 410)
      throw new CloudAlmError("not_found", message, status);
    if (status === 429)
      throw new CloudAlmError("rate_limited", undefined, status);
    if (status >= 300 && status < 400)
      throw new CloudAlmError("unavailable", "unexpected redirect", status);
    throw new CloudAlmError(
      "unavailable",
      message
        ? `SAP Cloud ALM error ${status}: ${message}`
        : `SAP Cloud ALM error ${status}`,
      status,
    );
  }
}

/** Resolve the grant, run one operation in its own session, close it. */
export async function withSession<T>(
  source: GrantSource,
  options: CloudAlmOptions,
  run: (session: Session) => Promise<T>,
): Promise<T> {
  const grant = typeof source === "function" ? await source() : source;
  const session = new Session(grant, options);
  try {
    return await run(session);
  } finally {
    session.close();
  }
}
