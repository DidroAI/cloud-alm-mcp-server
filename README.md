# cloud-alm-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets
an agent (Claude, Codex, Cursor…) work with **SAP Cloud ALM**: projects,
requirements, user stories, defects, features, documents, test cases and
test plans, processes, landscape, cross-library, analytics and service
status events.

**Read-only today.** Every tool is annotated `readOnlyHint` and the client
sends GET requests only, to `*.alm.cloud.sap` hosts only.

> Status: private, in development. Not published yet; no licence chosen.

## Quick start

1. Get a Cloud ALM API service key (below), save it outside any repository,
   `chmod 600`.
2. Add the server to your MCP client:

```json
{
  "mcpServers": {
    "cloud-alm": {
      "command": "node",
      "args": ["/path/to/cloud-alm-mcp-server/dist/cli.js"],
      "env": { "CALM_SERVICE_KEY": "/home/me/keys/calm-read.json" }
    }
  }
}
```

From a checkout: `bun install && bun run build`. Requires Node 22 or later.

## Get a service key

Cloud ALM's APIs take an OAuth token from a **service key** of the "SAP Cloud
ALM API" service, created in the BTP subaccount where your Cloud ALM tenant
lives. Nothing is deployed; the instance only registers an OAuth client.

1. In the BTP cockpit, open the Cloud ALM subaccount → *Services* →
   *Instances and Subscriptions* → *Create*.
2. Service **SAP Cloud ALM API**, plan **standard**, runtime environment
   **Other**. Name it, e.g. `calm-read`.
3. Parameters: give the client the read scopes it needs (the default
   template has none, which gives a token that can read nothing):

   ```json
   {
     "xs-security": {
       "xsappname": "calm-read",
       "authorities": [
         "$XSMASTERAPPNAME.calm-api.projects.read",
         "$XSMASTERAPPNAME.calm-api.tasks.read",
         "$XSMASTERAPPNAME.calm-api.features.read",
         "$XSMASTERAPPNAME.calm-api.documents.read",
         "$XSMASTERAPPNAME.calm-api.testcases.read",
         "$XSMASTERAPPNAME.calm-api.testplans.read",
         "$XSMASTERAPPNAME.calm-api.processmanagement.read",
         "$XSMASTERAPPNAME.calm-api.processhierarchy.read",
         "$XSMASTERAPPNAME.calm-api.landscape.read",
         "$XSMASTERAPPNAME.calm-api.lib.read",
         "$XSMASTERAPPNAME.calm-api.analytics.read",
         "$XSMASTERAPPNAME.calm-api.analytics.providers.read",
         "$XSMASTERAPPNAME.calm-api.bsm.read"
       ]
     }
   }
   ```

   Add only what you will read. Analytics datasets also need their area's
   scope (`calm-api.tasks.read` for `Tasks`, `…defects.read`,
   `…requirements.read`, `…tests.read`, …), and operations datasets their
   own (`…metrics.read`, `…jobs.read`, `…exm.read` …). Personal fields
   (assignee names) need `calm-api.tasks.personal.read` and its siblings.
4. Create a **service binding** (the key) on the instance and download its
   JSON. Keep it outside any repository, readable only by you (`chmod 600`).

The key holds `uaa.url`, `uaa.clientid`, `uaa.clientsecret` and
`endpoints.Api` (e.g. `https://eu20.alm.cloud.sap/api`, regional; the token
selects your tenant). The token carries no user: calls run as a machine
with access to the whole tenant. SAP cannot limit a key to one project.

## Tools

List tools show ids in `[brackets]`; pass them to the get tools. Lists page
with `limit` (1–200, default 50) and `offset`, and say which offset gives
the next page.

| Tool | What it reads | Scope (`calm-api.` …) |
| --- | --- | --- |
| `calm_list_projects` | projects | `projects.read` |
| `calm_get_project` | one project, its timeboxes and teams | `projects.read` |
| `calm_search_tasks` | tasks by project, type (requirement, user story, defect, roadmap task…), status, words in the title | `tasks.read` |
| `calm_get_task` | one task with description, references, comments, tags, and links: requirement, test cases, features, solution processes | `tasks.read` (+ `testcases.read` for its test cases) |
| `calm_list_features` / `calm_get_feature` | features; one with its transport ids | `features.read` |
| `calm_list_documents` / `calm_get_document` | documents; one with its content as text | `documents.read` |
| `calm_list_test_cases` | manual or automated test cases | `testcases.read` |
| `calm_get_test_case` | one manual test case with activities and steps, the tasks it covers, its tags | `testcases.read` |
| `calm_test_coverage` | requirements and user stories of a project with and without a linked test case; test cases linked to no task | `tasks.read`, `testcases.read` |
| `calm_list_test_plans` / `calm_get_test_plan` | test plans; one with its test cases | `testplans.read` |
| `calm_list_scopes` | project scopes | `processmanagement.read` |
| `calm_list_processes` | solution processes and whether each is in scope | `processmanagement.read` |
| `calm_list_process_hierarchy` | process hierarchy nodes | `processhierarchy.read` |
| `calm_list_landscape` | systems, cloud and business services | `landscape.read` |
| `calm_list_library` | applications, developments, interfaces or configurations | `lib.read` |
| `calm_list_analytics_providers` | analytics providers and the scopes each needs | `analytics.providers.read` |
| `calm_query_analytics` | aggregated rows of one dataset (Tasks, Defects, Tests, Jobs…) | `analytics.read` + the dataset's area scope |
| `calm_list_status_events` | service outages, maintenance, communications | `bsm.read` |

A tool whose scope the key lacks answers a tool error
`Cloud ALM forbidden: …`; the other tools keep working. Errors are short
text with a code (`unauthorized`, `forbidden`, `not_found`,
`rate_limited`, `unavailable`, `bad_request`) and never carry a token.

## Two ways to run it

### stdio, with your own key (default)

The server reads the key file named by `CALM_SERVICE_KEY`, gets tokens by
client credentials and keeps them in memory only.

```sh
CALM_SERVICE_KEY=~/keys/calm-read.json node dist/cli.js
```

### Streamable HTTP, a bearer token per request

For hosting behind your own gateway: the server holds **no secret**. Each
request carries `Authorization: Bearer <token>`, a Cloud ALM token the
caller obtained. The API address comes from the `X-Calm-Api-Url` header,
or `CALM_API_URL` when the header is absent; it must be an
`https://…alm.cloud.sap` address, so a token is never sent anywhere else.

```sh
PORT=3333 CALM_API_URL=https://eu20.alm.cloud.sap/api node dist/cli.js http
# MCP endpoint: http://127.0.0.1:3333/mcp  (HOST to bind elsewhere)
```

Stateless: one server per POST, JSON answers, no session. Requests without
a bearer get 401; other methods 405. Put it behind TLS and your own
authentication of callers: the bearer authorizes Cloud ALM, not the caller.

## Use as a library

The Cloud ALM client is exported too:

```ts
import { CloudAlm, serviceKeyGrants, formatTasks, createServer, createHttpHandler } from "cloud-alm-mcp-server";

const calm = new CloudAlm(serviceKeyGrants(serviceKey));          // from a service key
const calm2 = new CloudAlm(async () => myBroker.grant("cloud-alm")); // from your own token source
console.log(formatTasks(await calm.listTasks({ type: "defect", limit: 20 })));
```

A grant is `{ accessToken, baseUrl, expiresAt? }`; a callback is called once
per operation. The library never reads environment variables or files.

## Cloud ALM quirks it hides

- **Path casing differs per service**: REST services use lower case
  (`projects`, `tasks`, `landscapeObjects`, `solutionProcesses`), OData
  services capitalised entity sets (`Features`, `ManualTestCases`). The
  wrong case answers 404. The library holds the right paths.
- **Tasks need a project.** Cloud ALM answers 400 without `projectId`.
  Without one, `listTasks` reads every project (up to 10) and merges.
- **GUID filters go unquoted** in OData (`projectId eq 1234…`); a quoted
  GUID answers 400 (`Edm.Guid` vs `Edm.String`). Ids are checked as GUIDs
  before they go into a path or a filter.
- **Paging differs**: OData services take `$top`/`$skip`/`$count`; tasks,
  landscape and status events take `limit`/`offset`; process management
  takes a literal `$top`/`$skip`. Every list here takes `{ limit, offset }`
  (limit 1–200, default 50) and returns
  `{ items, offset, limit, nextOffset, total }`. `nextOffset` is null on
  the last page (one extra row is fetched to know). `total` is set when
  Cloud ALM counts (OData).
- **Errors come in four shapes** (`{message}`, `{error:{message}}`,
  `[{message}]`, `{message,status}`); the library reads all of them.
- **Analytics rows are aggregates**, one per combination of dimension
  values, not records. Unknown or unfilterable dimensions in `filters` are
  ignored by Cloud ALM. Some datasets refuse without a filter (428, e.g.
  `ServiceLevels` needs a business service id).
- **Links live with one side.** A task's test cases are found from Test
  Management (`toTaskAssignments/any(a:a/taskId eq …)`), its features
  from the task's feature assignments, its requirement from relation type
  10 (`parentId` stays empty), its processes from
  `tasks/solutionProcessAssignments`. A link the key has no scope for is
  listed as not readable instead of failing the task. `calm_test_coverage`
  counts direct links only: a requirement tested only through its user
  stories counts as uncovered.

## Errors

Every failure is a `CloudAlmError` with a `code` and a short `reason`:

| Code | When |
| --- | --- |
| `unauthorized` | no usable token, expired token, 401, key refused by the token endpoint |
| `forbidden` | 403: the key lacks the scope for this read |
| `not_found` | 404 (also a wrong path) |
| `rate_limited` | 429 after two short retries (Cloud ALM allows about 500 requests per 5 s per tenant) |
| `unavailable` | 5xx, network error, timeout (30 s per operation), non-JSON or oversized answer |
| `bad_request` | 400, 422, 428, or an argument this library refused (bad id, limit, type) |

A reason never carries the token, the secret or a raw response body; long
opaque strings are redacted.

## Safety

GET only, to the grant's `baseUrl` only, which must be `https://` on a
`*.alm.cloud.sap` host (`hostPattern` option to change it for a test
double). No redirects followed. At most 40 requests and 30 seconds per
operation; answers above 8 MB are refused.

## Develop

```sh
bun install
bun run typecheck
bun run test          # unit tests on hand-written fixtures, in-process MCP client over both modes
bun run build         # dist/ for Node
CALM_SERVICE_KEY=~/keys/calm-read.json bun scripts/live-check.ts stdio   # against a real tenant
CALM_SERVICE_KEY=~/keys/calm-read.json bun scripts/live-check.ts http
```

The live check calls every tool against a real tenant and prints per tool
whether it answered and the size of the answer, never its text, the secret
or a token. Test fixtures are invented values in the shapes a real tenant
returns.
