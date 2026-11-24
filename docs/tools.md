# Tools

The tools the server offers, what they return, and how writes are approved. Back to the [README](../README.md).


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
| `calm_list` | One row per item (id, link, title, status, priority, assignee, due date, last change, and its links: processes, features, test case count, raised from) across types; filters by words (`a b \| c`), type, status, tag, assignee, priority, due date, changed since, fit/gap classification, process, feature, with or without tests; sorts by priority, due, changed or created; `searchText` also reads descriptions and documents; paged with `offset` / `nextOffset` |
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

### Links, words and cards

- **Links.** Items carry `url`, the page in the Cloud ALM UI (its list app
  for documents and test plans). The UI root comes from the service key's
  token host (`<tenant>.authentication.<region>…` → `https://<tenant>.<region>.alm.cloud.sap`);
  set `CALM_WEB_URL` (or, over HTTP, the `X-Calm-Web-Url` header) when it
  differs. A pasted Cloud ALM link works wherever an id does.
- **Test results** use the same words everywhere: passed, failed, in
  progress, blocked, *not run* (in a test plan, not executed) and *not in a
  test plan*.
- **Requirements** show their fit/gap classification and approval state.
- **Coverage** (`calm_gaps` with `checks: ["coverage"]`) rolls a
  requirement up with its user stories, worst verdict first.
- **Cards.** In apps with MCP Apps (Claude, ChatGPT, VS Code…),
  `calm_overview` shows a project card and every write proposal an approval
  card with the change field by field. Apps without cards get the same as
  text.
- **Prompts.** Each skill of `skills/` is also an MCP prompt.

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
| the chat | the agent shows the preview and asks; on the user's yes it calls `calm_confirm` with the id and the tool's name. Refused once a card with working buttons is on the user's screen: then only the card approves | clients without the card, or with a card without buttons |

A card drawn again (a reload, another device) asks `calm_approval_status`,
also visible to the card only, how its change ended, and shows that
instead of live buttons.

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
