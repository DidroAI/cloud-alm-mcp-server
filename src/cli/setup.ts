/**
 * `setup`: find the downloaded service key, check it, save it, and add the
 * server to every MCP client installed. One command, no questions, so an
 * agent can run it for the user. Never prints the key's contents.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isServiceKey, stripBom } from "./key.js";
import { SERVER_KEY } from "./clients.js";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type Exec = (command: string, args: string[]) => Promise<ExecResult>;

/** Quote one argument for cmd.exe (Windows runs the .cmd shims through it). */
export const cmdQuote = (arg: string) => (/^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`);

/** Run a program without a shell (Windows needs one for .cmd shims). */
export const defaultExec: Exec = (command, args) =>
  new Promise((done) => {
    const win = process.platform === "win32";
    const child = spawn(command, win ? args.map(cmdQuote) : args, {
      shell: win,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", () => done({ code: 127, stdout, stderr }));
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });

/** Largest file looked at as a candidate key: keys are about 1 KB. */
const MAX_KEY_BYTES = 64 * 1024;
/** Downloads older than this are not picked up on their own. */
const RECENT_MS = 7 * 24 * 3600_000;

export type DownloadedKey = {
  /** The newest key found, and how many other keys lie next to it. */
  key?: { path: string; others: number };
  /** Folders that exist but may not be read (macOS privacy, permissions). */
  unreadable: string[];
};

/**
 * The newest JSON file in ~/Downloads that is
 * a Cloud ALM API service key, downloaded in the last week.
 */
export function findDownloadedKey(dirs: string[], now = Date.now()): DownloadedKey {
  const found: { path: string; mtime: number }[] = [];
  const unreadable: string[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      // A missing folder is nothing to report; a refused one is.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") unreadable.push(dir);
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      const path = join(dir, name);
      try {
        const s = statSync(path);
        if (!s.isFile() || s.size > MAX_KEY_BYTES || now - s.mtimeMs > RECENT_MS) continue;
        if (isServiceKey(readFileSync(path, "utf8"))) found.push({ path, mtime: s.mtimeMs });
      } catch {}
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  const [first] = found;
  return { ...(first ? { key: { path: first.path, others: found.length - 1 } } : {}), unreadable };
}

export type Client = "claude-code" | "codex" | "claude-desktop" | "cursor";
export const CLIENTS: Client[] = ["claude-code", "codex", "claude-desktop", "cursor"];
export const LABEL: Record<Client, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
};

export type SetupEnv = {
  platform: NodeJS.Platform;
  home: string;
  env: Record<string, string | undefined>;
  exec: Exec;
  /** The node binary running this command. */
  execPath: string;
};

export function claudeDesktopConfig(e: Pick<SetupEnv, "platform" | "home" | "env">): string {
  if (e.platform === "darwin")
    return join(e.home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (e.platform === "win32")
    return join(e.env.APPDATA ?? join(e.home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(e.env.XDG_CONFIG_HOME || join(e.home, ".config"), "Claude", "claude_desktop_config.json");
}

/**
 * Claude Desktop from the Microsoft Store (MSIX) keeps its files in a
 * per-package folder instead of %APPDATA%:
 * %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude.
 */
export function claudeDesktopMsixConfigs(e: Pick<SetupEnv, "platform" | "home" | "env">): string[] {
  if (e.platform !== "win32") return [];
  const packages = join(e.env.LOCALAPPDATA ?? join(e.home, "AppData", "Local"), "Packages");
  let names: string[];
  try {
    names = readdirSync(packages);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith("Claude_"))
    .map((name) => join(packages, name, "LocalCache", "Roaming", "Claude"))
    .filter((dir) => existsSync(dir))
    .map((dir) => join(dir, "claude_desktop_config.json"));
}

/**
 * Every Claude Desktop config on this machine: the folders that exist
 * (the usual one, the Store app's on Windows), else the usual one.
 */
export function claudeDesktopConfigs(e: Pick<SetupEnv, "platform" | "home" | "env">): string[] {
  const usual = claudeDesktopConfig(e);
  const msix = claudeDesktopMsixConfigs(e);
  return existsSync(dirname(usual)) || !msix.length ? [usual, ...msix] : msix;
}

const cursorConfig = (home: string) => join(home, ".cursor", "mcp.json");

/**
 * The server entry for a desktop app. Apps started from the Dock do not get
 * the shell's PATH, so on macOS and Linux the entry names the npx next to
 * this node and puts node's directory on PATH.
 */
export function desktopEntry(e: SetupEnv, keyPath: string, spec: string) {
  const env: Record<string, string> = { CALM_SERVICE_KEY: keyPath };
  if (e.platform === "win32")
    return { command: "npx", args: ["-y", spec], env };
  const nodeDir = dirname(e.execPath);
  const npx = join(nodeDir, "npx");
  if (!existsSync(npx)) return { command: "npx", args: ["-y", spec], env };
  env.PATH = [nodeDir, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"]
    .filter((d, i, all) => all.indexOf(d) === i)
    .join(":");
  return { command: npx, args: ["-y", spec], env };
}

/** Which clients are on this machine. */
export async function detectClients(e: SetupEnv): Promise<Client[]> {
  const has = async (cmd: string) => (await e.exec(cmd, ["--version"])).code === 0;
  const found: Client[] = [];
  if (await has("claude")) found.push("claude-code");
  if (await has("codex")) found.push("codex");
  if (claudeDesktopConfigs(e).some((path) => existsSync(dirname(path)))) found.push("claude-desktop");
  if (existsSync(dirname(cursorConfig(e.home)))) found.push("cursor");
  return found;
}

export type ClientResult = { client: Client; label: string; ok: boolean; detail: string };

/** A client's JSON config as an object; empty when the file is missing or blank. */
function readJsonConfig(path: string, advice: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const text = stripBom(readFileSync(path, "utf8"));
  if (!text.trim()) return {};
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON; fix it or ${advice}.`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error(`${path} is not a JSON object.`);
  return config as Record<string, unknown>;
}

/** Take the server out of a JSON config; false when it was not there. */
export function removeFromJsonConfig(
  path: string,
  write: (path: string, text: string) => void,
): boolean {
  const config = readJsonConfig(path, "remove the entry by hand");
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object" || !(SERVER_KEY in servers)) return false;
  const { [SERVER_KEY]: _removed, ...rest } = servers as Record<string, unknown>;
  config.mcpServers = rest;
  write(path, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

/** Add or replace the server in a JSON config with an `mcpServers` map. */
export function mergeJsonConfig(
  path: string,
  entry: unknown,
  write: (path: string, text: string) => void,
  requireExisting = false,
): string {
  const config = readJsonConfig(path, "add the entry by hand");
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const replaced = SERVER_KEY in servers;
  if (requireExisting && !replaced) throw new Error(`Could not locate the existing user entry in ${path}.`);
  if (replaced && isDeepStrictEqual(servers[SERVER_KEY], entry)) return "already configured";
  config.mcpServers = { ...servers, [SERVER_KEY]: entry };
  write(path, `${JSON.stringify(config, null, 2)}\n`);
  return replaced ? "replaced" : "added";
}

/** Add the server to one client; replaces an entry of the same name. */
export async function configureClient(
  client: Client,
  e: SetupEnv,
  keyPath: string,
  spec: string,
  write: (path: string, text: string) => void,
): Promise<ClientResult> {
  const label = LABEL[client];
  const env = `CALM_SERVICE_KEY=${keyPath}`;
  const fail = (detail: string): ClientResult => ({ client, label, ok: false, detail });
  try {
    switch (client) {
      case "claude-code": {
        const r = await e.exec("claude", [
          "mcp", "add", SERVER_KEY, "--scope", "user", "-e", env, "--", "npx", "-y", spec,
        ]);
        // Claude rejects duplicate names. Update an existing user entry in a
        // single config write so a failed replacement leaves it available.
        if (r.code !== 0 && (r.stderr + r.stdout).includes(`MCP server ${SERVER_KEY} already exists in user config`)) {
          const path = join(e.env.CLAUDE_CONFIG_DIR || e.home, ".claude.json");
          const entry = { type: "stdio", command: "npx", args: ["-y", spec], env: { CALM_SERVICE_KEY: keyPath } };
          const how = mergeJsonConfig(path, entry, write, true);
          return { client, label, ok: true, detail: `${how} in ${path}` };
        }
        return r.code === 0
          ? { client, label, ok: true, detail: "added for all projects (claude mcp add --scope user)" }
          : fail(`claude mcp add failed: ${firstLine(r.stderr || r.stdout)}`);
      }
      case "codex": {
        const r = await e.exec("codex", ["mcp", "add", SERVER_KEY, "--env", env, "--", "npx", "-y", spec]);
        return r.code === 0
          ? { client, label, ok: true, detail: "added (~/.codex/config.toml)" }
          : fail(`codex mcp add failed: ${firstLine(r.stderr || r.stdout)}`);
      }
      case "claude-desktop": {
        const done = claudeDesktopConfigs(e).map(
          (path) => `${mergeJsonConfig(path, desktopEntry(e, keyPath, spec), write)} in ${path}`,
        );
        return { client, label, ok: true, detail: `${done.join(", ")}; quit and reopen Claude Desktop` };
      }
      case "cursor": {
        const path = cursorConfig(e.home);
        const how = mergeJsonConfig(path, desktopEntry(e, keyPath, spec), write);
        return { client, label, ok: true, detail: `${how} in ${path}` };
      }
    }
  } catch (error) {
    return fail((error as Error).message);
  }
}

/** Take the server out of one client. Not being there is not a failure. */
export async function unconfigureClient(
  client: Client,
  e: SetupEnv,
  write: (path: string, text: string) => void,
): Promise<ClientResult> {
  const label = LABEL[client];
  const result = (ok: boolean, detail: string): ClientResult => ({ client, label, ok, detail });
  const fromFiles = (paths: string[]) => {
    const removed = paths.filter((path) => removeFromJsonConfig(path, write));
    return result(
      true,
      removed.length
        ? `removed from ${removed.join(", ")} (the file before is kept as .bak)`
        : "was not set up",
    );
  };
  try {
    switch (client) {
      case "claude-code":
      case "codex": {
        const cli = client === "codex" ? "codex" : "claude";
        const probe = await e.exec(cli, ["--version"]);
        if (probe.code === 127) return result(true, "not installed");
        if (probe.code !== 0) return result(false, `${cli} --version failed: ${firstLine(probe.stderr || probe.stdout)}`);
        const r = await e.exec(cli, ["mcp", "remove", SERVER_KEY, ...(cli === "claude" ? ["--scope", "user"] : [])]);
        if (r.code === 0) return result(true, `removed (${cli} mcp remove)`);
        const message = r.stderr || r.stdout;
        if (message.includes(`No MCP server named "${SERVER_KEY}" in user scope`) ||
            message.includes(`No MCP server named '${SERVER_KEY}' found`)) return result(true, "was not set up");
        return result(false, `${cli} mcp remove failed: ${firstLine(message)}`);
      }
      case "claude-desktop":
        return fromFiles(claudeDesktopConfigs(e));
      case "cursor":
        return fromFiles([cursorConfig(e.home)]);
    }
  } catch (error) {
    return result(false, (error as Error).message);
  }
}

const firstLine = (text: string) => text.trim().split("\n")[0]?.slice(0, 200) || "no output";

export function parseClients(value: string): Client[] {
  if (value === "all") return [...CLIENTS];
  if (value === "none") return [];
  return value.split(",").map((v) => {
    const c = v.trim() as Client;
    if (!CLIENTS.includes(c))
      throw new Error(`Unknown client ${v}: use ${CLIENTS.join(", ")}, all or none.`);
    return c;
  });
}

export const defaultSetupEnv = (env: Record<string, string | undefined>): SetupEnv => ({
  platform: process.platform,
  home: homedir(),
  env,
  exec: defaultExec,
  execPath: process.execPath,
});

