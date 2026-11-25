# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Before you start

- For a bug, open an issue with the steps, the version and what you expected.
- For a new tool or a change to a tool's shape, open an issue first: tool
  names, parameters and outputs are a contract with every agent that uses
  them.
- Security problems go through the private channel in [SECURITY.md](SECURITY.md).

## How a change lands

1. Fork the repository and create a branch.
2. Make the change with its test; run the checks below.
3. Open a pull request against `main` and fill in the template.
4. CI must pass (typecheck, tests, build on Node 22 and 24). For a pull
   request from a fork, a maintainer approves the CI run first.
5. A maintainer reviews it. Only maintainers can merge; `main` accepts
   changes through reviewed pull requests only, and pull requests are
   squash-merged.

Looking for a place to start? See the issues labelled
[good first issue](https://github.com/DidroAI/cloud-alm-mcp-server/labels/good%20first%20issue)
and [help wanted](https://github.com/DidroAI/cloud-alm-mcp-server/labels/help%20wanted).

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

Maintainers release; only they can push `v*` tags.

1. If the release needs something new from the hosted connector (an
   endpoint, as `/feedback` was), deploy the hosted connector with it first
   (step 7 says how).
2. Set the new version in five places: `package.json`, `server.json` (twice:
   the server's `version` and its npm package's), `manifest.json`,
   `.claude-plugin/plugin.json`, and `SERVER_VERSION` in `src/server.ts`.
   `test/distribution.test.ts` fails when the four files differ and
   `test/server.test.ts` when `SERVER_VERSION` does; that constant is the
   version the server reports to clients and puts in agent reports.
3. In `CHANGELOG.md`, turn *Unreleased* into the version with its date.
4. Open a pull request and merge it.
5. On `main`, tag the merge commit `v<version>` and push the tag. The
   release workflow (`.github/workflows/release.yml`) runs the checks,
   refuses a tag that is not on `main` or does not match `package.json`,
   publishes to npm (a prerelease under `beta`, else `latest`), lists the
   version in the MCP Registry from `server.json`, and attaches the Claude
   Desktop extension (`.mcpb`) to a GitHub Release. If the registry step
   fails, the npm release stands; run the *MCP Registry* workflow by hand.
6. After a release (not a prerelease, which is published under `beta`
   already), move the `beta` tag to it, so that installs from the beta,
   whose app entries name `cloud-alm-mcp-server@beta`, follow:
   `npm dist-tag add cloud-alm-mcp-server@<version> beta`. This needs a
   maintainer's npm login: the workflow's trusted publisher may publish but
   cannot move tags.
7. Point the hosted connector at the release. The connector at
   docs.didro.ai/cloud-alm/connect is built by the docs site's project from
   a commit of this repository pinned in its `package.json`: pin the release
   commit there and push its `main`, which deploys it.

`hosted/package.json` names the version of `cloud-alm-mcp-server` that a
deployment of `hosted/` on its own serves; it needs no pull request per
release. CI does not use it: it runs the hosted tests against the working
tree's own build.

To build the extension locally: `bun run build && scripts/build-mcpb.sh`.
