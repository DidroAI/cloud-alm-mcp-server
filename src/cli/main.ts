import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { ServiceKey } from "../calm/index.js";
import { type ServerOptions, serverOptionsFromEnv } from "../server.js";
import { type Check, keyChecks, nodeCheck, settingsCheck } from "./checks.js";
import { clientSnippets, PACKAGE_NAME } from "./clients.js";
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
};

export function version(): string {
  // Same relative place from src/cli/ and dist/cli/.
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}

export const HELP = `${PACKAGE_NAME}: an MCP server for SAP Cloud ALM (read-only)

Usage:
  ${PACKAGE_NAME} [stdio]          Start the MCP server on stdio (default)
  ${PACKAGE_NAME} http             Start the streamable HTTP server (bearer per request)
  ${PACKAGE_NAME} init [file|-]    Check a service key, save it, print client config
      --force                      Replace a key saved before
      --skip-check                 Save without contacting SAP
  ${PACKAGE_NAME} doctor           Check the setup: key, token, scopes, API, Node
  ${PACKAGE_NAME} --version | --help

init reads the service key JSON from the file given, or from stdin
("-", or nothing: paste it, then Ctrl-D). The key is saved, readable only
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

/** Write a file only the user can read, atomically. */
export function writeSecretFile(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

type Flags = { positional: string[]; force: boolean; skipCheck: boolean };

function parseFlags(args: string[]): Flags {
  const flags: Flags = { positional: [], force: false, skipCheck: false };
  for (const arg of args) {
    if (arg === "--force") flags.force = true;
    else if (arg === "--skip-check") flags.skipCheck = true;
    else if (arg.startsWith("--") && arg !== "-")
      throw new UsageError(`Unknown option ${arg}.`);
    else flags.positional.push(arg);
  }
  if (flags.positional.length > 1)
    throw new UsageError("init takes one service key file at most.");
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

async function init(io: Io, args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const input = await readKeyInput(io, flags.positional[0]);
  const key = parseServiceKeyText(input.text, input.origin);
  const target = savedKeyPath(io.env);
  const text = `${input.text.trim()}\n`;
  const unchanged = existsSync(target) && readFileSync(target, "utf8") === text;
  if (existsSync(target) && !unchanged && !flags.force) {
    io.err(
      `A different key is already saved at ${target}. Pass --force to replace it.`,
    );
    return 1;
  }

  if (!flags.skipCheck) {
    let settings: ServerOptions = {};
    try {
      settings = serverOptionsFromEnv(io.env);
    } catch {}
    const checks = await keyChecks(key, { ...fetchOption(io), settings });
    printChecks(io, checks);
    if (checks.some((c) => c.name === "Token" && c.status === "fail")) {
      io.err("\nNot saved: the key did not give a token.");
      return 1;
    }
  }

  if (!unchanged) writeSecretFile(target, text);
  io.out(`\nKey ${unchanged ? "already saved" : "saved"} at ${target} (mode 600).`);
  if (input.file && resolve(input.file) !== resolve(target))
    io.out(`You can now delete ${input.file}.`);
  printSnippets(io, target);
  return 0;
}

function printSnippets(io: Io, keyPath: string) {
  io.out("\nAdd the server to your MCP client:");
  for (const s of clientSnippets(keyPath, io.platform ?? process.platform)) {
    io.out(`\n# ${s.client}: ${s.where}`);
    io.out(s.text);
  }
  io.out(`\nThen check the setup any time with: ${PACKAGE_NAME} doctor`);
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
      detail: `none found: run \`${PACKAGE_NAME} init\` or set ${SERVICE_KEY_ENV}`,
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
  let settings: ServerOptions;
  try {
    settings = serverOptionsFromEnv(io.env);
  } catch (error) {
    checks.push({ name: "Mode", status: "fail", detail: (error as Error).message });
    printChecks(io, checks);
    return 1;
  }
  checks.push(settingsCheck(settings));
  checks.push(...(await keyChecks(key, { ...fetchOption(io), settings })));
  printChecks(io, checks);
  io.out(failed(checks) ? "\nSetup has problems." : "\nReady.");
  return failed(checks) ? 1 : 0;
}

export const COMMANDS = ["init", "doctor", "help", "--help", "-h", "--version", "-v", "version"];

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
      case "init":
        return await init(io, rest);
      case "doctor":
        if (rest.length) throw new UsageError("doctor takes no arguments.");
        return await doctor(io);
      default:
        throw new UsageError(`Unknown command ${command}.`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message} See ${PACKAGE_NAME} --help.`);
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
