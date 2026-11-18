# Setting up the SAP Cloud ALM MCP server (instructions for an AI agent)

You are an AI agent with a terminal (Claude Code, Codex, Cursor, …). The
user asked you to set up the SAP Cloud ALM MCP server
(`cloud-alm-mcp-server`). Follow these steps in order. Keep the user
informed in one or two lines per step.

## Rules

- **Never open, print, copy or upload the service key file.** It holds a
  client secret. Only pass its path to the commands below; they never print
  it.
- Do not edit MCP client config files by hand: `setup` does it and keeps a
  `.bak` of each file it changes.
- Ask the user only when a step below says so.

## 1. Check Node.js

Run `node --version`. It must be 22 or later. If Node is missing or older,
tell the user to install the LTS version from https://nodejs.org (or with
their package manager), then continue.

## 2. Run setup

```sh
npx -y cloud-alm-mcp-server setup
```

`setup` looks for the newest service key JSON in `~/Downloads` (downloaded
in the last 7 days), checks it against SAP, saves it readable only by the
user, and adds the server to Claude Code, Codex, Claude Desktop and Cursor,
whichever are installed. It prints one line per check and per client, never
the key.

Read the output:

| Output | What to do |
| --- | --- |
| `✓` lines and `Key saved at …` | Go to step 3. |
| `No service key found in ~/Downloads` | Ask the user where the key JSON is, then run `npx -y cloud-alm-mcp-server setup "<path>"`. If they have no key yet, go to "No key yet" below. |
| `A key for another tenant … is saved` | Ask the user whether to switch tenants. Only on their yes, run `setup "<path>"` with the file they name, or add `--force`. |
| `✗ Token …` | The key was refused or SAP did not answer. Report the Token message and retry setup with the same key after resolving the issue. A corporate proxy may need `HTTPS_PROXY` / `NODE_EXTRA_CA_CERTS`: ask the user's IT, do not guess values. |
| `✗ Scopes … it can read nothing` | Setup stopped before saving the key or configuring clients. Ask the BTP admin for a key with the listed read scopes, then run setup again. |
| `✗ Read …` | The token exchange worked and the API read failed. Use the Read message to diagnose the issue and retry setup. |
| `! Scopes … needs …` | The key works but lacks scopes for some tools. Report which; the user's BTP admin can add them (see `docs/service-key.md`). |
| `✗ <client>` with "Add it by hand" | Show the user the snippet `setup` printed for that client. |

## 3. Tell the user what to restart

- **Claude Desktop:** quit it fully (menu bar / tray too) and reopen.
- **Claude Code, Codex:** start a new session (`/exit`, then start again).
  If you are running inside one of them, say that the new tools appear in
  the next session.
- **Cursor:** reload the window.

If the project read succeeded, suggest *"Which Cloud ALM projects can I access?"*. If projects were refused, suggest a question covered by the scopes shown, such as a landscape question for a landscape-only key.

## 4. Check (optional)

```sh
npx -y cloud-alm-mcp-server doctor
```

prints the API address, the token, the scopes, the write tools the key allows, and
one read from Cloud ALM. `Ready.` at the end means done.

## No key yet

The key comes from SAP BTP: an instance of the **SAP Cloud ALM API**
service in the subaccount of the user's Cloud ALM tenant, with a service
binding whose JSON is downloaded. Creating it needs admin rights in that
subaccount. Point the user to
https://github.com/DidroAI/cloud-alm-mcp-server/blob/main/docs/service-key.md
(step by step, with a video and an e-mail to send to their BTP admin), and
stop until they have the file.

## Undo

```sh
npx -y cloud-alm-mcp-server uninstall          # remove from all clients
npx -y cloud-alm-mcp-server uninstall --key    # and delete the saved key
```
