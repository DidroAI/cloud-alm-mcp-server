# Hosted connector

A read-only OAuth connector for ChatGPT and Claude over the published Cloud ALM MCP server. A user adds its address in the app, signs in in the browser with a BTP service key, and gets a read-only session of up to one hour. Didro's hosted connector, at https://docs.didro.ai/cloud-alm/connect/mcp, is this code mounted in the docs site.

## Running it

The folder can run on its own, or be mounted in another site.

**On its own.** Deploy this directory as its own Vercel project with Node 24. The default export of `api/connect.mjs` is the entry point; `vercel.json` sends `/mcp`, `/oauth/…`, `/feedback` and the discovery documents (`/.well-known/…`) to it, and `public/` holds the home page (open it for browser setup) and the files of the sign-in page. Create a dedicated PostgreSQL database on Neon and apply `schema.sql`: the entry point uses Neon's HTTP driver (`@neondatabase/serverless`). Set these, separately for each deployment environment:

| Variable | Value |
| --- | --- |
| `CONNECT_ORIGIN` | The canonical HTTPS origin, without a trailing slash |
| `CONNECT_KEY` | A secret random 32-byte value in hex (64 characters, lower case) |
| `DATABASE_URL` | The Neon database, with a runtime role that has SELECT, INSERT, UPDATE and DELETE on `connections` |
| `CONNECT_BASE` | Optional: a path the connector's own addresses start with. The rewrites in `vercel.json` and the files of `public/` must then move under that path, and `public/index.html` assumes the root |

`package.json` names the version of `cloud-alm-mcp-server` such a deployment serves. To serve a newer one, change it, update `package-lock.json` (`npm install`) and deploy again.

**Mounted in another site** (what Didro does). Import `createGateway` from `api/connect.mjs` and hand it the site's requests:

```js
const gateway = createGateway({ origin, base, sql, exchange, reader, record, reports });
const response = await gateway(request);
```

| Option | Meaning |
| --- | --- |
| `origin` | The site's canonical HTTPS origin. The discovery documents stay at its root |
| `base` | The path everything else moves under, for example `/cloud-alm/connect`. Empty when the connector has the origin to itself |
| `sql` | The session table of `schema.sql`: a tagged-template SQL client with `.transaction()`, as Neon's `neon()` gives |
| `exchange`, `reader` | Optional: how a service key becomes an SAP token, and options for reading SAP. Tests pass doubles here |
| `record(event)` | Optional: receives usage counts (below) |
| `reports.save(report)` | Optional: stores a report, and with that turns reports on (below) |

The site also serves the files of `public/` under `base`: the sign-in page loads its styles, script and images from there.

## Sign-in and sessions

The browser uploads the service key directly to the consent endpoint. The server uses SAP client credentials once, discards the key, and stores only the temporary SAP grant encrypted with AES-256-GCM. The connector bearer is random and stored as a digest. Sessions expire after at most one hour and can be revoked through the advertised OAuth revocation endpoint. Expired rows are pruned on the next successful link. Reconnect when the session expires. The connector supports commercial SAP client-secret keys on regional Cloud ALM endpoints. It does not offer refresh tokens or write tools.

Registration is limited to ChatGPT and Claude browser callbacks. Register dynamically in the client. Tenant reads require the user's authorization. MCP initialization, the tool catalog and public UI resources are available during connector creation. The sign-in page and the key upload take 30 requests per sender in ten minutes, per running instance.

## Reports and usage counts

Reports about tool problems are on only when the embedder passes `reports.save(report)`. The entry point of a deployment on its own passes none, so it has no report tool and no inbox. With `reports.save`:

- the assistant gets `calm_report_feedback`, and what it sends is stored through `reports.save`; one signed-in session can send at most 10 reports an hour;
- `<base>/feedback` is the public inbox for local installations of `cloud-alm-mcp-server`: it takes a well-formed report without a credential, keeps it under an id of its own, and limits each sender (20 an hour) and each running instance (300 an hour);
- the sign-in page says that the assistant can send Didro reports.

`record(event)` receives usage counts: `{ kind, tool?, outcome?, app? }`, and nothing about the tenant, the sender or the content. It is called before the answer is returned; a request does not wait for what it returns, and an error in it never fails a request. When it is passed, the sign-in page says that sign-ins and tool calls are counted.

Didro's hosted connector passes both: it stores reports in its own database, where `https://docs.didro.ai/cloud-alm/feedback` is the inbox, and adds its counts up per hour ([PRIVACY.md](../PRIVACY.md)). The variable `DIDRO_HOSTED_FEEDBACK_TOKEN` of earlier versions is no longer read: reports are not passed on to another receiver.
