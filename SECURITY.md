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

The latest release (and, before 0.1.0, the latest beta) gets fixes.

## What matters most

- A write reaching Cloud ALM without the user's approval (card or chat).
- The approval nonce, a token or a key secret appearing in model-visible
  text, logs, errors or structured content.
- An approval proposed in one HTTP session being used from another.
- `calm_api` reaching a path or method outside its read-only allow-list.
- Text stored in Cloud ALM (descriptions, comments, documents) steering the
  agent into actions the user did not ask for.

## How the server handles secrets

- The service key stays on the user's machine: `setup` and `init` save it
  readable only by the user (mode 600) and never print it.
- Tokens are fetched with the key's client credentials and kept in memory.
- In HTTP mode the server holds no key: each request brings its own bearer
  token, kept in memory only while its read cache is fresh (45 seconds),
  and approvals are bound to it.
- A key with write scopes can change the whole tenant (SAP cannot limit a key
  to one project). Give read-only keys to anyone who only needs to read.
