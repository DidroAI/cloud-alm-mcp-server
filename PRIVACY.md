# Privacy

## Hosted browser connection

When you connect through Didro’s hosted connector, your browser sends the service key to the connector’s consent endpoint. The server exchanges it with SAP and discards the uploaded key. It stores the temporary SAP grant encrypted in PostgreSQL and a digest of the connector bearer token. Access expires within one hour. Expired database rows are pruned on the next successful connection. The hosted connector reads SAP data. Agent feedback is enabled by default on Didro’s hosted service. When the assistant encounters tool friction it can send a short observation to Didro’s private inbox. Reports contain the fields described below. The connector does not automatically attach SAP results or conversation transcripts.

## Local installation

`cloud-alm-mcp-server` runs on your computer, started by your MCP client
(Claude Desktop, Claude Code, Codex, Cursor, VS Code, …). It communicates
with SAP and, for the agent reports described below, with Didro.

## What the server collects

The server sends no background analytics, crash reports or update checks,
and nothing is sent on its own.

**Agent reports, on by default.** When your assistant runs into a problem
with one of the server's tools (an unexpected answer, extra work, a dead
end), it can send Didro a short report through `calm_report_feedback`, so
the tools can be improved. A report holds:

- a generated report ID and the server's version;
- the tool's name and the outcome (blocked, recovered, or completed with
  extra work);
- one or two sentences written by the assistant about what the tool did,
  and optionally a suggestion.

The server attaches no SAP results, credentials, tenant address, project or
record, user name or chat history. The tool tells the assistant to describe
the tool's behaviour in generic words and refuses text holding web addresses,
e-mail addresses, credentials or record IDs. The sentences are still free
text written by an AI assistant, so they can hold private words it chose to
write. Your MCP client shows each call of the tool like any other.

Reports go to `https://calm.didro.ai/feedback`, which passes them to Didro's
private inbox. As with any request, Didro's hosting provider sees the
sender's IP address; it is used to limit how many reports one sender can
post and is not stored with the report.

**Turning reports off.** Run `npx -y cloud-alm-mcp-server feedback off` (for
every client on this computer; `feedback on` turns them back on), or set
`CALM_FEEDBACK=off` in a client's configuration. `doctor` shows which it is.
The tool is then not offered to the assistant at all.

**Another receiver.** An operator can set `CALM_FEEDBACK_URL`, and
`CALM_FEEDBACK_TOKEN` for its credential, to send the reports to a receiver
of their own instead of Didro. The operator then chooses who receives them
and how they are stored. In HTTP mode reports are off unless the operator
sets `CALM_FEEDBACK_URL`.

## Where it connects

By default, to the two SAP addresses named in your service key:

- the key's token host (`uaa.url`, for example
  `https://<subaccount>.authentication.eu20.hana.ondemand.com`), to get an
  access token with the key's client id and secret;
- your SAP Cloud ALM API (`endpoints.Api`, for example
  `https://eu20.alm.cloud.sap/api`), to read and, with your approval, write
  Cloud ALM data.

Unless agent reports are turned off, also to `https://calm.didro.ai/feedback`
(or the receiver in `CALM_FEEDBACK_URL`), only when your assistant sends a
report.

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
