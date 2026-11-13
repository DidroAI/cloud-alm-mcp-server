# Changelog

All notable changes to this package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
- CI on Node 22 and 24, with a check of the packed command; a release
  workflow (tag `v*` → `npm publish --provenance`) that stays inert until
  an `NPM_TOKEN` secret exists.

## 0.1.0

- First version: read-only Cloud ALM reader and MCP server, stdio mode
  with a service key, streamable HTTP mode with a bearer per request.
  Not published.
