import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  realpathSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ServiceKey } from "../calm/index.js";
import { type Check, keyChecks, MIN_NODE, nodeCheck } from "./checks.js";
import { cliCommand, clientSnippets, PACKAGE_NAME, packageSpec, version } from "./clients.js";
import {
  CONFIG_DIR_ENV,
  expandHome,
  keySecrets,
  keySource,
  loadServiceKey,
  parseServiceKeyText,
  redact,
  SERVICE_KEY_ENV,
  savedKeyPath,
} from "./key.js";
import {
  CLIENTS,
  type Client,
  LABEL,
  configureClient,
  defaultSetupEnv,
  detectClients,
  findDownloadedKey,
  parseClients,
  type SetupEnv,
  unconfigureClient,
} from "./setup.js";

/** Everything the commands touch outside the file system, for tests. */
export type Io = {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  readStdin: () => Promise<string>;
  stdinIsTTY: boolean;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  /** The script running, to tell a global install from npx. */
  scriptPath?: string;
  /** setup: where clients live and how to run their CLIs. */
  setup?: Partial<SetupEnv>;
};

export { version };

/** This CLI as the user must type it: `npx -y cloud-alm-mcp-server@beta`, or the bare name from a global install. */
const cli = (io: Io) => cliCommand(packageSpec(version()), io.env, io.scriptPath);

export const HELP = `${PACKAGE_NAME}: an MCP server for SAP Cloud ALM

Usage:
  ${PACKAGE_NAME} [stdio]          Start the MCP server on stdio (default)
  ${PACKAGE_NAME} http             Start the streamable HTTP server (bearer per request)
  ${PACKAGE_NAME} setup [file|-]   Find, check and save the service key, then add
                                   the server to Claude Code, Codex, Claude
                                   Desktop and Cursor (the ones installed)
      --client <list>              Only these: claude-code,codex,claude-desktop,
                                   cursor, all or none
  ${PACKAGE_NAME} init [file|-]    Check a service key, save it, print client config
      --force                      Replace a key saved before
      --skip-check                 Save without contacting SAP
  ${PACKAGE_NAME} doctor           Check the setup: key, token, scopes, API, Node
  ${PACKAGE_NAME} uninstall        Remove the server from the clients setup knows
                                   (each changed file is kept as .bak)
      --key                        Also delete the saved service key
      --client <list>              Only these clients
  ${PACKAGE_NAME} --version | --help

Not installed globally? Put npx in front, as in:
  npx -y ${packageSpec(version())} setup

setup without a file takes the newest service key JSON downloaded to
~/Downloads in the last week (or in the current directory). init reads the
file given, or stdin ("-", or nothing: paste it, then Ctrl-D). The key is saved, readable only
by you, at:
  ${"$"}${CONFIG_DIR_ENV} or ~/.config/${PACKAGE_NAME}/service-key.json
  (%APPDATA%\\${PACKAGE_NAME}\\service-key.json on Windows)

Environment:
  ${SERVICE_KEY_ENV}   the service key: a file path or the JSON itself
                     (default: the key saved by init)
  PORT, HOST         http mode: where to listen (default 127.0.0.1:3333)
  CALM_API_URL       http mode: API address when no X-Calm-Api-Url header

Secrets and tokens are never printed.
`;

const MARK = { ok: "✓", warn: "!", fail: "✗" } as const;

function printChecks(io: Io, checks: Check[]) {
  for (const c of checks) {
    io.out(`${MARK[c.status]} ${c.name.padEnd(7)} ${c.detail}`);
    for (const line of c.lines ?? []) io.out(line);
  }
}

const failed = (checks: Check[]) => checks.some((c) => c.status === "fail");

/** POSIX permission check: a key readable by group or others is flagged. */
function permissionCheck(path: string, platform: NodeJS.Platform): Check {
  if (platform === "win32")
    return { name: "Key", status: "ok", detail: path };
  const mode = statSync(path).mode & 0o777;
  return mode & 0o077
    ? {
        name: "Key",
        status: "warn",
        detail: `${path} is readable by others (mode ${mode.toString(8)}); run chmod 600 on it`,
      }
    : { name: "Key", status: "ok", detail: path };
}

/** The tenant a key opens, for messages: its token host and API host. */
const tenantOf = (key: ServiceKey) => `${new URL(key.uaa.url).hostname} → ${new URL(key.endpoints.Api).hostname}`;

/** A temp name nobody can guess, next to the target. */
const tempName = (path: string) => `${path}.${randomBytes(6).toString("hex")}.tmp`;

/** Write a file only the user can read, atomically. */
export function writeSecretFile(path: string, text: string) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dir, 0o700);
  const tmp = tempName(path);
  // "wx": fails if anything (a planted symlink) is there already.
  writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

type Flags = { positional: string[]; force: boolean; skipCheck: boolean; key: boolean; clients?: Client[] };

function parseFlags(args: string[], command = "init"): Flags {
  const flags: Flags = { positional: [], force: false, skipCheck: false, key: false };
  const takesClients = command === "setup" || command === "uninstall";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (command === "uninstall" && arg === "--key") flags.key = true;
    else if (command !== "uninstall" && arg === "--force") flags.force = true;
    else if (command !== "uninstall" && arg === "--skip-check") flags.skipCheck = true;
    else if (takesClients && (arg === "--client" || arg.startsWith("--client="))) {
      const value = arg.includes("=") ? arg.slice(9) : args[++i];
      if (!value) throw new UsageError("--client needs a value.");
      try {
        flags.clients = parseClients(value);
      } catch (error) {
        throw new UsageError((error as Error).message);
      }
    }
    else if (arg.startsWith("--") && arg !== "-")
      throw new UsageError(`Unknown option ${arg}.`);
    else flags.positional.push(arg);
  }
  if (command === "uninstall" && flags.positional.length)
    throw new UsageError("uninstall takes no arguments.");
  if (flags.positional.length > 1)
    throw new UsageError(`${command} takes one service key file at most.`);
  return flags;
}

class UsageError extends Error {}

async function readKeyInput(
  io: Io,
  arg: string | undefined,
): Promise<{ text: string; origin: string; file?: string }> {
  if (arg && arg !== "-") {
    const file = resolve(expandHome(arg));
    try {
      return { text: readFileSync(file, "utf8"), origin: `The file ${file}`, file };
    } catch {
      throw new Error(`Cannot read ${file}.`);
    }
  }
  if (!arg && io.stdinIsTTY)
    io.err(
      "Paste the service key JSON, then press Ctrl-D (Ctrl-Z, Enter on Windows):",
    );
  return { text: await io.readStdin(), origin: "The pasted text" };
}

/**
 * Check a key and save it. Undefined when the key did not give a token
 * (nothing saved) or a different key is saved and replacing is not allowed.
 */
async function checkAndSave(
  io: Io,
  input: { text: string; origin: string; file?: string },
  options: { replace: boolean; skipCheck: boolean },
): Promise<string | undefined> {
  const key = parseServiceKeyText(input.text, input.origin);
  const target = savedKeyPath(io.env);
  const text = `${input.text.trim()}\n`;
  const exists = existsSync(target);
  const unchanged = exists && readFileSync(target, "utf8") === text;
  if (exists && !unchanged && !options.replace) {
    io.err(
      `A different key is already saved at ${target}. Pass --force to replace it.`,
    );
    return undefined;
  }

  if (!options.skipCheck) {
    const checks = await keyChecks(key, fetchOption(io));
    printChecks(io, checks);
    if (checks.some((c) => c.name === "Token" && c.status === "fail")) {
      io.err("\nNot saved: the key did not give a token.");
      return undefined;
    }
  }

  if (!unchanged) writeSecretFile(target, text);
  const how = unchanged ? "already saved" : exists ? "saved, replacing the one before," : "saved";
  // Windows has no file modes; the key lies in the user's own profile there.
  const mode = (io.platform ?? process.platform) === "win32" ? "" : " (mode 600)";
  io.out(`\nKey ${how} at ${target}${mode}.`);
  return target;
}

async function init(io: Io, args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const input = await readKeyInput(io, flags.positional[0]);
  const target = await checkAndSave(io, input, { replace: flags.force, skipCheck: flags.skipCheck });
  if (!target) return 1;
  if (input.file && resolve(input.file) !== resolve(target))
    io.out(`You can now delete ${input.file}.`);
  printSnippets(io, target);
  return 0;
}


async function setup(io: Io, args: string[]): Promise<number> {
  const flags = parseFlags(args, "setup");
  const node = nodeCheck(io.nodeVersion);
  if (node.status === "fail") {
    io.err(
      `Node ${node.detail}. Install the current LTS from https://nodejs.org ` +
        `(Node ${MIN_NODE} or later), open a new terminal and run this command again.`,
    );
    return 1;
  }
  const e: SetupEnv = { ...defaultSetupEnv(io.env), platform: io.platform ?? process.platform, ...io.setup };

  let input: { text: string; origin: string; file?: string };
  const arg = flags.positional[0];
  if (arg) input = await readKeyInput(io, arg);
  else {
    // Downloads only: a key planted in a cloned repository is never picked up.
    const { key: found, unreadable } = findDownloadedKey([join(e.home, "Downloads")]);
    if (found) {
      io.out(`Service key: ${found.path}${found.others ? ` (the newest of ${found.others + 1})` : ""}`);
      input = { text: readFileSync(found.path, "utf8"), origin: `The file ${found.path}`, file: found.path };
    } else {
      const byFile = `${cli(io)} setup <file>`;
      for (const dir of unreadable)
        io.err(
          `Could not look in ${dir}: permission denied.` +
            (e.platform === "darwin"
              ? " Allow your terminal app under System Settings → Privacy & Security → Files and Folders → Downloads, or name the file."
              : " Name the file instead."),
        );
      if (!io.stdinIsTTY) {
        io.err(
          (unreadable.length ? "No service key found. " : "No service key found in ~/Downloads from the last week. ") +
            `Download the key's JSON from SAP BTP, or run: ${byFile}`,
        );
        return 1;
      }
      if (!unreadable.length)
        io.err("No service key found in ~/Downloads from the last week.");
      io.err(`Name the file (${byFile}), or paste the key here.`);
      input = await readKeyInput(io, undefined);
    }
  }

  // Say which tenant the key opens; a key found on its own may replace a
  // saved key of the same tenant (a rotation), not one of another tenant.
  const key = parseServiceKeyText(input.text, input.origin);
  const tenant = tenantOf(key);
  io.out(`Tenant: ${tenant}`);
  if (!/\.(hana\.ondemand\.com|cloud\.sap)$/.test(new URL(key.uaa.url).hostname))
    io.err(`! The key's token address ${new URL(key.uaa.url).hostname} is not an SAP host. Use only keys you downloaded from SAP BTP.`);
  const saved = savedKeyPath(io.env);
  if (!arg && !flags.force && existsSync(saved)) {
    let before: string | undefined;
    try {
      before = tenantOf(parseServiceKeyText(readFileSync(saved, "utf8"), saved));
    } catch {}
    if (before && before !== tenant) {
      io.err(`A key for another tenant (${before}) is saved. Name the file to switch tenants (setup <file>) or pass --force.`);
      return 1;
    }
  }
  const target = await checkAndSave(io, input, { replace: true, skipCheck: flags.skipCheck });
  if (!target) return 1;

  const spec = packageSpec(version());
  const clients = flags.clients ?? (await detectClients(e));
  if (!clients.length) {
    io.out("\nNo MCP client found to set up.");
    printSnippets(io, target);
    return 0;
  }
  io.out("\nMCP clients:");
  const snippets = clientSnippets(target, e.platform, spec);
  let failures = 0;
  for (const client of clients) {
    const r = await configureClient(client, e, target, spec, writeConfigFile);
    io.out(`${r.ok ? MARK.ok : MARK.fail} ${r.label.padEnd(14)} ${r.detail}`);
    if (!r.ok) {
      failures++;
      const s = snippets.find((x) => x.client === LABEL[client]);
      if (s) io.out(`  Add it by hand (${s.where}):\n${s.text.replace(/^/gm, "    ")}`);
    }
  }
  const missing = CLIENTS.filter((c) => !clients.includes(c)).map((c) => LABEL[c]);
  if (missing.length && !flags.clients)
    io.out(`  Not found: ${missing.join(", ")}. Run \`${cli(io)} init\` to print their configuration.`);

  if (input.file && resolve(input.file) !== resolve(target))
    io.out(`\nYou can now delete ${input.file}.`);
  io.out('Open a new chat and ask: "Where does my Cloud ALM project stand?"');
  io.out(`Check the setup any time with: ${cli(io)} doctor`);
  return failures ? 1 : 0;
}

/**
 * Take the server out of every client setup knows. Asks nothing; each
 * changed config file is kept as .bak. The saved key stays unless --key.
 */
async function uninstall(io: Io, args: string[]): Promise<number> {
  const flags = parseFlags(args, "uninstall");
  const e: SetupEnv = { ...defaultSetupEnv(io.env), platform: io.platform ?? process.platform, ...io.setup };
  io.out("MCP clients:");
  let failures = 0;
  for (const client of flags.clients ?? CLIENTS) {
    const r = await unconfigureClient(client, e, writeConfigFile);
    io.out(`${r.ok ? MARK.ok : MARK.fail} ${r.label.padEnd(14)} ${r.detail}`);
    if (!r.ok) failures++;
  }
  const saved = savedKeyPath(io.env);
  if (flags.key) {
    const had = existsSync(saved);
    rmSync(saved, { force: true });
    io.out(had ? `\nSaved key deleted: ${saved}` : `\nNo saved key at ${saved}.`);
  } else if (existsSync(saved))
    io.out(`\nThe saved key is kept at ${saved}. Delete it too with: ${cli(io)} uninstall --key`);
  io.out("The key stays valid at SAP until you delete it in SAP BTP.");
  return failures ? 1 : 0;
}

/** Write a client's config file, keeping its directory. */
function writeConfigFile(path: string, text: string) {
  // Write through a symlinked dotfile, keep the file's mode, keep a backup.
  const real = existsSync(path) ? realpathSync(path) : path;
  mkdirSync(dirname(real), { recursive: true });
  const mode = existsSync(real) ? statSync(real).mode & 0o777 : 0o600;
  if (existsSync(real)) copyFileSync(real, `${real}.bak`);
  const tmp = tempName(real);
  writeFileSync(tmp, text, { mode, flag: "wx" });
  chmodSync(tmp, mode);
  renameSync(tmp, real);
}

function printSnippets(io: Io, keyPath: string) {
  io.out("\nAdd the server to your MCP client:");
  for (const s of clientSnippets(keyPath, io.platform ?? process.platform, packageSpec(version()))) {
    io.out(`\n# ${s.client}: ${s.where}`);
    io.out(s.text);
  }
  io.out(`\nThen check the setup any time with: ${cli(io)} doctor`);
}

const fetchOption = (io: Io) => (io.fetch ? { fetch: io.fetch } : {});

async function doctor(io: Io): Promise<number> {
  const platform = io.platform ?? process.platform;
  const checks: Check[] = [nodeCheck(io.nodeVersion)];
  const source = keySource(io.env, existsSync);
  if (!source) {
    checks.push({
      name: "Key",
      status: "fail",
      detail: `none found: run \`${cli(io)} setup\` or set ${SERVICE_KEY_ENV}`,
    });
    printChecks(io, checks);
    return 1;
  }
  let key: ServiceKey;
  try {
    key = loadServiceKey(source, io.env);
  } catch (error) {
    checks.push({ name: "Key", status: "fail", detail: (error as Error).message });
    printChecks(io, checks);
    return 1;
  }
  checks.push(
    source.kind === "file"
      ? permissionCheck(source.path, platform)
      : { name: "Key", status: "ok", detail: source.label },
  );
  checks.push(...(await keyChecks(key, fetchOption(io))));
  printChecks(io, checks);
  io.out(failed(checks) ? "\nSetup has problems." : "\nReady.");
  return failed(checks) ? 1 : 0;
}

export const COMMANDS = ["setup", "init", "doctor", "uninstall", "help", "--help", "-h", "--version", "-v", "version"];

/** Run a setup command; returns the exit code. Never prints a secret. */
export async function runCommand(io: Io, argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  let known: ServiceKey | undefined;
  try {
    switch (command) {
      case "--version":
      case "-v":
      case "version":
        io.out(version());
        return 0;
      case "help":
      case "--help":
      case "-h":
        io.out(HELP);
        return 0;
      case "setup":
        return await setup(io, rest);
      case "init":
        return await init(io, rest);
      case "doctor":
        if (rest.length) throw new UsageError("doctor takes no arguments.");
        return await doctor(io);
      case "uninstall":
        return await uninstall(io, rest);
      default:
        throw new UsageError(`Unknown command ${command}.`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message} See ${cli(io)} --help.`);
      return 2;
    }
    try {
      const source = keySource(io.env, existsSync);
      if (source) known = loadServiceKey(source, io.env);
    } catch {}
    const message = error instanceof Error ? error.message : "Failed.";
    io.err(redact(message, keySecrets(known)));
    return 1;
  }
}
