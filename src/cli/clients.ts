/**
 * Ready-to-paste MCP client configuration. Each snippet names the key
 * file's path, never its contents.
 */

export const PACKAGE_NAME = "cloud-alm-mcp-server";
export const SERVER_KEY = "cloud-alm";

/** Quote for a POSIX shell when needed. */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./~-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

export type Snippet = { client: string; where: string; text: string };

export function clientSnippets(
  keyPath: string,
  platform: NodeJS.Platform = process.platform,
): Snippet[] {
  const env = `CALM_SERVICE_KEY=${keyPath}`;
  const json = JSON.stringify(
    {
      mcpServers: {
        [SERVER_KEY]: {
          command: "npx",
          args: ["-y", PACKAGE_NAME],
          env: { CALM_SERVICE_KEY: keyPath },
        },
      },
    },
    null,
    2,
  );
  const desktopConfig =
    platform === "darwin"
      ? "~/Library/Application Support/Claude/claude_desktop_config.json"
      : platform === "win32"
        ? "%APPDATA%\\Claude\\claude_desktop_config.json"
        : "Settings → Developer → Edit Config";
  return [
    {
      client: "Claude Code",
      where: "run once",
      text: `claude mcp add ${SERVER_KEY} --scope user -e ${shellQuote(env)} -- npx -y ${PACKAGE_NAME}`,
    },
    {
      client: "Codex",
      where: "run once",
      text: `codex mcp add ${SERVER_KEY} --env ${shellQuote(env)} -- npx -y ${PACKAGE_NAME}`,
    },
    {
      client: "Codex (by hand)",
      where: "~/.codex/config.toml",
      // A JSON string is a valid TOML basic string.
      text: [
        `[mcp_servers.${SERVER_KEY}]`,
        `command = "npx"`,
        `args = ["-y", "${PACKAGE_NAME}"]`,
        `env = { CALM_SERVICE_KEY = ${JSON.stringify(keyPath)} }`,
      ].join("\n"),
    },
    { client: "Claude Desktop", where: desktopConfig, text: json },
    { client: "Cursor", where: "~/.cursor/mcp.json", text: json },
  ];
}
