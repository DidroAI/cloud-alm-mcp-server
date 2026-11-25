# Security policy

## Reporting a vulnerability

Report it privately through
[GitHub Security Advisories](https://github.com/DidroAI/cloud-alm-mcp-server/security/advisories/new),
not in a public issue. Include the version (`cloud-alm-mcp-server --version`),
the client and transport (stdio or HTTP), and the steps to reproduce. Never
include a service key, a client secret or a token: redact them, and rotate
any key that was exposed.

We answer within five working days and publish a fix and an advisory once
users can update.

## Supported versions

The latest release gets fixes.

## What matters most

- A write reaching Cloud ALM without the user's approval (card or chat).
- The approval nonce, a token or a key secret appearing in model-visible
  text, logs, errors or structured content.
- An approval proposed with one bearer token (HTTP mode) being approved
  with another.
- `calm_api` reaching a path or method outside its read-only allow-list.
- Text stored in Cloud ALM (descriptions, comments, documents) steering the
  agent into actions the user did not ask for.

## What approval does not cover

- **Approval in the chat trusts the agent.** In an app that shows the
  approval card with working buttons, only the card approves. In an app
  without one (a terminal, for instance), the agent passes the user's yes on
  with `calm_confirm`, and the server cannot check that the user said it. An
  agent misled by text it read could confirm its own proposal there; the
  app's permission prompt for `calm_confirm` is the guard. Do not "always
  allow" that tool, or set `CALM_APPROVAL=card` to refuse approval in the
  chat altogether.
- **An agent with a shell can read the saved key.** Claude Code, Codex,
  Cursor and similar agents run commands as the user, and the key file is
  readable by the user. Such an agent can call the Cloud ALM API directly,
  without this server and without approval. File permissions cannot prevent
  that. Where an agent has a shell, use a key without write scopes unless
  you need it to write, and keep the agent's own command approval on.
- **Reports about tool problems are written by the agent.** The server
  attaches no records, credentials or chat text; the one or two sentences
  are written by the assistant. The tool refuses text that looks like a web
  address, an e-mail address, a bearer token or a GUID, and control
  characters; it does not recognise a short item id or a name. Turn reports
  off with `cloud-alm-mcp-server feedback off` where that is not acceptable.

## Updates and pinning

`setup` writes `npx -y cloud-alm-mcp-server` into each app, without a
version: the app starts the newest release, so fixes arrive without a
reinstall. The price is trust in each new release at the moment it is
published. Releases are published from GitHub Actions with npm provenance,
which `npm audit signatures` checks. To decide yourself when to update, put
a version in the app's entry (`cloud-alm-mcp-server@<version>`); `setup` run
again writes the entry without it.

Started with `cloud-alm-mcp-server http` on the loopback address, the server
answers only to `127.0.0.1`, `localhost` and `[::1]` with its port, and
refuses requests that carry another site's `Origin`, so a web page cannot
reach it through the browser.

## How the server handles secrets

- In a local install the service key stays on the user's machine: `setup`
  and `init` save it readable only by the user (mode 600; on Windows, which
  has no file modes, in the user's own profile) and never print it.
- Tokens are fetched with the key's client credentials and kept in memory.
- In HTTP mode the server holds no key: each request brings its own bearer
  token, kept in memory only while its read cache is fresh (45 seconds),
  and approvals are bound to it.
- A key with write scopes can change the whole tenant (SAP cannot limit a key
  to one project). Give read-only keys to anyone who only needs to read.

## Hosted connector

Didro's hosted connector for ChatGPT and Claude (the code in `hosted/`)
handles the key differently from a local install: your browser uploads the
service key file to Didro's server during sign-in. The server exchanges it
with SAP once and discards it. It keeps only the temporary SAP token,
encrypted, for at most one hour; the app gets a separate random token, of
which the server stores a digest. The connector has no write tools.

Anyone who can use that connection in the app can read what the key can
read. Use a key without write scopes, and continue on the sign-in page only
when you started the connection yourself, never from a link someone sent
you. What the hosted connector stores and counts: [PRIVACY.md](PRIVACY.md).
