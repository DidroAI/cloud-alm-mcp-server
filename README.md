# cloud-alm-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets
an agent (Claude, Codex, Cursor…) work with **SAP Cloud ALM**: projects,
requirements, user stories, defects, features, documents, test cases and
test plans, processes, landscape, cross-library, analytics and service
status events.

**Read-only by default.** The read tools are annotated `readOnlyHint` and
the reader sends GET requests only, to `*.alm.cloud.sap` hosts only.
Writing (create test cases and tasks, link, tag; never delete) is opt-in
with `CALM_WRITE` ([Modes and governance](#modes-and-governance)).

> Status: in development, not on npm yet. MIT licence.

## Quick start

Requires Node 22 or later.

1. Get a Cloud ALM API service key (below) and download its JSON.
2. Check it and save it:

   ```sh
   npx -y cloud-alm-mcp-server init ~/Downloads/calm-read.json
   ```

   `init` gets a token to prove the key works, lists which areas of Cloud
   ALM its scopes can read, makes one read, then saves the key readable
   only by you (mode 600) in `~/.config/cloud-alm-mcp-server/` and prints
   the configuration for Claude Code, Codex, Claude Desktop and Cursor.
   Paste the JSON instead of naming a file: `init` alone reads stdin.
   You can delete the downloaded copy afterwards.
3. Add the server to your client with the printed line, e.g.

   ```sh
   claude mcp add cloud-alm --scope user -e CALM_SERVICE_KEY=$HOME/.config/cloud-alm-mcp-server/service-key.json -- npx -y cloud-alm-mcp-server
   ```

4. Any time later: `npx -y cloud-alm-mcp-server doctor` checks the key,
   token, scopes, API and Node version.

| Command | Does |
| --- | --- |
| `cloud-alm-mcp-server` | starts the stdio server (default) |
| `cloud-alm-mcp-server http` | starts the streamable HTTP server |
| `cloud-alm-mcp-server init [file\|-] [--force] [--skip-check]` | checks and saves a key, prints client config |
| `cloud-alm-mcp-server doctor` | checks the setup |
| `cloud-alm-mcp-server --version` / `--help` | |

No command prints the key's secret or a token.

> Not on npm yet. Until it is, build from a checkout (`bun install && bun
> run build && npm link`) and use `cloud-alm-mcp-server` instead of
> `npx -y cloud-alm-mcp-server`.

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
   JSON. Run `cloud-alm-mcp-server init <file>` on it: it saves a copy
   readable only by you. Never put it in a repository.

The key holds `uaa.url`, `uaa.clientid`, `uaa.clientsecret` and
`endpoints.Api` (e.g. `https://eu20.alm.cloud.sap/api`, regional; the token
selects your tenant). The token carries no user: calls run as a machine
with access to the whole tenant. SAP cannot limit a key to one project.

Changed the scopes? The token reflects them at once: rerun
`cloud-alm-mcp-server doctor`. Rotated the key? `init --force <new file>`.

## Tools

Seven read tools, each answering a question in one call. Items are named by
their short **display ids** (`3-17` task, `6-1` feature, `7-1` document,
`8-1-2` test case, `8-3-1` test plan), which every tool accepts; GUIDs work
too. Answers are compact text written for a model's context.

| Tool | Answers |
| --- | --- |
| `calm_overview` | Start here: the project, its current phase, counts of requirements, user stories, defects, features, test cases and documents by status, latest test results, tags in use, gaps |
| `calm_find` | Search or list items across types (tasks, features, documents, test cases, test plans, processes, library) by words in titles and tags (`a b \| c`), type, status, tag |
| `calm_get` | Full content of 1–10 items at once: description, test steps and latest result, document text, feature transports, every link named |
| `calm_trace` | An item's links both ways: requirement → user stories → features (status, transports), test cases (with results), documents, solution process |
| `calm_gaps` | What is missing or failing: requirements and user stories without a test case, process or feature; failed test runs; features with untested tasks; test cases linked to nothing or not prepared |
| `calm_analytics` | Analytics datasets (tasks, defects, test runs, jobs, exceptions, integration messages…), counted with `groupBy` |
| `calm_landscape` | Systems and cloud services, and SAP service status events, open ones first |

With write mode on (below), four more:

| Tool | Does |
| --- | --- |
| `calm_create_test_case` | Creates a manual test case with activities and steps, linked to the requirements or user stories it covers; refuses a duplicate title |
| `calm_link` | Links a test case (tests) or feature (delivers) to tasks; skips existing links |
| `calm_tag` | Adds or removes tags on tasks, keeping the others, and reports tags Cloud ALM silently dropped |
| `calm_create_task` | Creates a requirement, user story (optionally under a requirement), defect or project task |

Every write tool takes `dryRun: true` to answer with what it would send.
Writes are never retried and nothing is ever deleted. What the Cloud ALM
API cannot do, the tools do not offer: test cases cannot be deleted, tagged
or given a solution process through the API, and automated test cases
cannot be changed.

A read the key has no scope for is named in the answer ("not readable with
this key"); the rest still answers. Errors are short text with a code
(`unauthorized`, `forbidden`, `not_found`, `rate_limited`, `unavailable`,
`bad_request`) and never carry a token.

### Modes and governance

| Variable | Effect |
| --- | --- |
| `CALM_WRITE` | `off` (default): read tools only. `dry-run`: write tools are offered but only preview. `on`: write tools write. The key also needs the write scopes. |
| `CALM_TOOLS` | Comma-separated tool names to offer, e.g. `calm_overview,calm_find,calm_get`. Default: all (of the current mode). |
| `CALM_APPROVAL` | With `CALM_WRITE=on`: `prefer` (default) asks the user to approve each write, `required` refuses writes where the client cannot ask, `off` writes at once. |
| `CALM_PROJECT` | Project GUID used when a call names none. Without it, a tenant with one project uses that one; with several, tools ask for `projectId`. |

In HTTP mode the same variables apply to every request; the bearer token
decides what Cloud ALM allows.

### Approving writes

With approval on, a write tool first runs as a dry run and the user sees
exactly what will change; nothing is sent to Cloud ALM until they approve.
How they are asked depends on the client:

| Client can… | The user sees | Clients (Nov 2026) |
| --- | --- | --- |
| render MCP Apps | an approval card in the chat with Approve / Reject | Claude (web, Desktop), ChatGPT, Cursor, VS Code, Goose |
| ask through elicitation | the client's own confirm dialog | Claude Code, Codex CLI, Cursor, VS Code |
| neither | the agent shows the preview and asks; a yes runs `calm_confirm` (`prefer` only) | others |

The card's button calls `calm_approve`, a tool visible to the card only,
with a one-time token that is never in the text the model reads; an
approval is single-use, expires after 10 minutes and, over HTTP, must come
with the same bearer token as the request that proposed it. Over HTTP the
server cannot open a dialog, so approvals go through the card. `dryRun:
true` previews without asking.

Scopes (`calm-api.` …): `projects.read`, `tasks.read`, `features.read`,
`documents.read`, `testcases.read`, `testplans.read`,
`processmanagement.read`, `landscape.read`, `lib.read`, `analytics.read`
with `tests.read` (test results), `bsm.read`; for writing `tasks.write` and
`testcases.write` (feature links are written through the Tasks API).

## Two ways to run it

### stdio, with your own key (default)

The server finds the key in `CALM_SERVICE_KEY`, either a file path or the
JSON itself, else in the file `init` saved
(`$XDG_CONFIG_HOME/cloud-alm-mcp-server/service-key.json`, by default under
`~/.config`; `%APPDATA%\cloud-alm-mcp-server\` on Windows;
`CALM_CONFIG_DIR` overrides the directory). It gets tokens by client
credentials and keeps them in memory only.

```sh
npx -y cloud-alm-mcp-server                                    # the key saved by init
CALM_SERVICE_KEY=~/keys/calm-read.json npx -y cloud-alm-mcp-server
CALM_SERVICE_KEY="$SECRET_FROM_YOUR_VAULT" npx -y cloud-alm-mcp-server   # the JSON itself
```

### Streamable HTTP, a bearer token per request

For hosting behind your own gateway: the server holds **no secret**. Each
request carries `Authorization: Bearer <token>`, a Cloud ALM token the
caller obtained. The API address comes from the `X-Calm-Api-Url` header,
or `CALM_API_URL` when the header is absent; it must be an
`https://…alm.cloud.sap` address, so a token is never sent anywhere else.

```sh
PORT=3333 CALM_API_URL=https://eu20.alm.cloud.sap/api npx -y cloud-alm-mcp-server http
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
  listed as not readable instead of failing the task. `calm_gaps`
  counts direct links only: a requirement tested only through its user
  stories counts as uncovered.

## Errors

Every failure is a `CloudAlmError` with a `code` and a short `reason`:

| Code | When |
| --- | --- |
| `unauthorized` | no usable token, expired token, 401, key refused by the token endpoint |
| `forbidden` | 403: the key lacks the scope for this call |
| `not_found` | 404 (also a wrong path) |
| `rate_limited` | 429 after two short retries (Cloud ALM allows about 500 requests per 5 s per tenant) |
| `unavailable` | 5xx, network error, timeout (30 s per operation), non-JSON or oversized answer |
| `bad_request` | 400, 422, 428, or an argument this library refused (bad id, limit, type) |

A reason never carries the token, the secret or a raw response body; long
opaque strings are redacted.

## Safety

The reader (`CloudAlm`) sends GET only, to the grant's `baseUrl` only,
which must be `https://` on a `*.alm.cloud.sap` host (`hostPattern` option
to change it for a test double). No redirects followed. At most 40 requests
and 30 seconds per operation; answers above 8 MB are refused.

The writer (`CloudAlmWriter`), used only in write mode, posts to a fixed
list of create and link endpoints (manual test cases, test case task
assignments, tasks, task tags, feature assignments), never retries, and has
no delete.

## Develop

Bun for development and tests, plain Node 22+ for the built package.

```sh
bun install
bun run typecheck
bun run test          # unit tests on hand-written fixtures, in-process MCP client over both modes, CLI with fakes
bun run build         # dist/ for Node
node dist/cli.js doctor
CALM_SERVICE_KEY=~/keys/calm-read.json bun scripts/live-check.ts stdio   # against a real tenant
CALM_SERVICE_KEY=~/keys/calm-read.json bun scripts/live-check.ts http
```

The live check calls every tool against a real tenant and prints per tool
whether it answered and the size of the answer, never its text, the secret
or a token. Test fixtures are invented values in the shapes a real tenant
returns.

Try the package as users get it:

```sh
npm pack --pack-destination /tmp
cd "$(mktemp -d)" && npm init -y >/dev/null && npm i /tmp/cloud-alm-mcp-server-*.tgz
npx --no-install cloud-alm-mcp-server doctor
```

CI runs typecheck, tests, build, a start-up check and the packed command on
Node 22 and 24. Releases: bump `version` in `package.json`, add a
`CHANGELOG.md` entry, tag `vX.Y.Z` and push the tag; the release workflow
checks again and runs `npm publish --provenance`. It publishes nothing
until the repository has an `NPM_TOKEN` secret.

## Licence

MIT: see [LICENSE](LICENSE). Use it, change it, ship it.
