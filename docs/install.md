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
   have a key yet" says how to get one and asks again.
2. **Which apps?** Claude Code, Codex, Claude Desktop and Cursor, the ones
   installed, all ticked.
3. **The skills too?** The nine workflows of `skills/` (fit-gap, workshop
   preparation, status report, test readiness…), so the assistant uses one on
   its own when a request matches. They are copied to where the chosen apps
   read skills:

   | App | Folder |
   | --- | --- |
   | Claude Code | `~/.claude/skills` (`$CLAUDE_CONFIG_DIR/skills` when that variable is set) |
   | Codex | `~/.agents/skills` |
   | Cursor | the Claude Code folder when Claude Code is set up too, else the Codex folder when Codex is, else `~/.cursor/skills` |
   | Claude Desktop | none: it reads no skills from disk; there they are the server's prompts |

After the first question it checks the key against SAP (a token, its scopes,
one read) and saves it readable only by you; a key that fails is not saved,
and setup asks again. It asks before it replaces a saved key of another
tenant, and before it uses a key whose addresses are not SAP's.
`setup <file>` names the key up front: the first question is skipped, the
others are asked. At the end it prints one line per app, what to restart, a first
question to ask, and whether reports about tool problems are on
([below](#reports-about-tool-problems)). Needs
[Node.js 22 or later](https://nodejs.org).

Setup asks nothing when an AI agent runs it, in CI, through a pipe, or with
`--no-input`; `setup -` reads the key from standard input and asks nothing
either. It then takes the file named, else the newest key in `~/Downloads`
from the last week, else the key saved before; adds the server to every app
installed; and installs the skills. Without a key it stops and says so. A
key it found on its own is not used when its addresses are not SAP's, and
never replaces a saved key of another tenant: name the file, or pass
`--force`.

| Option | Does |
| --- | --- |
| `--client <list>` | Only these apps, no question: `claude-code`, `codex`, `claude-desktop`, `cursor`, separated by commas, or `all`, or `none` (save the key only) |
| `--no-skills` | Do not install the skills, and do not ask |
| `--no-input` | Ask nothing, also in a terminal |
| `--force` | Replace a saved key of another tenant without asking |
| `--skip-check` | Save the key without contacting SAP |

The other commands:

```sh
npx -y cloud-alm-mcp-server doctor      # check the setup
npx -y cloud-alm-mcp-server feedback    # are reports about tool problems on? (feedback off / feedback on)
npx -y cloud-alm-mcp-server uninstall   # remove it and its skills from the clients (--key: and the saved key)
npx -y cloud-alm-mcp-server init <file> # check and save a key, print each client's configuration; changes no app
```

`doctor` prints one line per check: Node, Key (where the key is, and a
warning when others can read the file), API, Token, Scopes (the tools the
key cannot fully serve), Writes (the write tools the key allows), Read (one
read of the projects; with several projects, a Project line) and Reports (whether reports about tool problems are
on, and the command to switch them). It ends with `Ready.` or `Setup has
problems.`

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
machine. It connects to SAP and, when your assistant sends a report about a
tool problem, to `https://docs.didro.ai/cloud-alm/feedback`
([turning reports off](#reports-about-tool-problems),
[PRIVACY.md](../PRIVACY.md)). Each release is built by GitHub Actions from a
tagged commit.

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

**The plugin or `setup`, not both.** `setup` also adds the server to Claude
Code (for all projects) and copies the skills to `~/.claude/skills`. With
the plugin installed as well, Claude Code starts two copies of the server
and lists every tool and every skill twice. Choose one:

- `setup` for Claude Code too (the default): do not install the plugin, or
  remove it with `/plugin uninstall cloud-alm@didro`.
- The plugin in Claude Code, `setup` for the other apps: run
  `npx -y cloud-alm-mcp-server setup --client codex,claude-desktop,cursor`
  (name the apps you use). If `setup` already added Claude Code, take that
  entry and its skills out with
  `npx -y cloud-alm-mcp-server uninstall --client claude-code`. The plugin
  uses the key `setup` saved when its key field is left empty.

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
> `npx -y cloud-alm-mcp-server setup` in a terminal (it asks for the key JSON
> you downloaded from SAP BTP, checks it and saves it), or set CALM_SERVICE_KEY to the key
> file's path. In a Claude Code plugin or Claude Desktop extension, choose the
> key file in its settings.

## Reports about tool problems

Since 0.3.1 a local install offers the assistant one more tool,
`calm_report_feedback`, on by default in every install channel above. When
the assistant runs into a problem with a tool it can post a short report to
`https://docs.didro.ai/cloud-alm/feedback`: the tool's name, the outcome (blocked,
recovered, or completed with extra work), an observation, optionally a
suggestion, the server's version and a random report ID. The assistant
writes the observation and the suggestion; the server adds no data from
your tenant and sends no token or key. Nothing is sent in the background,
and one running server sends ten reports at most.
Details: [PRIVACY.md](../PRIVACY.md).

```sh
npx -y cloud-alm-mcp-server feedback        # say whether reports are on
npx -y cloud-alm-mcp-server feedback off    # turn them off
npx -y cloud-alm-mcp-server feedback on     # turn them back on
```

`feedback off` writes a marker file, `feedback-off`, next to the
saved key (`~/.config/cloud-alm-mcp-server/`, or
`%APPDATA%\cloud-alm-mcp-server\` on Windows). Every copy of the server
started on this computer looks there, whichever way it was installed.
`CALM_FEEDBACK=off` in one app's server entry turns reports off for that
app only. Either way the tool is no longer offered to the assistant; start
a new chat (quit and reopen Claude Desktop) for the change to take effect.
Running `setup` again writes the app's entry anew, without `CALM_FEEDBACK`;
`feedback off` stays.

| Installed with | Turn reports off |
| --- | --- |
| `setup`, or an entry added by hand (Claude Code, Codex, Claude Desktop, Cursor, VS Code) | `feedback off`, or add `"CALM_FEEDBACK": "off"` to the `env` of the `cloud-alm` entry in that app's configuration (in Codex's `config.toml`: `CALM_FEEDBACK = "off"` in the entry's `env`) |
| Claude Desktop extension (.mcpb) | Switch off "Send Didro short reports about tool problems" in the extension's settings, or `feedback off` |
| Claude Code plugin | Switch off the same option in the plugin's settings, or `feedback off` |
| MCP Registry | Set `CALM_FEEDBACK` to `off` where your client asks for the server's variables, or `feedback off` |

`doctor` and `feedback` say which of the two turned reports off. To send
the reports to a receiver of your own instead of Didro, set
`CALM_FEEDBACK_URL` (below). Over HTTP (`cloud-alm-mcp-server http`) the
tool exists only when `CALM_FEEDBACK_URL` is set.

## Environment variables

Set them in the `env` of the server's entry in your app's configuration, or
in the shell that starts the server.

| Variable | Applies to | Meaning |
| --- | --- | --- |
| `CALM_SERVICE_KEY` | stdio, `doctor` | The service key: the path of its JSON file, or the JSON itself. Unset: the key saved by `setup` or `init` |
| `CALM_CONFIG_DIR` | stdio and every command | The folder that holds the saved key (`service-key.json`) and the `feedback-off` marker. Unset: `%APPDATA%\cloud-alm-mcp-server` on Windows, else `$XDG_CONFIG_HOME/cloud-alm-mcp-server`, by default `~/.config/cloud-alm-mcp-server` |
| `CALM_WEB_URL` | stdio, HTTP | The address of your Cloud ALM UI, for the links to items: `https://<tenant>.<region>.alm.cloud.sap`. Unset: derived from the service key in stdio mode; over HTTP a request can send `X-Calm-Web-Url`. Other hosts are ignored |
| `CALM_CONTENT_PRESENTATION` | stdio, HTTP | `explicit`: read tools open no card, and the assistant shows a card of its final selection with `calm_show` ([Tools](tools.md#links-words-and-cards)). Unset or any other value: lists and item details open as cards on their own |
| `CALM_APPROVAL` | stdio | `card`: changes can only be approved in the approval card. `chat`: approval in the chat is accepted even in an app that says it shows cards. Unset: decided per app. Any other value stops the server at start ([Tools](tools.md#approving-writes)) |
| `CALM_FEEDBACK` | stdio | `off`: no reports about tool problems from this server entry, and no `calm_report_feedback` tool. Any value other than `on`, `1`, `true` or `yes` counts as off. Unset: on, unless `feedback off` was run |
| `CALM_FEEDBACK_URL` | stdio, HTTP | Send the reports to this receiver instead of Didro: an `https://` address (plain `http://` only on localhost) without credentials, query or fragment. Over HTTP, reports exist only when it is set |
| `CALM_FEEDBACK_TOKEN` | stdio, HTTP | Sent as `Authorization: Bearer …` to the receiver in `CALM_FEEDBACK_URL`. Never sent to Didro's inbox |
| `CALM_API_URL` | HTTP | The Cloud ALM API address for requests without an `X-Calm-Api-Url` header, e.g. `https://eu20.alm.cloud.sap/api`. In stdio mode the address comes from the service key |
| `PORT`, `HOST` | HTTP | Where to listen. Default `127.0.0.1:3333` |

`setup` and `uninstall` also read `CLAUDE_CONFIG_DIR` (where Claude Code
keeps its configuration and skills) and `XDG_CONFIG_HOME`, `APPDATA` and
`LOCALAPPDATA` (where Claude Desktop keeps its configuration). `setup` asks
nothing when `CI` or a variable a coding agent sets for its commands is set
to anything but `0`, `false`, `no` or `off` (`CLAUDECODE`, `CODEX_SANDBOX`,
`CURSOR_AGENT`, `GEMINI_CLI`, …), or when `TERM` is `dumb`.

## Privacy line

A local install connects to your key's SAP token host and to your Cloud ALM
API (`*.alm.cloud.sap`). Unless you turned reports off, it also posts to
`https://docs.didro.ai/cloud-alm/feedback` when your assistant sends a report about a
tool problem ([above](#reports-about-tool-problems)). What the tools return
goes to the AI model your client uses. See [PRIVACY.md](../PRIVACY.md).

