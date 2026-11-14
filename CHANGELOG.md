# Changelog

All notable changes to this package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
