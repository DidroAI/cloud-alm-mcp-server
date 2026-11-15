# Privacy

`cloud-alm-mcp-server` runs on your computer, started by your MCP client
(Claude Desktop, Claude Code, Codex, Cursor, VS Code, …). Didro operates no
service behind it and receives nothing from it.

## What the server collects

Nothing. It has no telemetry, no analytics, no crash reports and no update
check. It writes no log of your data.

## Where it connects

Only to the two SAP addresses named in your service key:

- the key's token host (`uaa.url`, for example
  `https://<subaccount>.authentication.eu20.hana.ondemand.com`), to get an
  access token with the key's client id and secret;
- your SAP Cloud ALM API (`endpoints.Api`, for example
  `https://eu20.alm.cloud.sap/api`), to read and, with your approval, write
  Cloud ALM data.

SAP processes these requests under your organisation's agreement with SAP.
The server refuses an API address that is not an https `*.alm.cloud.sap`
address. In HTTP mode the server holds no key; it forwards the bearer token
of each request to the Cloud ALM API address of that request.

## What stays on your computer

- The service key: `setup` and `init` save it in your user profile
  (`~/.config/cloud-alm-mcp-server/service-key.json`, or
  `%APPDATA%\cloud-alm-mcp-server\service-key.json` on Windows), readable
  only by you. The Claude Desktop extension and the Claude Code plugin store
  the path of the key file you chose, not its contents.
- Access tokens and short-lived caches of what was read: in memory only,
  gone when the server stops.

The key, its secret and tokens are never printed and never sent to the AI
model.

## What the AI model sees

Whatever the tools return: Cloud ALM data of the projects your key can read
(titles, descriptions, comments, names of assignees, test results, …). The
server hands it to your MCP client, and the client sends it to the AI model
it uses. Which model that is, where it runs and how long its provider keeps
the data is decided by that client and your agreement with its provider, not
by this server. Check that this fits your organisation's rules for Cloud ALM
data before you connect a project.

## Removing it

`npx -y cloud-alm-mcp-server uninstall --key` removes the server from the
clients and deletes the saved key. Delete the service key in SAP BTP to
revoke it.

## Contact

Questions: open an issue at
<https://github.com/DidroAI/cloud-alm-mcp-server/issues>. Security reports:
see [SECURITY.md](SECURITY.md).
