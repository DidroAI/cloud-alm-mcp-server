# cloud-alm-mcp-server

[![npm](https://img.shields.io/npm/v/cloud-alm-mcp-server/beta?label=npm)](https://www.npmjs.com/package/cloud-alm-mcp-server)
[![CI](https://github.com/DidroAI/cloud-alm-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/DidroAI/cloud-alm-mcp-server/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets
an agent (Claude, Codex, Cursor…) work with **SAP Cloud ALM**: projects,
requirements, user stories, defects, features, documents, test cases and
test plans, processes, landscape, cross-library, analytics and service
status events.

**The key decides, and the user approves.** Nothing to configure: a
read-only service key gets the read tools only; a key with write scopes
also gets the write tools those scopes allow (create, change, link, tag,
comment, delete), and every write waits for the user's approval
([Writes: the key decides](#writes-the-key-decides)). Reads are GET requests
only, to `*.alm.cloud.sap` hosts only.

Speaks MCP 2026-07-28 (stateless) and serves 2025-era clients on the same
endpoint; read tools return structured output; write approval works through
an MCP Apps card or the chat.

> Status: beta (0.1.0-beta.2). MIT licence. An independent open-source
> project, not affiliated with or endorsed by SAP. SAP and SAP Cloud ALM are
> trademarks of SAP SE.

## Quick start

Requires Node 22 or later.

1. Get a Cloud ALM API service key (below) and download its JSON.
2. Run:

   ```sh
   npx -y cloud-alm-mcp-server@beta setup
   ```

   `setup` takes the newest service key JSON in `~/Downloads` (or the
   file you name: `setup ~/keys/calm.json`), gets a token to prove it
   works, lists which areas of Cloud ALM its scopes can read, makes one
   read, saves the key readable only by you (mode 600) in
   `~/.config/cloud-alm-mcp-server/`, and adds the server to every client
   it finds: Claude Code, Codex, Claude Desktop and Cursor. Run it again
   after rotating the key. You can delete the downloaded copy afterwards.
3. Open a new chat (quit and reopen Claude Desktop) and ask: *"Where does
   my Cloud ALM project stand?"*

Any time later, `npx -y cloud-alm-mcp-server@beta doctor` checks the key,
token, scopes, API and Node version.

### Let your agent set it up

Download the key, then give Claude Code, Codex or any agent with a
terminal this prompt:

> Set up the SAP Cloud ALM MCP server for me: run
> `npx -y cloud-alm-mcp-server@beta setup` in a terminal. It finds the
> service key JSON I downloaded from SAP BTP, checks it, saves it and adds
> the server to my MCP clients. Don't open or print the key file. If it
> finds no key, ask me for the file's path and run
> `npx -y cloud-alm-mcp-server@beta setup <path>`. Then tell me what it
> printed and which apps to restart.

`setup --client claude-code,codex` limits it to some clients;
`--client none` only saves the key and prints the configuration to add by
hand, as `init` does.

| Command | Does |
| --- | --- |
| `cloud-alm-mcp-server` | starts the stdio server (default) |
| `cloud-alm-mcp-server http` | starts the streamable HTTP server |
| `cloud-alm-mcp-server setup [file\|-] [--client <list>]` | finds, checks and saves the key, adds the server to the clients installed |
| `cloud-alm-mcp-server init [file\|-] [--force] [--skip-check]` | checks and saves a key, prints client config |
| `cloud-alm-mcp-server doctor` | checks the setup |
| `cloud-alm-mcp-server --version` / `--help` | |

No command prints the key's secret or a token.

> Beta. Until 0.1.0 is out, name the beta: `npx -y cloud-alm-mcp-server@beta`.
> A packed build installs with `npm install -g ./cloud-alm-mcp-server-<version>.tgz`;
> then use `cloud-alm-mcp-server` instead of `npx -y cloud-alm-mcp-server`.

## Get a service key

Cloud ALM's APIs take an OAuth token from a **service key** of the "SAP Cloud
ALM API" service, created in the BTP subaccount where your Cloud ALM tenant
lives. Nothing is deployed; the instance only registers an OAuth client.

1. In the BTP cockpit, open the Cloud ALM subaccount → *Services* →
   *Instances and Subscriptions* → *Create*.
2. Service **SAP Cloud ALM API**, plan **standard**, runtime environment
   **Other**. Name it, e.g. `calm-read`.
3. Parameters: paste one of the scope files of this repository (the
   default template has no scopes, which gives a token that can read
   nothing):

   - [`scopes/read-only.json`](scopes/read-only.json): the agent reads;
   - [`scopes/read-write.json`](scopes/read-write.json): it may also
     propose changes to tasks, test cases, features and documents, each
     one waiting for your approval.

   Change `xsappname` if the name is taken in your subaccount. The
   read-only file looks like this:

   ```json
   {
     "xs-security": {
       "xsappname": "calm-read",
       "authorities": [
         "$XSMASTERAPPNAME.calm-api.projects.read",
         "$XSMASTERAPPNAME.calm-api.tasks.read",
         "$XSMASTERAPPNAME.calm-api.tasks.personal.read",
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
         "$XSMASTERAPPNAME.calm-api.bsm.read",
         "$XSMASTERAPPNAME.calm-api.tests.read",
         "$XSMASTERAPPNAME.calm-api.defects.read",
         "$XSMASTERAPPNAME.calm-api.requirements.read"
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
   JSON. Run `cloud-alm-mcp-server setup` (it finds the file in
   `~/Downloads`): it saves a copy readable only by you. Never put it in a repository.

The key holds `uaa.url`, `uaa.clientid`, `uaa.clientsecret` and
`endpoints.Api` (e.g. `https://eu20.alm.cloud.sap/api`, regional; the token
selects your tenant). The token carries no user: calls run as a machine
with access to the whole tenant. SAP cannot limit a key to one project.

Changed the scopes? The token reflects them at once: rerun
`cloud-alm-mcp-server doctor`. Rotated the key? Download the new one and run `setup` again.

## Tools

Read tools, shaped as "list, then read": `calm_list` returns one compact
row per item, `calm_get` the details of the ids you pick. Items are named by
their short **display ids** (`3-17` task, `6-1` feature, `7-1` document,
`8-1-2` test case, `8-3-1` test plan), which every tool accepts; GUIDs and
codes in titles (`REQ-03`) work too. Every read answers with compact text and
the same answer as structured data (`structuredContent`, described by the
tool's `outputSchema`).

| Tool | Answers |
| --- | --- |
| `calm_overview` | Start here: the project, its current phase, counts of requirements, user stories, defects, features, test cases and documents by status, latest test results, documents, tags in use, gaps |
| `calm_projects` | The projects the key can read; every tool takes `projectId` as an id or a name |
| `calm_team` | Who is in the project team, with roles: the user ids an assignee is set to |
| `calm_list` | One row per item (id, title, status, priority, assignee, due date, last change) across types; filters by words (`a b \| c`), type, status, tag, assignee, priority, due date, changed since; `searchText` also reads descriptions and documents; paged with `offset` / `nextOffset` |
| `calm_changes` | What changed since a day: items created or changed, newest first, and how test results moved |
| `calm_get` | Details of 1–10 items: fields, description, comments, test steps and latest results, document text, feature transports, every link with its id; `detail: "summary"` for less, and a size budget |
| `calm_trace` | An item's links both ways: requirement → user stories → features (status, transports), test cases (with results), documents, solution process |
| `calm_gaps` | What is missing or failing: requirements and user stories without a test case, process or feature; failed test runs; features with untested tasks; test cases linked to nothing or not prepared; `coverage` for an audit matrix; paged |
| `calm_analytics` | Analytics datasets (tasks, defects, test runs, jobs, exceptions, integration messages…), counted with `groupBy`, per day with `date` |
| `calm_api` | Any Cloud ALM API, read-only (GET on the known API paths, OData query options passed through): the agent composes its own calls when no other tool answers. Without a path it lists the APIs |
| `calm_landscape` | Systems and cloud services, and SAP service status events, open ones first |

Text people wrote in Cloud ALM (descriptions, comments, documents, API data)
is fenced as data in the answers, and the server instructions tell the agent
never to follow it.

With write mode on (below), ten more:

| Tool | Does |
| --- | --- |
| `calm_create_task` | Creates a requirement, user story (optionally under a requirement), defect or project task, with assignee, start and due date; a defect can name the test case it was found in (Cloud ALM's API cannot link the two, so the description names it, and an open defect for it is flagged); refuses a duplicate title |
| `calm_create_test_case` | Creates a manual test case with activities and steps, linked to the requirements or user stories it covers; refuses a duplicate title |
| `calm_create_feature` | Creates a feature, optionally linked to the tasks it delivers; refuses a duplicate title |
| `calm_create_document` | Creates a document (content, type, status, priority) linked to tasks; refuses a duplicate title |
| `calm_update` | Changes 1–20 items with the same changes: tasks (title, description, status in plain words, priority, assignee, start and due date, timebox, obsolete), features (title, description, status, priority), manual test cases (title, prepared, priority, `addActivity` with steps); `comment` adds a comment under the same approval. Sends only the fields that differ, answers before → after per field, and asks no approval when nothing would change |
| `calm_delete` | Deletes tasks (`soft: true` marks them obsolete instead, as SAP recommends), manual test cases (`force: true` also deletes their runs and results) and documents; warns when it removes every item of a type or defects that record failed tests |
| `calm_comment` | Adds a comment to a task |
| `calm_link` | Links, or with `unlink: true` unlinks, a test case (tests), feature (delivers) or document (documents) to tasks, and user stories or project tasks to their requirement; skips links already in that state |
| `calm_tag` | Adds or removes tags on tasks, keeping the others, and reports tags Cloud ALM silently dropped |

Every write tool takes `dryRun: true` and then answers with a complete
preview: item ids and titles, each field before → after, what gets created,
linked or deleted. Display ids work everywhere. Statuses are plain words,
mapped to Cloud ALM's codes per task type (`open`, `in progress`,
`blocked`, `in review`, `done`, `not relevant` as the type has them;
requirements also `to be approved`, `approved`, `in realization`,
`approved for deployment`, `rejected`; defects also `retest`). A field that
does not apply to an item is refused before anything is written. A 403
names the scope the key lacks. Writes are never retried.

What Cloud ALM's API itself does not allow (no scope changes it):

- Features cannot be deleted, and their status moves only along Cloud
  ALM's path (in specification ↔ not planned; in specification → in
  realization → in testing → successfully tested, back to in realization;
  once in realization, never back to in specification or not planned).
  "Ready for production" cannot be set through the API, so "deployed" is
  not reachable through it either.
- A feature description holding images cannot be changed through the API.
- A document's title, content, status, priority and type cannot change
  after create; only its links can.
- Test cases and features cannot be tagged; automated test cases are
  read-only; a test case's project, scope and process cannot change.
- No API records manual test execution (runs, step results, pass/fail).
- A requirement's approval is final (it cannot go back to "to be approved"
  or "rejected"), and an approved requirement cannot be deleted.
- A task has one requirement: unlink it before linking another.
- Every write is recorded as the key's technical user.

Deleting test cases and documents needs extra scopes on the key
(`testcases.delete`, `testcases.force-delete`, `documents.delete`).

A read the key has no scope for is named in the answer ("not readable with
this key"); the rest still answers. Errors are short text with a code
(`unauthorized`, `forbidden`, `not_found`, `rate_limited`, `unavailable`,
`bad_request`) and never carry a token.

### Writes: the key decides

There are no settings. The only one is the key (`CALM_SERVICE_KEY`, or the
file `init` saved):

- a key with read scopes only: the agent reads, and no write tool exists;
- a key with write scopes: the write tools those scopes cover are offered
  (`tasks.write` gives create task, update, comment, tag, link…), and each
  write is a proposal the user approves (below).

To keep a team read-only, give it a read-only key; `doctor` says which
tools a key gets. In HTTP mode each caller's token decides for its own
requests. A tenant with several projects needs no default: the agent names
the project (`projectId` takes an id or a name).

### Approving writes

A write tool only proposes the change: it runs as a dry run and answers
with the preview; nothing is sent to Cloud ALM until the user approves. Every answer carries the same proposal, whatever the client
says it supports, and the user approves it in one of these ways:

| Where | How | Clients (Nov 2026) |
| --- | --- | --- |
| the approval card | an MCP Apps card in the chat with Approve / Reject | Claude (web, Desktop chat), ChatGPT, VS Code, Goose |
| the chat | the agent shows the preview and asks; on the user's yes it calls `calm_confirm` with the id and the tool's name | every client |

The card's button calls `calm_approve`, a tool visible to the card only,
with a one-time token that travels in the result's `_meta`, never in the
text the model reads. If the host drops `_meta` (some do, e.g. on reload),
the card falls back to the id in `structuredContent`. If the host does not pass the card's calls to the server
(it does not declare `serverTools`; the Claude Code tab is one, see
anthropics/claude-code#106708), the card shows the change without
buttons and asks the user to reply yes in the chat; a failed call does
the same. An approval is single-use, expires after 60
minutes (the card then shows it as expired) and, over HTTP, must come with the same bearer token as the
request that proposed it. `dryRun: true` previews without asking.

Approving in the chat trusts the agent: the server cannot see the user's
reply. It names the change in `calm_confirm` (id and tool), which hosts
show in their permission prompt; keep that prompt on for `calm_confirm`
(do not "always allow" it) if text in Cloud ALM could come from people you
do not trust. Before writing, the server runs the change as a dry run again
and refuses if it no longer matches the preview the user saw. Text from
Cloud ALM reaches the agent fenced as data.

The server sends no confirm dialog (MCP elicitation): some clients declare
one and answer "decline" without showing it, which would cancel a change
the user never saw.

Scopes (`calm-api.` …): `projects.read`, `tasks.read`, `features.read`,
`documents.read`, `testcases.read`, `testplans.read`,
`processmanagement.read`, `landscape.read`, `lib.read`, `analytics.read`
with `tests.read` (test results), `bsm.read`; for writing `tasks.write`,
`testcases.write`, `features.write`, `documents.write` (task links of
features and documents are written through the Tasks API), and to delete
test cases and documents (or unlink a test case from a task)
`testcases.delete`, `testcases.force-delete`, `documents.delete`.

## Skills and prompts

`skills/` holds agent skills for the work of a functional consultant; the
server also offers each one as an MCP prompt (pick it from your client's
prompt or slash-command menu):

| Skill | For |
| --- | --- |
| `cloud-alm-explore` | answering questions: which tool for which question |
| `cloud-alm-fit-gap` | fit-to-standard: fit, configuration or gap per requirement and process |
| `cloud-alm-workshop-prep` | agenda, open questions and decisions for a workshop |
| `cloud-alm-backlog-from-notes` | minutes or a transcript into requirements, user stories, tasks and comments |
| `cloud-alm-status-report` | a steering committee or weekly status report |
| `cloud-alm-test-readiness` | SIT/UAT entry and exit, go-live readiness, go / no-go |
| `cloud-alm-defect-triage` | duplicates, priority, owner and due date of open defects |
| `cloud-alm-test-design` | test cases for what is untested |

For Claude Code, copy a skill's folder to `~/.claude/skills/`; for other
agents, use the prompts or point the agent to the SKILL.md.

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
`CloudAlm` (typed reads of every Cloud ALM area), `CloudAlmWriter` (the
allow-listed writes) and the `format*` helpers are public API; the MCP tools
are built on the same client.

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

The writer (`CloudAlmWriter`), used only in write mode, sends POST, PATCH
or DELETE only to a fixed allow-list of (method, path) pairs: create and
change tasks, features, documents and manual test cases (with their
activities and steps), comments, tags, links, and the deletes the API
offers. It never retries. A test case write carries its ETag (Cloud ALM
answers 428 without one).

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

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports:
[SECURITY.md](SECURITY.md). Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
