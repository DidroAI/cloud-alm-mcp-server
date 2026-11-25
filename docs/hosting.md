# Running the server

Local (stdio) with your own key, or as a shared HTTP endpoint where each request brings its own token. Back to the [README](../README.md).

Try the cards with synthetic data: Didro's demo at `https://docs.didro.ai/cloud-alm/demo/mcp`, or [run the demo yourself](hosted-preview.md).

### stdio, with your own key (default)

The server finds the key in `CALM_SERVICE_KEY`, either a file path or the
JSON itself, else in the file `setup` or `init` saved
(`$XDG_CONFIG_HOME/cloud-alm-mcp-server/service-key.json`, by default under
`~/.config`; `%APPDATA%\cloud-alm-mcp-server\` on Windows;
`CALM_CONFIG_DIR` overrides the directory). It gets tokens by client
credentials and keeps them in memory only.

```sh
npx -y cloud-alm-mcp-server                                    # the saved key
CALM_SERVICE_KEY=~/keys/calm-read.json npx -y cloud-alm-mcp-server
CALM_SERVICE_KEY="$SECRET_FROM_YOUR_VAULT" npx -y cloud-alm-mcp-server   # the JSON itself
```

### Streamable HTTP, a bearer token per request

For hosting behind your own gateway: the server holds **no secret**. Each
request carries `Authorization: Bearer <token>`, a Cloud ALM token the
caller obtained. The API address comes from the `X-Calm-Api-Url` header,
or `CALM_API_URL` when the header is absent; it must be an
`https://…alm.cloud.sap` address, so a token is never sent anywhere else.

```sh
PORT=3333 CALM_API_URL=https://eu20.alm.cloud.sap/api npx -y cloud-alm-mcp-server http
# MCP endpoint: http://127.0.0.1:3333/mcp  (HOST to bind elsewhere)
```

Stateless: one server per POST, JSON answers, no session. Requests without
a bearer get 401; other methods 405; bodies over 256 KB 413. Put it behind
TLS and your own authentication of callers: the bearer authorizes Cloud ALM,
not the caller.

On the loopback address (the default) the server answers only to the host
names `127.0.0.1`, `localhost` or `[::1]` with its port, and refuses
requests that carry another site's `Origin`, so a web page in a browser on
the same machine cannot reach it. A request under another name gets 403.
Have your gateway send one of those names as `Host` (many proxies pass on
the public name instead), or bind with `HOST=0.0.0.0`, which turns the
check off: the gateway is then the only guard.

Over HTTP the server sends no reports about tool problems unless you set
`CALM_FEEDBACK_URL` to a receiver of your own. Every variable of both
modes: [install.md#environment-variables](install.md#environment-variables).
