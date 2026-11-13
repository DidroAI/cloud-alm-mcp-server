import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/**
 * Adapt a web-standard `(Request) => Promise<Response>` handler to Node's
 * `http.createServer` listener, so the server runs on plain Node.
 */
export function toNodeListener(
  handler: (request: Request) => Promise<Response>,
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value))
          for (const v of value) headers.append(name, v);
        else if (value !== undefined) headers.set(name, value);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(url, {
        method: req.method ?? "GET",
        headers,
        ...(hasBody
          ? {
              body: Readable.toWeb(req) as unknown as ReadableStream,
              duplex: "half",
            }
          : {}),
      } as RequestInit);
      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      if (response.body)
        Readable.fromWeb(
          response.body as unknown as import("node:stream/web").ReadableStream,
        ).pipe(res);
      else res.end();
    } catch {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  };
}
