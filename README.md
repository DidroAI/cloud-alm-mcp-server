<img src="assets/icon.png" alt="" width="72" align="right">

# SAP Cloud ALM for your AI assistant

[![npm](https://img.shields.io/npm/v/cloud-alm-mcp-server?label=npm)](https://www.npmjs.com/package/cloud-alm-mcp-server)
[![CI](https://github.com/DidroAI/cloud-alm-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/DidroAI/cloud-alm-mcp-server/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

Ask your SAP Cloud ALM project questions in Claude, ChatGPT-style agents,
Codex, Cursor or VS Code, and let the assistant prepare changes that you
approve, field by field. An open-source [MCP](https://modelcontextprotocol.io)
server, `cloud-alm-mcp-server`.

| Where you want to use Cloud ALM | How to connect |
| --- | --- |
| Claude Desktop | [Download the extension](https://github.com/DidroAI/cloud-alm-mcp-server/releases/latest/download/cloud-alm-mcp-server.mcpb), open it, and select your SAP service key file. |
| Codex, Claude Code or Cursor | With Node.js 22+ and your service key, run `npx -y cloud-alm-mcp-server setup`. [Local install guide](docs/install.md) |
| Claude or ChatGPT in a browser | A web client needs a reachable HTTPS MCP endpoint. Try the [synthetic demo behind your own HTTPS forwarder](docs/hosted-preview.md). Didro does not currently provide a managed connection for customer tenants. |
| Your own gateway | Run the [Streamable HTTP server](docs/hosting.md). Your gateway authenticates callers and supplies the SAP bearer token for each request. |

- *"Where does the project stand, and what changed since Friday?"*
- *"What blocks UAT exit? List failed tests with their defects and the
  requirements without a test."*
- *"Prepare the fit-gap workshop for Order to Cash."*
- *"Lower 3-14 to high, due Friday, and add a note that pricing fixes it."*
  → an approval card shows the change; nothing is written until you click
  **Approve**.

<p>
<img src="docs/images/overview-light.png" alt="Project overview card: findings, project status and expandable breakdowns" width="49%">
<img src="docs/images/update-light.png" alt="Approval card: priority high → very high, new comment, Approve / Reject" width="49%">
</p>

> MIT licence. An independent open-source project, not
> affiliated with or endorsed by SAP. SAP and SAP Cloud ALM are trademarks of
> SAP SE.

## How it works

- **Your key, your machine.** The server runs on your computer with a
  service key of the *SAP Cloud ALM API* from your SAP BTP subaccount. No
  background telemetry. By default it connects only to SAP ([PRIVACY.md](PRIVACY.md)).
- **The key decides.** A read-only key reads. A key with write scopes also
  lets the assistant *propose* changes: create, update, comment, link, tag,
  delete. Every change waits for your approval in a card (or your "yes" in
  the chat).
- **Links back to Cloud ALM.** Items come with a link that opens them in the
  Cloud ALM UI, and you can paste a Cloud ALM link wherever an id is asked.

### Browsing results in chat

In clients with MCP Apps, project lists, search results and item details open
as cards. Use the Cloud ALM links to open the source record or its SAP app. **View all** expands
a compact list in hosts with fullscreen support. **Load more** fetches the
next page with the same filters. Clients that use text receive the read result.

For a host that supports MCP Apps and tool calls from a card, set
`CALM_CONTENT_PRESENTATION=explicit` in the server environment to show only
the final selection. The assistant reads the data, then calls `calm_show`
with selected IDs or list filters. The card fetches those records when it
opens. For a text answer or an export, the assistant can skip that last call.

### Optional agent feedback

Feedback is off by default. Didro does not operate a feedback inbox for this release. With your own receiver configured, the agent can call `calm_report_feedback` when a
tool behaves unexpectedly or a successful task takes avoidable extra work.
It reports the affected tool, outcome, a short observation and an optional
suggestion. The receipt gives you a report ID. Enable the tool once for the
installation. Your MCP client may apply its own tool permissions.

For a **key-free smoke test**, clone this repository and run:

```sh
bun install --frozen-lockfile
bun test test/feedback.test.ts
```

The test sends a synthetic report over MCP to a loopback inbox and checks its
exact contents. To try it in your local MCP client with your own SAP key, run
`bun run build` and leave `bun scripts/feedback-inbox.ts` running in a terminal.
Add a separate server entry to your client's MCP config. Replace both example
paths with absolute paths on your computer.

```json
{
  "mcpServers": {
    "cloud-alm-preview": {
      "command": "node",
      "args": ["/absolute/path/to/cloud-alm-mcp-server/dist/cli.js"],
      "env": {
        "CALM_SERVICE_KEY": "/absolute/path/to/service-key.json",
        "CALM_FEEDBACK_URL": "http://127.0.0.1:4317/reports"
      }
    }
  }
}
```

Restart the client and try a read-only question such as “Group the failed
tests by requirement.” When the agent reports friction, the inbox terminal
shows exactly what it received. Ordinary successful calls produce no report.
The same receiver setting works in the server's HTTP mode. A remote collector
must accept JSON by HTTPS and return 2xx after accepting the report.
`CALM_FEEDBACK_TOKEN` supplies an optional dedicated receiver credential.
For a shared HTTP installation, put caller authentication in front of the
MCP endpoint as described in [hosting](docs/hosting.md). Remove the receiver
setting and restart to disable reporting.

## Setup in 2 minutes (video)

https://github.com/user-attachments/assets/747194c4-332f-4be5-8da9-47faf746ee4c

Every click in SAP BTP, then `setup` in a terminal, or one prompt to your
coding agent. With narration, 2 minutes.

## 1. Get a service key

Someone with admin rights in the SAP BTP subaccount of your Cloud ALM tenant
creates an instance of the **SAP Cloud ALM API** service with the scopes in
[scopes/read-only.json](scopes/read-only.json) (or
[read-write.json](scopes/read-write.json)), creates a binding, and downloads
its JSON. Step by step, with an e-mail you can send to your BTP admin:
[docs/service-key.md](docs/service-key.md), or watch it in the
[setup video](#setup-in-2-minutes-video).

## 2. Install

**Local clients, one command** (needs [Node.js 22+](https://nodejs.org)):

```sh
npx -y cloud-alm-mcp-server setup
```

It finds the key you downloaded in `~/Downloads`, checks it against SAP,
saves it readable only by you, and adds the server to Claude Code, Codex,
Claude Desktop and Cursor, whichever are installed. Then open a new chat
(quit and reopen Claude Desktop) and ask: *"Where does my Cloud ALM project
stand?"*

Or pick your client:

| Client | How |
| --- | --- |
| Claude Desktop | [![Install in Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Install_extension-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/DidroAI/cloud-alm-mcp-server/releases/latest/download/cloud-alm-mcp-server.mcpb) Download, double-click, choose your key file. No terminal, no Node.js. |
| Claude Code | `/plugin install cloud-alm --marketplace DidroAI/cloud-alm-mcp-server` (server and skills) |
| Cursor | [![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=cloud-alm&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNsb3VkLWFsbS1tY3Atc2VydmVyIl19) after `setup` saved the key |
| VS Code (Copilot) | [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522cloud-alm%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522cloud-alm-mcp-server%2522%255D%257D) after `setup` saved the key |
| Codex | `setup` adds it; by hand: `codex mcp add cloud-alm -- npx -y cloud-alm-mcp-server` |

All channels, by hand and in detail: [docs/install.md](docs/install.md).

### Or let your agent do it

Download the key, then paste this into Claude Code, Codex, Cursor's agent or
any assistant with a terminal:

```text
Set up the SAP Cloud ALM MCP server for me: run `npx -y cloud-alm-mcp-server setup` and follow what it prints (instructions for agents: https://github.com/DidroAI/cloud-alm-mcp-server/blob/main/docs/agent-setup.md). Never open or print my service key file.
```

Tested with Codex and Claude Code: they run `setup`, check with `doctor`,
and tell you what to restart, without reading the key.
[What the agent follows](docs/agent-setup.md).

## 3. Ask

| You want | Ask, for example |
| --- | --- |
| The state of the project | "Where does the project stand?" |
| What moved | "What changed since Monday?" |
| Traceability | "Trace REQ-04: stories, features, transports, tests, defects." |
| Gaps and audit | "Which requirements have no passing test?" |
| Test readiness | "Are we ready to exit UAT?" |
| Who | "Who in the team can I assign the export defects to?" |
| SAP services | "Is there planned maintenance on our systems?" |

The tools behind these answers: [docs/tools.md](docs/tools.md).

## Skills: whole workflows

`skills/` holds agent skills for the work of a functional consultant; the
server also offers each one as an MCP prompt (pick it from your client's
prompt or slash-command menu):

| Skill | For |
| --- | --- |
| `cloud-alm-explore` | answering questions: which tool for which question |
| `cloud-alm-fit-gap` | fit-to-standard: fit, configuration or gap per requirement and process |
| `cloud-alm-workshop-prep` | agenda, open questions and decisions for a workshop |
| `cloud-alm-backlog-from-notes` | minutes or a transcript into requirements, user stories, tasks and comments |
| `cloud-alm-daily-brief` | what moved since yesterday, what is at risk, what is due |
| `cloud-alm-status-report` | a steering committee or weekly status report |
| `cloud-alm-test-readiness` | SIT/UAT entry and exit, go-live readiness, go / no-go |
| `cloud-alm-defect-triage` | duplicates, priority, owner and due date of open defects |
| `cloud-alm-test-design` | test cases for what is untested |

For Claude Code, copy a skill's folder to `~/.claude/skills/`; for other
agents, use the prompts or point the agent to the SKILL.md.

## Approving changes

When the assistant wants to change Cloud ALM, the tool only *proposes*: you
see the change field by field (before → after, what is created, what is
deleted) and click **Approve** or **Reject**. In apps without cards, the
assistant shows the change and waits for your "yes". Before writing, the
server checks the change still matches what you saw. Details and limits:
[docs/tools.md#approving-writes](docs/tools.md#approving-writes).

## Update, rotate, uninstall

```sh
npx -y cloud-alm-mcp-server doctor      # check key, token, scopes, API, Node
npx -y cloud-alm-mcp-server setup       # again after rotating the key
npx -y cloud-alm-mcp-server uninstall   # remove it from your apps (--key: also the saved key)
```

Client configs run `cloud-alm-mcp-server`, so you get updates on the
next start.

## Troubleshooting

- **"Cloud ALM is not set up yet"** in the app's MCP log: run `setup`, or
  choose the key file in the extension or plugin settings.
- **Token or API errors**: run `doctor`; it names the failing step. A
  corporate proxy or TLS inspection can block `npx` or SAP: set
  `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` as your IT advises.
- **"not readable with this key"**: the key lacks a scope; ask for the
  scope named in the answer ([docs/service-key.md](docs/service-key.md)).
- **Claude Desktop does not show the server**: quit it fully (also from the
  tray / menu bar) and reopen.

## Security

Reads are GET only, to `*.alm.cloud.sap` only. Writes go to a fixed
allow-list of SAP APIs and only after your approval. The key is stored
readable only by you and never printed or sent to the model. Text from Cloud
ALM reaches the model marked as data. A key opens the whole tenant (SAP
cannot limit it to one project): give read-only keys to whoever only reads.
More: [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md).

## More

- [Tools and outputs](docs/tools.md)
- [Getting a service key](docs/service-key.md)
- [All install channels](docs/install.md)
- [Running it as a shared HTTP endpoint](docs/hosting.md)
- [Using it as a library](docs/library.md)
- [Cloud ALM API notes, errors and limits](docs/cloud-alm-api.md)
- [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Code of conduct](CODE_OF_CONDUCT.md)

## Licence

MIT: see [LICENSE](LICENSE).
