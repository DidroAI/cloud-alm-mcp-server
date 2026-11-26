/**
 * `setup`: find the downloaded service key, check it, save it, and add the
 * server to every MCP client installed. One command, no questions, so an
 * agent can run it for the user. Never prints the key's contents.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
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

/** The skills shipped with this package: `skills/<name>/SKILL.md`. */
export const SKILLS_SOURCE = fileURLToPath(new URL("../../skills/", import.meta.url));

/** The names of the skills in a folder: its subfolders that hold a SKILL.md. */
export function skillNames(source: string = SKILLS_SOURCE): string[] {
  try {
    return readdirSync(source).filter((name) => existsSync(join(source, name, "SKILL.md"))).sort();
  } catch {
    return [];
  }
}

/**
 * Where each client reads a user's skills. Cursor also reads Claude Code's
 * and the shared `~/.agents/skills` folder, so it gets a folder of its own
 * only when neither is written. Claude Desktop reads none from disk: there
 * the workflows are the server's prompts.
 */
export function skillsDirs(clients: Client[], e: Pick<SetupEnv, "home" | "env">): { dir: string; clients: Client[] }[] {
  const dirs: { dir: string; clients: Client[] }[] = [];
  if (clients.includes("claude-code"))
    dirs.push({ dir: join(e.env.CLAUDE_CONFIG_DIR || join(e.home, ".claude"), "skills"), clients: ["claude-code"] });
  if (clients.includes("codex")) dirs.push({ dir: join(e.home, ".agents", "skills"), clients: ["codex"] });
  if (clients.includes("cursor")) {
    const shared = dirs[0];
    if (shared) shared.clients.push("cursor");
    else dirs.push({ dir: join(e.home, ".cursor", "skills"), clients: ["cursor"] });
  }
  return dirs;
}

/** Left in each skill folder setup writes, so only those are replaced or removed later. */
export const SKILL_MARKER = ".cloud-alm-mcp-server";

// The complete skill directories in 0.3.1–0.3.8 each contained only SKILL.md.
// 0.3.1 and 0.3.2 shipped without markers. The original marker had no digest.
const historicalSkills: Record<string, string[]> = {
  "cloud-alm-backlog-from-notes": ["fcf45d257e4430b84faf6fa231366d01206044c780da879b1d92a68be6f83c94", "d052d847005f8b1cce1734a0f4b2c0d184b733c139fa2771cf191d79b5b3d54a", "cb0206934580120b7d7c2f91f1aa6214bdc42167613786366bee0cf65df4588c"],
  "cloud-alm-daily-brief": ["076f9bc28437b11d7510d1ccf4733c978f5bd29c48cd572752a60580613bea3e", "2ae76c0d6cd8fa87c50647da827625d5ee3ec8f8eec9d7d5203eaa088e3d7777", "f71d44ddcb1447dd182f7a8b3ee36878d632f0217aa3f70349a8f2c1b81d37cf"],
  "cloud-alm-defect-triage": ["0c88054b43e9e50d4120aef3f9e3a44ec84d65f767cda195fd67a2f6a7ed3adc", "c1ad593fef6aa46f2d711188b84a76c3bdc501e342414b90c7308d904e4c3d99", "41d7bc9e8a4034156fa302cee42cc07d95d71368e73415012b3728eabafba522"],
  "cloud-alm-explore": ["14ae1d369e74fbb3ce83ad62623ec0d20a9fd789d5a3fef925b4b0c9a48b65c7", "a5646f3f14064be2ba8ed461bed5a022b58021b004a55f8e842e89359a8fc7f5", "5bcea310482b52dc853defab27ab5a02dcbf42fa1acac0bc1f34a3195b847664"],
  "cloud-alm-fit-gap": ["c096b75176650b8f831b4b8a43f0276fa6fee369c3eb200eaf8069e5e4b97429", "045588dad6099ac9e7b8c78fcd24a5f205ec6c5625c6ba96404e885b4e57af31", "a5dbc604ced0bfaca3fe1dfa39efc9d011c72f6c4f2de553488f1d3157335721"],
  "cloud-alm-status-report": ["c9a524b65379aad4fffd97475f55dbb28ea41e3bfdb88ba4c7890296a7ab6f48", "69c34430e88b42c0d4ac581de28de93dd3f2239c787375c3a8931f9b9b6dea7d", "1272a976943cdb5493cafd573415fca46b9035ec14262a065dea2891f4111a33"],
  "cloud-alm-test-design": ["eb1978beb8cf766eecd14ef3d2d6857701265854e4ca2ddfc8853fff236ce03e", "ab25fedb34453b8cd9ee371d8fc166d8eb732edda24d3839a25708a76f66f626", "cadfb02fe4c9da93d6f8271669887bb647f478cbc3e0e391c543f4a7f01416b9"],
  "cloud-alm-test-readiness": ["6bf13dd31a9d0b3f8a613de0a490cc270c7e82abdb4e4c0e80fb118ba1fb9df2", "d9aae249aa30659d151b7636ebf47f626397d7f950a451a4a0a2848c3128ae05", "be7d128a277acee037e1502f46fe927db7fc5c07f77d99d62cd95d94d4558f3d"],
  "cloud-alm-workshop-prep": ["03b4969260ebb061c76d08fd5acf1d092d285e3d16e6c2cbea57f7b0d96c63f9", "7d5abcc3f843bd5bde5ff3880df159704d73c8e076407ef67f0cade53686cefb", "ec9b554f3126b34f57029ae43ad7867a635fe3069adacaf5ede53ed37bb81425"],
};

const skillDigest = (dir: string) => createHash("sha256").update(readFileSync(join(dir, "SKILL.md"))).digest("hex");
const oldMarker = "Installed by cloud-alm-mcp-server setup; replaced on the next setup and removed by uninstall.\n";

/** Only an intact package copy can be replaced. Extra files and symlinks belong to the user. */
export function ownSkill(target: string, source: string = SKILLS_SOURCE): boolean {
  try {
    if (!lstatSync(target).isDirectory()) return false;
    const files = readdirSync(target, { withFileTypes: true });
    if (!files.every(file => file.isFile() && (file.name === "SKILL.md" || file.name === SKILL_MARKER))) return false;
    const digest = skillDigest(target);
    if (files.some(file => file.name === SKILL_MARKER)) {
      const marker = readFileSync(join(target, SKILL_MARKER), "utf8");
      if (marker !== oldMarker) return marker === `cloud-alm-mcp-server sha256 ${digest}\n`;
    }
    const name = basename(target);
    if (historicalSkills[name]?.includes(digest)) return true;
    const bundled = join(source, name);
    const entries = readdirSync(bundled, { withFileTypes: true });
    return entries.length === 1 && entries[0]?.name === "SKILL.md" && entries[0].isFile() && skillDigest(bundled) === digest;
  } catch {
    return false;
  }
}

/** Copy the skills into a client's folder, replacing copies from an earlier version; a folder of the same name that is not ours stays. */
export function installSkills(dir: string, source: string = SKILLS_SOURCE): number {
  let installed = 0;
  for (const name of skillNames(source)) {
    const target = join(dir, name);
    if (lstatSync(target, { throwIfNoEntry: false }) && !ownSkill(target, source)) continue;
    mkdirSync(dir, { recursive: true });
    cpSync(join(source, name), target, { recursive: true });
    writeFileSync(join(target, SKILL_MARKER), `cloud-alm-mcp-server sha256 ${skillDigest(target)}\n`);
    installed++;
  }
  return installed;
}

/** Take this package's skills out of a folder; other skills there are left alone. */
export function removeSkills(dir: string, source: string = SKILLS_SOURCE): number {
  let removed = 0;
  for (const name of skillNames(source)) {
    const target = join(dir, name);
    if (!existsSync(target) || !ownSkill(target, source)) continue;
    rmSync(join(target, "SKILL.md"), { force: true });
    rmSync(join(target, SKILL_MARKER), { force: true });
    // A concurrently added user file must survive removal.
    try {
      rmdirSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
    }
    removed++;
  }
  return removed;
}
