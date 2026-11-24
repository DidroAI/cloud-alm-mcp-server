# Install

Every way to install the server, one per client. Back to the
[README](../README.md).

Configurations written during the beta name `cloud-alm-mcp-server@beta`,
which stays on 0.1.0. Run `npx -y cloud-alm-mcp-server setup` again to switch
them to the release line.

The key, in every channel: a service key of the "SAP Cloud ALM API" instance
in SAP BTP, downloaded as a JSON file.

## 1. Local clients: the setup command (recommended)

```sh
npx -y cloud-alm-mcp-server setup
```

In a terminal, setup asks three questions:

1. **Which service key?** Choose the key file (type its path or drag it into
   the window), paste the key (it is not shown), use a key found in
   `~/Downloads` from the last week, or keep the one saved before. "I don't
   have a key yet" says how to get one.
2. **Which apps?** Claude Code, Codex, Claude Desktop and Cursor, the ones
   installed, all ticked.
3. **The skills too?** The nine workflows of `skills/` (fit-gap, workshop
   preparation, status report, test readiness…), copied to where Claude Code
   (`~/.claude/skills`), Codex (`~/.agents/skills`) and Cursor read them, so
   the assistant uses one on its own when a request matches. Claude Desktop
   reads no skills from disk: there they are the server's prompts.

Between the two it checks the key against SAP and saves it readable only by
you; at the end it says what to restart. Needs
[Node.js 22 or later](https://nodejs.org).

Run by an AI agent, in CI, through a pipe or with `--no-input`, setup asks
nothing: it takes the newest key in `~/Downloads` from the last week, then the
key saved before, adds the server to every app installed and installs the
skills. `setup <file>`, `--client <list>` and `--no-skills` answer the
questions up front. `uninstall` takes the skills out again.

```sh
npx -y cloud-alm-mcp-server doctor      # check key, token, scopes, API
npx -y cloud-alm-mcp-server uninstall   # remove it from the clients (--key: and the saved key)
```

## Paste a prompt into your agent

```text
Set up the SAP Cloud ALM MCP server for me: run `npx -y cloud-alm-mcp-server setup` and follow what it prints (instructions for agents: https://github.com/DidroAI/cloud-alm-mcp-server/blob/main/docs/agent-setup.md). Never open or print my service key file.
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

Claude Desktop warns that the extension gets access to your computer and
that its developer information is not verified by Anthropic. It shows this
for every extension installed from a file rather than from Anthropic's
directory. The extension runs `dist/cli.js` from this repository on your
machine and connects only to SAP by default ([PRIVACY.md](../PRIVACY.md)); each release is
built by GitHub Actions from a tagged commit.

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
claude mcp add cloud-alm --scope user -- npx -y cloud-alm-mcp-server
```

## 4. Cursor

First save the key (`npx -y cloud-alm-mcp-server setup`, which also adds
the server to Cursor when Cursor is installed). The button adds the server by
hand; it uses the key that `setup` saved.

```markdown
[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=cloud-alm&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNsb3VkLWFsbS1tY3Atc2VydmVyIl19)
```

Light button: `https://cursor.com/deeplink/mcp-install-light.svg`.

The deeplink itself (GitHub does not render `cursor://` links, so the README
uses the `https://cursor.com/install-mcp` page above, which opens it):

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=cloud-alm&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNsb3VkLWFsbS1tY3Atc2VydmVyIl19
```

`config` is the base64 of:

```json
{"command":"npx","args":["-y","cloud-alm-mcp-server"]}
```

## 5. VS Code (GitHub Copilot)

First save the key (`npx -y cloud-alm-mcp-server setup`); the server
installed by the button uses it.

```markdown
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522cloud-alm%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522cloud-alm-mcp-server%2522%255D%257D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522cloud-alm%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522cloud-alm-mcp-server%2522%255D%257D)
```

The link behind the redirect:

```text
vscode:mcp/install?%7B%22name%22%3A%22cloud-alm%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22cloud-alm-mcp-server%22%5D%7D
```

Once the server is in the official MCP Registry, VS Code can also open it by
name: `vscode:mcp/by-name/io.github.DidroAI/cloud-alm-mcp-server`.

By hand, in `.vscode/mcp.json` or the user's `mcp.json`:

```json
{
  "servers": {
    "cloud-alm": { "command": "npx", "args": ["-y", "cloud-alm-mcp-server"] }
  }
}
```

## 6. Codex

`setup` adds the server to Codex when Codex is installed. By hand, after the
key is saved:

```sh
codex mcp add cloud-alm -- npx -y cloud-alm-mcp-server
```

## 7. Official MCP Registry

Listed as `io.github.DidroAI/cloud-alm-mcp-server` (from `server.json`,
published by the release workflow). Clients that read the registry install it
from there.

## If no key was set

A server started without a key stops with this message (in the client's MCP
log):

> Cloud ALM is not set up yet: no service key was found. Run
> `npx -y cloud-alm-mcp-server setup` in a terminal (it finds the key JSON
> you downloaded from SAP BTP and saves it), or set CALM_SERVICE_KEY to the key
> file's path. In a Claude Code plugin or Claude Desktop extension, choose the
> key file in its settings.

## Privacy line

By default the server connects only to your key's SAP token host and to your
Cloud ALM API (`*.alm.cloud.sap`); what the tools return goes to the AI model
your client uses. See [PRIVACY.md](../PRIVACY.md).
