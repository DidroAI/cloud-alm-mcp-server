# Install

Every way to install the server, one per client. Back to the
[README](../README.md).

While the version is a beta, the snippets name `cloud-alm-mcp-server@beta`.
After 0.1.0, replace it with `cloud-alm-mcp-server` everywhere (and rebuild
the two install links: the configuration is encoded in them).

The key, in every channel: a service key of the "SAP Cloud ALM API" instance
in SAP BTP, downloaded as a JSON file.

## 1. Any client: the setup command (recommended)

```sh
npx -y cloud-alm-mcp-server@beta setup
```

Finds the key in `~/Downloads`, checks it against SAP, saves it readable only
by you, and adds the server to Claude Code, Codex, Claude Desktop and Cursor,
whichever are installed. Needs [Node.js 22 or later](https://nodejs.org).

```sh
npx -y cloud-alm-mcp-server@beta doctor      # check key, token, scopes, API
npx -y cloud-alm-mcp-server@beta uninstall   # remove it from the clients (--key: and the saved key)
```

## Paste a prompt into your agent

```text
Set up the SAP Cloud ALM MCP server for me: run `npx -y cloud-alm-mcp-server@beta setup` and follow what it prints (instructions for agents: https://github.com/DidroAI/cloud-alm-mcp-server/blob/main/docs/agent-setup.md). Never open or print my service key file.
```

## 2. Claude Desktop: one-click extension (.mcpb)

No terminal, no Node.js to install.

1. Download
   [cloud-alm-mcp-server.mcpb](https://github.com/DidroAI/cloud-alm-mcp-server/releases/latest/download/cloud-alm-mcp-server.mcpb).
2. Double-click it (or in Claude Desktop: Settings → Extensions → Advanced
   settings → Install Extension…) and click Install.
3. Choose your service key file when Claude asks for "Cloud ALM service key
   (JSON file)".
4. Open a new chat and ask: "Where does my Cloud ALM project stand?"

Badge:

```markdown
[![Install in Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Install_extension-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/DidroAI/cloud-alm-mcp-server/releases/latest/download/cloud-alm-mcp-server.mcpb)
```

The download link works from the first release that carries the file (the
release workflow attaches it to every tag from the next one on). All
versions: <https://github.com/DidroAI/cloud-alm-mcp-server/releases>.

## 3. Claude Code: plugin (server and skills)

In Claude Code (2.1.275 or later), one step:

```text
/plugin install cloud-alm --marketplace DidroAI/cloud-alm-mcp-server
```

Or in two steps, which also works in a shell as `claude plugin …`:

```text
/plugin marketplace add DidroAI/cloud-alm-mcp-server
/plugin install cloud-alm@didro
```

Claude Code asks for the service key file when the plugin is enabled; leave
it empty if `setup` already saved your key. The plugin brings the MCP server
and the skills (fit-gap, workshop preparation, status report, test readiness,
defect triage, test design, …).

Server only, without the skills:

```sh
claude mcp add cloud-alm --scope user -- npx -y cloud-alm-mcp-server@beta
```

## 4. Cursor

First save the key (`npx -y cloud-alm-mcp-server@beta setup`, which also adds
the server to Cursor when Cursor is installed). The button adds the server by
hand; it uses the key that `setup` saved.

```markdown
[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=cloud-alm&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNsb3VkLWFsbS1tY3Atc2VydmVyQGJldGEiXX0%3D)
```

Light button: `https://cursor.com/deeplink/mcp-install-light.svg`.

The deeplink itself (GitHub does not render `cursor://` links, so the README
uses the `https://cursor.com/install-mcp` page above, which opens it):

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=cloud-alm&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNsb3VkLWFsbS1tY3Atc2VydmVyQGJldGEiXX0%3D
```

`config` is the base64 of:

```json
{"command":"npx","args":["-y","cloud-alm-mcp-server@beta"]}
```

## 5. VS Code (GitHub Copilot)

First save the key (`npx -y cloud-alm-mcp-server@beta setup`); the server
installed by the button uses it.

```markdown
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522cloud-alm%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522cloud-alm-mcp-server%2540beta%2522%255D%257D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522cloud-alm%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522cloud-alm-mcp-server%2540beta%2522%255D%257D)
```

The link behind the redirect:

```text
vscode:mcp/install?%7B%22name%22%3A%22cloud-alm%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22cloud-alm-mcp-server%40beta%22%5D%7D
```

Once the server is in the official MCP Registry, VS Code can also open it by
name: `vscode:mcp/by-name/io.github.DidroAI/cloud-alm-mcp-server`.

By hand, in `.vscode/mcp.json` or the user's `mcp.json`:

```json
{
  "servers": {
    "cloud-alm": { "command": "npx", "args": ["-y", "cloud-alm-mcp-server@beta"] }
  }
}
```

## 6. Codex

`setup` adds the server to Codex when Codex is installed. By hand, after the
key is saved:

```sh
codex mcp add cloud-alm -- npx -y cloud-alm-mcp-server@beta
```

## 7. Official MCP Registry

Listed as `io.github.DidroAI/cloud-alm-mcp-server` (from `server.json`,
published by the release workflow). Clients that read the registry install it
from there.

## If no key was set

A server started without a key stops with this message (in the client's MCP
log):

> Cloud ALM is not set up yet: no service key was found. Run
> `npx -y cloud-alm-mcp-server@beta setup` in a terminal (it finds the key JSON
> you downloaded from SAP BTP and saves it), or set CALM_SERVICE_KEY to the key
> file's path. In a Claude Code plugin or Claude Desktop extension, choose the
> key file in its settings.

## Privacy line

No telemetry. The server talks only to your key's SAP token host and to your
Cloud ALM API (`*.alm.cloud.sap`); what the tools return goes to the AI model
your client uses. See [PRIVACY.md](../PRIVACY.md).
