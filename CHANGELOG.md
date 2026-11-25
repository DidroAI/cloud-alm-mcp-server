# Changelog

All notable changes to this package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.4] - 2026-11-25

- The link of an automated test case opens that test case in Cloud ALM, not the list of test cases.
- New icon of our own (a cloud with a linked check) for the server, the Claude Desktop extension and the registry entry, in place of SAP's logo.
- Where views are shown with `calm_show` (the hosted connector in ChatGPT and Claude), the assistant is told more plainly to use it: the instructions and the tool's description say when, and each read ends with a reminder and the exact call. Before, a request such as "show the tests" could be answered with a text table.
- Reports about tool problems go to `https://docs.didro.ai/cloud-alm/feedback`. Earlier versions keep posting to `https://calm.didro.ai/feedback`, which still takes them.
- Didro's hosted connector is now at `https://docs.didro.ai/cloud-alm/connect/mcp`. A connection made at the former address, `https://calm.didro.ai/mcp`, will have to be added again once that address is retired. It now counts sign-ins and tool calls per hour (tool name, outcome, app, version; no tenant, address or content), and says so on the sign-in page and in PRIVACY.md.
- The hosted connector can be mounted under a path of an existing site and can store reports in its own deployment.
- Hosted connector hardening after a review: a separate derived key for client ids, sign-in flows, stored grants and client secrets (existing registrations must be made again); only tools the server has are counted by name; the per-sender limit covers the sign-in page and key upload, not the registration and code exchange that the apps' shared servers perform; credentials that do not decode are refused instead of failing; the sign-in page warns against continuing from a link someone else sent.

## [0.3.3] - 2026-11-25

- The Claude Desktop extension and the Claude Code plugin have a switch for the reports about tool problems, and the MCP Registry entry lists `CALM_FEEDBACK`. `feedback off` still turns them off for every copy on the computer.
- `setup` and `uninstall` replace or remove only skill folders this package installed (they carry a marker file); a skill of the same name you wrote yourself stays, and setup says so.
- `cloud-alm-mcp-server http` on the loopback address answers only to its own host names and refuses requests from web pages, so a page in the browser cannot reach it.
- The hosted connector limits how often one sender can register, submit a key or exchange a code.
- The skills' statements about SAP were checked against SAP's own pages and corrected where they differed.
- New setup video and approval card screenshot, showing the setup questions and the current card.
- SECURITY.md explains why the app entries carry no version, and how to pin one.

## [0.3.2] - 2026-11-25

Fixes from a review of the code, the documentation, the tests and the skills.

### Approval
- A yes in the chat is not accepted in the first 10 seconds after a proposal, so an approval card with working buttons claims the change before an assistant that confirms in the same turn. A card without its token is held the same way.
- New setting `CALM_APPROVAL=card`: changes are approved in the card only, never in the chat. Unset, it is as before: the card where the app shows one with working buttons, else the chat.
- The approval card shows every value whole: a description, a comment, a document's content and test steps were cut after 80 to 4000 characters while the whole text was written. What the assistant reads is still shortened, and now says by how many characters.
- A link proposed from the user story's side showed the story linked to itself; the card now shows the requirement and the story.
- A link or a tag keeps its own title instead of "Change user story". A dry-run preview of a delete no longer shows the delete warning, and keeps its "nothing was sent" line.
- `calm_confirm` no longer takes a description of the change written by the assistant.
- SECURITY.md says what approval does not cover: approval in the chat trusts the assistant, and an agent with a shell can read the saved key.

### Skills
- Coverage for an exit or go-live decision is computed over closed requirements too (`includeClosed: true`); the test-readiness skill refuses a "go" on incomplete data.
- Instructions the server rejects are gone: the status "not relevant" on defects, the document types "Fit-to-Standard" and "Status Report", and feature status words the tools do not print.
- The nine skills use one definition each of defect priority, the requirement lifecycle and "gap", and no longer promise what the tools cannot see (which system a transport is in, who changed an item, a document's status). An approval is never set from meeting notes. Clean core level B is narrowed to the classic APIs SAP names as stable.
- Requirement sub-statuses read "to be approved", "in planning", "in realization" instead of losing their first word; a postponed defect reads "postponed".

### Setup
- A hidden paste no longer ends early when the terminal delivers a line break on its own, which could show the rest of the key; paste marks cut in two and arrow keys pressed before pasting no longer damage it; the line break after the key no longer answers the next question.
- `setup <file>` at a terminal still asks which apps and whether to install the skills. Ctrl-C while the key is checked says "Cancelled" and exits with an error status.
- Run without a person, `setup` uses a key found in `~/Downloads` only when both its addresses are SAP's; at a terminal it asks first. Two keys with the same tenant name but different API addresses count as different tenants.
- `CI=false` and Cursor's built-in terminal count as a person's terminal. A copy of the skills left in Cursor's own folder is removed when Cursor reads another app's folder.

### Reports
- Any `CALM_FEEDBACK` value other than `on`, `1`, `true` or `yes` turns reports off, so a typo does not leave them on. One running server sends at most ten reports.
- The public report address refuses text with links, e-mail addresses, credentials or record ids, passes reports on under an id of its own, and counts junk against its sender only.

### Documentation
- The install guide no longer says the server connects only to SAP, and says how to turn reports off for each way of installing. It gains a table of the environment variables, the `feedback` command, the wizard, and where the skills go. The Codex app is listed among the apps that show cards.

## [0.3.1] - 2026-11-24

- The nine skills are rewritten to lead with SAP domain knowledge, researched from SAP Activate, SAP Learning, SAP's Cloud ALM pages and practitioner sources: how a senior consultant challenges a gap and rates it against clean core, runs a fit-to-standard workshop, sorts notes into the right Cloud ALM objects, designs and judges tests, routes a defect by root cause, and rates a project red, amber or green. Where practice differs between projects, the skill says so and follows the project's convention.
- Once the approval card is on the user's screen, only the card approves: `calm_confirm` is refused, so an assistant cannot pass on a "yes" the user did not give. Approval in the chat remains for apps that show no card or a card without buttons.
- Every write tool shows its change in the card field by field: link, tag, create test case, create feature and create document no longer fall back to raw text. A dry run draws the same view as a preview, marked "Nothing sent".
- The card has a new address (`approve-v3`), so apps that kept an older card load the current one.
- `setup` installs the nine skills where Claude Code, Codex and Cursor read them, so the assistant uses a workflow on its own when a request matches; the wizard asks first, `--no-skills` skips it, and `uninstall` takes them out again.
- Agent reports are on by default for local installations: when the assistant runs into a tool problem it can send Didro a short report (tool name, outcome, one or two generic sentences; no records, credentials or chat text). Turn them off with `cloud-alm-mcp-server feedback off` or `CALM_FEEDBACK=off`; `doctor` and `setup` say which it is. `CALM_FEEDBACK_URL` still sends them to a receiver of your own. See PRIVACY.md.
- The hosted connector takes these reports at `/feedback`, without a credential, and passes well-formed ones to Didro's inbox.

## [0.3.0] - 2026-11-24

- `setup` in a terminal is a short wizard: it asks which service key to use (a file by its path, a pasted key that is not shown, a key found in `~/Downloads`, or the one saved before) and which apps to add the server to, and ends with what to restart. A key in `~/Downloads` is offered, no longer taken unasked.
- Run by an AI agent, in CI, through a pipe or with the new `--no-input`, `setup` asks nothing and works as before.

## [0.2.1] - 2026-11-24

- The approval card shows the whole change on the page instead of a scroll box inside the card. Lists of more than nine items fold behind "Show all"; a delete stays locked until its full list is shown.
- A card drawn again after its change was approved or rejected shows that outcome instead of live buttons, and a second approval is told what happened rather than "nothing was written".
- The approval card is written for consultants: no item ids, tool name or request id, no status dots or bullets, capitalised item types, and plain sentences where it used to show the answer meant for the agent; the tenant host name is gone too.
- A proposed change names items by kind and title, also in the text for apps without the card and in what the agent is asked to show; the delete warning says "marking it obsolete instead can be undone" rather than naming a parameter.
- Fixed escape sequences shown as typed in the approval card when the server runs from source under Bun.
- In result tables, the arrow of "Open record" stays with its word.

## [0.2.0] - 2026-11-20

- Connect ChatGPT or Claude in the browser to your own Cloud ALM tenant with a BTP service key. Hosted sessions provide read access for up to one hour.
- Discover projects, explore process scope and compare daily project test results.
- Check test-plan exit criteria against case priorities, execution results and linked defects. Plan details distinguish current assignments from cases present in daily reports.
- Tool descriptions now explain when to use each tool. Structured responses identify missing evidence, including unavailable edit attribution.

## [0.1.3] - 2026-11-20

### Added

- Compact project and item cards with SAP links, expandable results and paging.
- Optional explicit presentation with `calm_show` for MCP Apps hosts.

- Horizon project dashboards, test-plan case and defect tables, and field-by-field write approvals.
- Optional agent friction reports to an operator-configured inbox.

### Changed

- Setup checks SAP read access before saving a key or changing client settings.

## [0.1.2] - 2026-11-16

### Added

- An icon for the Claude Desktop extension, the MCP Registry listing and the
  server's `serverInfo` (with a title and website), and a social preview.
- The extension and the plugin name didro.ai as their publisher.

### Changed

- Releases publish through npm trusted publishing only (no token); the
  `beta` tag stays on 0.1.0.

## [0.1.1] - 2026-11-16

### Security

- zod 4.6.7 (was 4.5.4): fixes memory exhaustion when validating oversized
  constrained collections (GHSA, high).

## [0.1.0] - 2026-11-16

First release. The same server as 0.1.0-beta.3, plus:

### Added

- A 2-minute setup video with narration, played inline in the README and
  the service key guide.
- Instructions for AI agents (`docs/agent-setup.md`) and a one-paragraph
  prompt that sets the server up from Claude Code, Codex or Cursor.
- Contributor guides: how a change lands, issue templates for bugs,
  features and questions, `SUPPORT.md`, code owners.

### Changed

- Install with `npx -y cloud-alm-mcp-server`, without `@beta`; `setup`
  writes the bare name into client configurations. Configurations from the
  beta stay on 0.1.0 until `setup` runs again.

## [0.1.0-beta.3] - 2026-11-15

### Added

- Approval card redesigned (SAP Horizon look, light and dark, host
  theming): the change field by field (before → after), what is created,
  what is deleted with a strong warning, project and tenant. Write tools
  hand the card their plan as data.
- Project overview card for `calm_overview` (MCP Apps): phases, key figures,
  test results, defects by priority, gaps with a button that asks the
  follow-up.
- Links to the Cloud ALM UI on items (`url` in list, get, trace, gaps);
  the UI root comes from the service key, `CALM_WEB_URL` or the
  `X-Calm-Web-Url` header. A pasted Cloud ALM link works as an id.
- `calm_list`: row links (processes, features, test case count, raised
  from), filters `process`, `feature`, `hasTests`, and `sort` (priority,
  due, changed, created).
- Coverage rolls each requirement up with its user stories, with test case
  titles, defects and verdict counts as data.
- Every read tool declares its output schema.
- Test plans show progress: executed, passed, pass rate.
- A requirement's trace names the open defects that block it.
- Skill: daily brief.

- Claude Desktop extension: `cloud-alm-mcp-server.mcpb`, attached to each
  GitHub Release. Double-click, choose the service key file, done; no
  terminal and no Node.js to install. Built by `scripts/build-mcpb.sh`.
- Claude Code plugin marketplace (`.claude-plugin/marketplace.json`):
  `/plugin install cloud-alm --marketplace DidroAI/cloud-alm-mcp-server`.
  The plugin asks for the service key file when it is enabled.
- Official MCP Registry: `server.json`
  (`io.github.DidroAI/cloud-alm-mcp-server`), published by the release
  workflow.
- `PRIVACY.md`: no telemetry; the server talks only to the key's SAP token
  host and the Cloud ALM API.
- `docs/install.md`: install links for Cursor and VS Code and the
  commands for every client.
- `uninstall`: removes the server from Claude Code, Codex, Claude Desktop
  and Cursor, keeps each changed config file as `.bak`, asks nothing;
  `--key` also deletes the saved service key.
- `setup` on Windows also writes the config of Claude Desktop from the
  Microsoft Store
  (`%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude`).

### Changed

- HTTP mode reuses a token's reader while its snapshot is fresh (45 s), so
  follow-up calls do not re-read every list.
- Release: npm trusted publishing (OIDC); the npm token is only a fallback.
- Tools are marked `openWorldHint: false` (one tenant's records).
- A server started without a key says how to set one up, for the terminal,
  the plugin and the extension.
- Client configs written by `setup` and printed by `init` run
  `cloud-alm-mcp-server@beta` while the version is a prerelease (the bare
  name after 0.1.0), not the exact version, so users get updates.
- Every follow-up command is printed as it must be typed:
  `npx -y cloud-alm-mcp-server@beta doctor`, or the bare command from a
  global install.
- `setup` checks the Node version first and says how to update it.
- `setup` on a terminal says that `~/Downloads` has no key before it asks
  to paste one, and reports a Downloads folder it may not read (macOS
  privacy settings) instead of passing over it.

### Fixed

- Test plan membership comes from the plans' assignments in every tool: a
  case in a plan that never ran is "not run" everywhere (overview, list,
  gaps, coverage and the plan read agreed on 12 vs 14 before).
- Gap rows of test cases carry their result, per-plan results and link;
  orphan and unprepared rows no longer read "not in a test plan" for
  planned cases.
- Analytics groups use the readable status column and the same words as
  the other tools; with `projectId` the footer no longer says tenant-wide.
- `calm_changes` shows the creation time of created items.
- Unknown `classification` values are refused (`none` = not classified);
  empty results name the statuses in use; a process search that finds
  nothing lists the processes in scope.
- The SAP token request is retried on 5xx.

- Key files and client configs saved with a UTF-8 byte order mark (Windows
  editors, PowerShell) are read.
- `CALM_SERVICE_KEY` left as an unfilled `${…}` placeholder by a client
  counts as not set, so the saved key is used.
- No "mode 600" on Windows.

## [0.1.0-beta.2] - 2026-11-15

### Added

- `setup`: one command finds the service key downloaded to `~/Downloads`,
  checks and saves it, and adds the server to Claude Code, Codex, Claude
  Desktop and Cursor, whichever are installed. Desktop apps get the full
  path to npx, so they start the server without the shell's PATH. The README
  has a prompt that lets an agent run the setup.
- `scopes/read-only.json` and `scopes/read-write.json`: the parameters to
  paste when creating the "SAP Cloud ALM API" instance.
- Skills for functional consultants: fit-gap analysis, workshop
  preparation, notes to backlog, status report, test and go-live
  readiness, defect triage. The server also offers every skill as an MCP
  prompt.
- Requirements show their fit/gap classification and approval state;
  `calm_list` filters by `classification`.
- `calm_trace` on a defect names what it blocks (the items its test case
  covers, with their features).
- `calm_analytics` takes `projectId` (id or name).
- Open-source files: security policy, contributing guide, code of conduct,
  issue and pull request templates, Dependabot.

### Changed

- No settings: the key decides. A read-only key gets the read tools; a key
  with write scopes also gets the write tools those scopes allow, each
  write waiting for the user's approval (card or chat). `CALM_WRITE`,
  `CALM_APPROVAL`, `CALM_APPROVAL_DIALOG`, `CALM_TOOLS` and `CALM_PROJECT`
  are gone; projects are named per call.
- No confirm dialog (MCP elicitation): some clients decline it unseen.
- Test results use one vocabulary everywhere: "not run" is in a test plan
  and not executed, "not in a test plan" is in none (also a `calm_list`
  status). List rows carry `prepared` and per-plan `results` as data, and
  no longer the GUID.
- `calm_confirm` takes the tool's name with the id; `doctor` and `setup`
  list only the tools a key lacks scopes for.

### Fixed

- Test results and defect links read only the project's analytics rows,
  every page; before, a busy tenant could hide results past 200 rows.
- A write whose follow-up step fails (a comment, a new activity, the next
  task's tags) reports what was already written.
- Server guidance in errors is no longer cut at 200 characters; a write
  timeout says the outcome is unknown; an offline start retries the write
  tools later; document type names agree; `dueBefore` includes the day.

### Security

- The approval card takes an approval only from what the server attached,
  never from text a dry run could forge.
- Before writing, an approved change is run as a dry run again and refused
  if it no longer matches the preview the user saw.
- Text from Cloud ALM cannot close its data fence.
- Pending approvals are capped per approver; a library embedder gets
  approval by default.
- `setup` looks for keys in `~/Downloads` only, names the tenant, will not
  switch tenants without a named file or `--force`, and keeps client
  config files' mode and symlinks with a `.bak`; the key file is written
  through an exclusive, unguessable temp file.
- Release: the npm token reaches only the publish steps; the tag must be
  on `main`.

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

## Before the betas

- First version: read-only Cloud ALM reader and MCP server, stdio mode
  with a service key, streamable HTTP mode with a bearer per request.
  Not published.
