import { CloudAlmError } from "./errors.js";
import type { Grant } from "./transport.js";

/**
 * The parts of a Cloud ALM API service key (a BTP service binding) this
 * library uses. The key JSON has more; the rest is ignored.
 */
export type ServiceKey = {
  uaa: { url: string; clientid: string; clientsecret: string };
  endpoints: { Api: string };
};

/** Check a parsed service key's shape. Never echoes its values. */
export function parseServiceKey(value: unknown): ServiceKey {
  const key = value as {
    uaa?: Record<string, unknown>;
    endpoints?: Record<string, unknown>;
  } | null;
  const uaa = key?.uaa;
  const api = key?.endpoints?.Api ?? key?.endpoints?.api;
  if (
    !uaa ||
    typeof uaa.url !== "string" ||
    typeof uaa.clientid !== "string" ||
    typeof uaa.clientsecret !== "string" ||
    typeof api !== "string"
  )
    throw new CloudAlmError(
      "bad_request",
      "not a Cloud ALM service key: needs uaa.url, uaa.clientid, uaa.clientsecret and endpoints.Api",
    );
  return {
    uaa: {
      url: uaa.url,
      clientid: uaa.clientid,
      clientsecret: uaa.clientsecret,
    },
    endpoints: { Api: api },
  };
}

export type ClientCredentialsOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  /** Wait before the second try; the third waits three times as long. Default 400 ms. */
  retryDelayMs?: number;
};

/**
 * Get a grant from a service key with the OAuth client credentials grant.
 * For standalone use; a hosted caller gets grants from its own broker. The
 * token is returned, never logged; the secret leaves only in the request.
 */
export async function clientCredentials(
  serviceKey: ServiceKey,
  options: ClientCredentialsOptions = {},
): Promise<Grant> {
  const key = parseServiceKey(serviceKey);
  const now = options.now ?? Date.now;
  let tokenUrl: URL;
  try {
    tokenUrl = new URL(`${key.uaa.url.replace(/\/+$/, "")}/oauth/token`);
  } catch {
    throw new CloudAlmError("bad_request", "uaa.url is not a URL");
  }
  if (tokenUrl.protocol !== "https:" || tokenUrl.username || tokenUrl.password)
    throw new CloudAlmError("bad_request", "uaa.url must be https");
  // XSUAA takes the id and secret as they are (ids contain `!` and `|`).
  const basic = Buffer.from(
    `${key.uaa.clientid}:${key.uaa.clientsecret}`,
  ).toString("base64");
  let response: Response | undefined;
  // SAP's token endpoint answers 5xx now and then: try three times.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, (options.retryDelayMs ?? 400) * 3 ** (attempt - 1)));
    try {
      response = await (options.fetch ?? fetch)(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      response = undefined;
      continue;
    }
    if (response.status < 500) break;
  }
  if (!response) throw new CloudAlmError("unavailable", "the SAP token endpoint did not answer; try again in a minute");
  if (response.status === 401 || response.status === 400)
    throw new CloudAlmError(
      "unauthorized",
      "the token endpoint refused the service key",
      response.status,
    );
  if (!response.ok)
    throw new CloudAlmError(
      "unavailable",
      `the SAP token endpoint answered ${response.status} three times; try again in a minute`,
      response.status,
    );
  let body: { access_token?: unknown; expires_in?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new CloudAlmError("unavailable", "token answer is not JSON");
  }
  if (typeof body.access_token !== "string" || !body.access_token)
    throw new CloudAlmError("unavailable", "token answer has no access_token");
  const seconds =
    typeof body.expires_in === "number" && body.expires_in > 0
      ? body.expires_in
      : 3600;
  return {
    accessToken: body.access_token,
    baseUrl: key.endpoints.Api,
    expiresAt: now() + seconds * 1000,
  };
}

/**
 * A `getGrant` callback over a service key that reuses its token until a
 * minute before expiry. Concurrent callers share one token request.
 */
export function serviceKeyGrants(
  serviceKey: ServiceKey,
  options: ClientCredentialsOptions = {},
): () => Promise<Grant> {
  const now = options.now ?? Date.now;
  let current: Grant | undefined;
  let pending: Promise<Grant> | undefined;
  return async () => {
    if (current?.expiresAt && current.expiresAt - now() > 60_000)
      return current;
    pending ??= clientCredentials(serviceKey, options).finally(() => {
      pending = undefined;
    });
    current = await pending;
    return current;
  };
}
