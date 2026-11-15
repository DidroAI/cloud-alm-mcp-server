import { readFileSync } from "node:fs";

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

/** This package's version. Same relative place from src/cli/ and dist/cli/. */
export function version(): string {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}

/**
 * What npx runs: the bare name, or name@beta for a prerelease. The beta
 * dist-tag follows the newest prerelease, so a client config written today
 * gets later betas; a bare name is not a beta once a release is out.
 */
export function packageSpec(version?: string): string {
  return version?.includes("-") ? `${PACKAGE_NAME}@beta` : PACKAGE_NAME;
}

/**
 * How to run this CLI again, as the user must type it: the bare command
 * from a global install, else through npx (`npx -y cloud-alm-mcp-server@beta`).
 */
export function cliCommand(
  spec: string,
  env: Record<string, string | undefined> = process.env,
  scriptPath: string = process.argv[1] ?? "",
): string {
  const path = scriptPath.replace(/\\/g, "/");
  const viaNpx = path.includes("/_npx/") || env.npm_command === "exec";
  const installed = path.includes(`/node_modules/${PACKAGE_NAME}/`);
  return installed && !viaNpx ? PACKAGE_NAME : `npx -y ${spec}`;
}

export function clientSnippets(
  keyPath: string,
  platform: NodeJS.Platform = process.platform,
  spec: string = PACKAGE_NAME,
): Snippet[] {
  const env = `CALM_SERVICE_KEY=${keyPath}`;
  const json = JSON.stringify(
    {
      mcpServers: {
        [SERVER_KEY]: {
          command: "npx",
          args: ["-y", spec],
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
      text: `claude mcp add ${SERVER_KEY} --scope user -e ${shellQuote(env)} -- npx -y ${spec}`,
    },
    {
      client: "Codex",
      where: "run once",
      text: `codex mcp add ${SERVER_KEY} --env ${shellQuote(env)} -- npx -y ${spec}`,
    },
    {
      client: "Codex (by hand)",
      where: "~/.codex/config.toml",
      // A JSON string is a valid TOML basic string.
      text: [
        `[mcp_servers.${SERVER_KEY}]`,
        `command = "npx"`,
        `args = ["-y", "${spec}"]`,
        `env = { CALM_SERVICE_KEY = ${JSON.stringify(keyPath)} }`,
      ].join("\n"),
    },
    { client: "Claude Desktop", where: desktopConfig, text: json },
    { client: "Cursor", where: "~/.cursor/mcp.json", text: json },
  ];
}
