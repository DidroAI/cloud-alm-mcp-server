/**
 * The opt-in writer: POST to a short list of Cloud ALM endpoints that create
 * or link, never delete. It is separate from the reader, which stays
 * GET-only. Writes are never retried (a repeated POST could create twice).
 */
import { CloudAlmError } from "./errors.js";
import {
  apiRoot,
  type CloudAlmOptions,
  type GrantSource,
  readAnswer,
} from "./transport.js";

const GUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** The only paths the writer posts to. */
const WRITE_PATHS = [
  new RegExp("^calm-testmanagement/v1/ManualTestCases$"),
  new RegExp("^calm-testmanagement/v1/TaskAssignments$"),
  new RegExp("^calm-tasks/v1/tasks$"),
  new RegExp("^calm-tasks/v1/tasks/updateTags$"),
  new RegExp(`^calm-tasks/v1/tasks/${GUID}/featureAssignments$`),
];

export type WriteRecord = { path: string; body: unknown };

export class CloudAlmWriter {
  /** Every write sent (or, in a dry run, planned), in order. */
  readonly log: WriteRecord[] = [];

  constructor(
    private readonly grant: GrantSource,
    private readonly options: CloudAlmOptions = {},
  ) {}

  async post(path: string, body: unknown): Promise<unknown> {
    if (!WRITE_PATHS.some((p) => p.test(path)))
      throw new CloudAlmError("bad_request", "not a path this writer may post to");
    const grant = typeof this.grant === "function" ? await this.grant() : this.grant;
    const root = apiRoot(grant.baseUrl, this.options.hostPattern);
    this.log.push({ path, body });
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${root}/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${grant.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch {
      throw new CloudAlmError("unavailable", "network error");
    }
    if (response.status >= 200 && response.status < 300) {
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    }
    return readAnswer(response);
  }
}
