/**
 * `setup`: find the downloaded service key, check it, save it, and add the
 * server to every MCP client installed. One command, no questions, so an
 * agent can run it for the user. Never prints the key's contents.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isServiceKey } from "./key.js";
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

/**
 * The newest JSON file in ~/Downloads that is
 * a Cloud ALM API service key, downloaded in the last week.
 */
export function findDownloadedKey(
  dirs: string[],
  now = Date.now(),
): { path: string; others: number } | undefined {
  const found: { path: string; mtime: number }[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
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
  return first && { path: first.path, others: found.length - 1 };
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
  if (existsSync(dirname(claudeDesktopConfig(e)))) found.push("claude-desktop");
  if (existsSync(dirname(cursorConfig(e.home)))) found.push("cursor");
  return found;
}

export type ClientResult = { client: Client; label: string; ok: boolean; detail: string };

/** Add or replace the server in a JSON config with an `mcpServers` map. */
export function mergeJsonConfig(
  path: string,
  entry: unknown,
  write: (path: string, text: string) => void,
): string {
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    const text = readFileSync(path, "utf8");
    if (text.trim()) {
      try {
        config = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(`${path} is not valid JSON; fix it or add the entry by hand.`);
      }
      if (!config || typeof config !== "object" || Array.isArray(config))
        throw new Error(`${path} is not a JSON object.`);
    }
  }
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const replaced = SERVER_KEY in servers;
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
        await e.exec("claude", ["mcp", "remove", SERVER_KEY, "--scope", "user"]);
        const r = await e.exec("claude", [
          "mcp", "add", SERVER_KEY, "--scope", "user", "-e", env, "--", "npx", "-y", spec,
        ]);
        return r.code === 0
          ? { client, label, ok: true, detail: "added for all projects (claude mcp add --scope user)" }
          : fail(`claude mcp add failed: ${firstLine(r.stderr || r.stdout)}`);
      }
      case "codex": {
        await e.exec("codex", ["mcp", "remove", SERVER_KEY]);
        const r = await e.exec("codex", ["mcp", "add", SERVER_KEY, "--env", env, "--", "npx", "-y", spec]);
        return r.code === 0
          ? { client, label, ok: true, detail: "added (~/.codex/config.toml)" }
          : fail(`codex mcp add failed: ${firstLine(r.stderr || r.stdout)}`);
      }
      case "claude-desktop": {
        const path = claudeDesktopConfig(e);
        const how = mergeJsonConfig(path, desktopEntry(e, keyPath, spec), write);
        return { client, label, ok: true, detail: `${how} in ${path}; quit and reopen Claude Desktop` };
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

