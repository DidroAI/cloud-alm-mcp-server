/**
 * The opt-in writer: POST, PATCH and DELETE to a fixed list of Cloud ALM
 * endpoints, each allowed for one method only. It is separate from the
 * reader, which stays GET-only. Writes are never retried (a repeated POST
 * could create twice, a repeated DELETE could hit something else).
 */
import { CloudAlmError } from "./errors.js";
import {
  apiRoot,
  type CloudAlmOptions,
  type GrantSource,
  readAnswer,
} from "./transport.js";

const GUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const path = (p: string) => new RegExp(`^${p.replaceAll("{id}", GUID)}$`);

export type WriteMethod = "POST" | "PATCH" | "DELETE";

/** The only (method, path) pairs the writer sends. */
const ALLOWED: Record<WriteMethod, RegExp[]> = {
  POST: [
    path("calm-tasks/v1/tasks"),
    path("calm-tasks/v1/tasks/updateTags"),
    path("calm-tasks/v1/tasks/{id}/featureAssignments"),
    path("calm-tasks/v1/tasks/{id}/documentAssignments"),
    path("calm-tasks/v1/tasks/{id}/relations"),
    path("calm-tasks/v1/tasks/{id}/comments"),
    path("calm-features/v1/Features"),
    path("calm-documents/v1/Documents"),
    path("calm-testmanagement/v1/ManualTestCases"),
    path("calm-testmanagement/v1/ManualTestCases/{id}/api.v1.ExternalTestCaseServiceAPI.forceDeletionIncludingTestRunsAndResults"),
    path("calm-testmanagement/v1/TaskAssignments"),
    path("calm-testmanagement/v1/Activities"),
    path("calm-testmanagement/v1/Actions"),
  ],
  PATCH: [
    path("calm-tasks/v1/tasks/{id}"),
    path("calm-features/v1/Features/{id}"),
    path("calm-testmanagement/v1/ManualTestCases/{id}"),
  ],
  DELETE: [
    path("calm-tasks/v1/tasks/{id}"),
    path("calm-tasks/v1/tasks/relations/{id}"),
    path("calm-tasks/v1/tasks/featureAssignments/{id}"),
    path("calm-tasks/v1/tasks/documentAssignments/{id}"),
    path("calm-testmanagement/v1/ManualTestCases/{id}"),
    path("calm-testmanagement/v1/TaskAssignments/{id}"),
    path("calm-documents/v1/Documents/{id}"),
  ],
};

export type WriteRecord = { method: WriteMethod; path: string; body: unknown };

export class CloudAlmWriter {
  /** The last 50 writes sent, in order. */
  readonly log: WriteRecord[] = [];

  constructor(
    private readonly grant: GrantSource,
    private readonly options: CloudAlmOptions = {},
  ) {}

  post(path: string, body: unknown, options: { ifMatch?: string } = {}): Promise<unknown> {
    return this.send("POST", path, body, options.ifMatch);
  }

  /** Partial update; `ifMatch` is the entity's ETag where Cloud ALM wants one. */
  patch(path: string, body: unknown, options: { ifMatch?: string } = {}): Promise<unknown> {
    return this.send("PATCH", path, body, options.ifMatch);
  }

  delete(path: string, options: { ifMatch?: string } = {}): Promise<unknown> {
    return this.send("DELETE", path, undefined, options.ifMatch);
  }

  private async send(method: WriteMethod, path: string, body: unknown, ifMatch?: string): Promise<unknown> {
    if (!ALLOWED[method].some((p) => p.test(path)))
      throw new CloudAlmError("bad_request", `not a path this writer may send ${method} to`);
    if (ifMatch !== undefined && !/^(W\/)?"[^"\r\n]{1,100}"$|^\*$/.test(ifMatch))
      throw new CloudAlmError("bad_request", "not a usable ETag");
    const grant = typeof this.grant === "function" ? await this.grant() : this.grant;
    const root = apiRoot(grant.baseUrl, this.options.hostPattern);
    this.log.push({ method, path, body });
    if (this.log.length > 50) this.log.shift();
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${root}/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${grant.accessToken}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(ifMatch ? { "If-Match": ifMatch } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      // A timeout after sending may still have written: say so.
      if ((error as Error)?.name === "TimeoutError")
        throw new CloudAlmError("unavailable", "no answer in time; the change may or may not have been made: read the item before trying again");
      throw new CloudAlmError("unavailable", "network error; nothing was sent");
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
