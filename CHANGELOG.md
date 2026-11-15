# Changelog

All notable changes to this package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- No settings: the key decides. A read-only key gets the read tools; a key
  with write scopes also gets the write tools those scopes allow, each
  write waiting for the user's approval (card or chat). `CALM_WRITE`,
  `CALM_APPROVAL`, `CALM_APPROVAL_DIALOG`, `CALM_TOOLS` and `CALM_PROJECT`
  are gone; projects are named per call.
- No confirm dialog (MCP elicitation): some clients decline it unseen.

## [0.1.0-beta.1] - 2026-11-15

### Changed

- MCP spec 2026-07-28 with the v2 SDK (`@modelcontextprotocol/server`
  2.4, ext-apps 2.1). stdio and HTTP serve 2026-07-28 clients and 2025-era
  clients on the same endpoint; HTTP stays stateless. The opt-in confirm
  dialog uses `input_required` on 2026-07-28.
- Read tools are shaped "list, then read": `calm_list` (was `calm_find`)
  gives one row per item, paged with `offset` / `nextOffset`, and filters by
  assignee, priority, due date and change date; `searchText` also reads
  descriptions and documents. `calm_get` gives the details, with `detail:
  summary|full` and a size budget.
- Every read tool answers with structured output (`structuredContent` and
  an `outputSchema`) as well as text.
- Text written in Cloud ALM is fenced as data in answers, and the
  instructions tell the agent never to follow it.

### Added

- `calm_projects`, `calm_team`, `calm_changes` (what changed since a day)
  and `calm_api` (read any Cloud ALM API, GET only, so an agent can compose
  its own calls). `projectId` takes a project name.
- `calm_gaps`: `coverage` (requirement × test cases × latest result),
  `includeClosed`, paging.
- `calm_create_task`: assignee, start and due date; `testCase` for defects.
  `calm_update`: `comment` under the same approval.

### Fixed

- Title codes (`REQ-03`) resolve in write tools, as in reads.
- A change that changes nothing asks for no approval.
- `calm_analytics`: honest empty results (a monitoring dataset with no rows
  says so), groupable columns from the data, row counts when cut, date
  series documented.
- Test status "not run" (also never run, no result) finds test cases that
  never ran; assignee and due date always shown on task details.
- `calm_delete` warns when it removes every item of a type or defects that
  record failed tests.

## [0.1.0-beta.0] - 2026-11-14

### Fixed

- `calm_create_task` takes no description when there is none (Cloud ALM
  does not need one), names its priority codes, and its preview and card
  say the type and priority ("Create a defect", "priority high").
- The approval ask states when it expires and also travels in
  `structuredContent`, for hosts that show the model only that.
- `init` says when the key could write and how to turn writes on; for a
  prerelease, its setup lines pin the version.

### Changed

- Seven task-shaped read tools replace the 21 endpoint mirrors:
  `calm_overview`, `calm_find`, `calm_get`, `calm_trace`, `calm_gaps`,
  `calm_analytics`, `calm_landscape`. They accept short display ids
  (`3-17`, `8-1-2`), read a whole project in a few requests, answer in
  compact text, and show the latest test results. The tool list costs about
  1.8k tokens instead of 4.5k.

### Added

- Approval of writes (`CALM_APPROVAL=prefer|required|off`): every write is
  a proposal the user approves in an approval card in the chat (MCP Apps)
  or, in `prefer`, by saying yes in the chat (`calm_confirm`). The client's
  confirm dialog is opt-in (`CALM_APPROVAL_DIALOG=on`), as some clients
  decline it unseen. Approvals are single-use, expire after an hour (the
  card then shows them as expired), and are bound to
  the caller.
- `doctor` checks scopes per tool, write mode, approval and the default project.

- Write mode, off by default (`CALM_WRITE=on|dry-run`):
  `calm_create_task`, `calm_create_test_case`, `calm_create_feature`,
  `calm_create_document`, `calm_update`, `calm_delete`, `calm_comment`,
  `calm_link` (link and unlink, also documents and requirements),
  `calm_tag`. Duplicates refused; every write tool takes `dryRun` and
  previews each change before → after; a 403 names the missing scope.
- `CALM_TOOLS` (allow list) and `CALM_PROJECT` (default project).
- Skills `cloud-alm-explore` and `cloud-alm-test-design`.
- `cloud-alm-mcp-server init [file|-]`: checks a service key (shape, token,
  `calm-api.*` scopes per area, one read), saves it mode 600 under the
  user's config directory and prints configuration for Claude Code, Codex,
  Claude Desktop and Cursor. `--force` replaces a saved key, `--skip-check`
  saves without contacting SAP.
- `cloud-alm-mcp-server doctor`: the same checks on an existing setup, plus
  key file permissions and the Node version.
- `--version` and `--help`.
- `CALM_SERVICE_KEY` takes the key JSON itself as well as a path; without
  it the stdio server uses the key saved by `init`.
- Package ready for npm: `bin`, `files` (no tests, no source maps),
  `exports`, `engines`, `prepublishOnly` (typecheck, test, build).
- MIT licence.
- CI on Node 22 and 24, with a check of the packed command; a release
  workflow (tag `v*` → `npm publish --provenance`) that stays inert until
  an `NPM_TOKEN` secret exists.

## 0.1.0

- First version: read-only Cloud ALM reader and MCP server, stdio mode
  with a service key, streamable HTTP mode with a bearer per request.
  Not published.
