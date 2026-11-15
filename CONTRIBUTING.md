# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Before you start

- For a bug, open an issue with the steps, the version and what you expected.
- For a new tool or a change to a tool's shape, open an issue first: tool
  names, parameters and outputs are a contract with every agent that uses
  them.
- Security problems go through the private channel in [SECURITY.md](SECURITY.md).

## Develop

Bun for development and tests, Node 22+ for the built package:

```sh
bun install
bun run typecheck
bun run test
bun run build
```

Tests run on hand-written fixtures (`test/tenant.ts`, `test/fixtures.ts`)
with invented values in the shapes a real tenant returns; they need no SAP
system. To try a change against a real tenant, use your own service key:

```sh
CALM_SERVICE_KEY=~/keys/calm-read.json bun scripts/live-check.ts stdio
```

## Rules

- Never commit a service key, a secret, a token or data from a real tenant.
  Fixtures are invented.
- Every write goes through the approval flow (`gated()` in `src/server.ts`).
  A pull request that adds a way to write without it will not be merged.
- Text that comes from Cloud ALM is data: keep it inside the fenced blocks.
- Tool answers are short and name the next step; read tools return
  `structuredContent` that matches their `outputSchema`.
- Add a test for each fix and each new behaviour.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:` …); add a line to `CHANGELOG.md` under
  *Unreleased* for anything a user would notice.

## Skills

The `skills/` folder holds agent skills (SKILL.md) for Cloud ALM workflows.
A new skill should name the tools it uses, ask before any write, and work
with a read-only key where it can.

## Licence

By contributing you agree that your contribution is licensed under the
[MIT licence](LICENSE).

## Releases

A release changes the version in `package.json`, `server.json` (the server
and its npm package), `manifest.json` and `.claude-plugin/plugin.json`;
`test/distribution.test.ts` fails when they differ. Pushing the tag `v<version>`
on main publishes to npm and the MCP Registry and attaches the Claude Desktop
extension to a GitHub Release. To build the extension locally:
`bun run build && scripts/build-mcpb.sh`.
