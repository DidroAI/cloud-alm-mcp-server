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
import { basename, dirname, join, resolve } from "node:path";
import type { ServiceKey } from "../calm/index.js";
import { type Check, keyChecks, MIN_NODE, nodeCheck } from "./checks.js";
import { cliCommand, clientSnippets, PACKAGE_NAME, packageSpec, version } from "./clients.js";
import { FEEDBACK_ENV, localFeedback, setLocalFeedback } from "../feedback.js";
import {
  CONFIG_DIR_ENV,
  configDir,
  expandHome,
  keySecrets,
  keySource,
  loadServiceKey,
  parseServiceKeyText,
  redact,
  SERVICE_KEY_ENV,
  savedKeyPath,
} from "./key.js";
import { type Choice, type Prompts, runByAgent } from "./prompts.js";
import {
  CLIENTS,
  type Client,
  LABEL,
  configureClient,
  defaultSetupEnv,
  detectClients,
  findDownloadedKey,
  installSkills,
  parseClients,
  removeSkills,
  skillNames,
  skillsDirs,
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
  /** setup: the questions to ask, when a person is at the terminal. */
  prompts?: () => Promise<Prompts>;
};

export { version };

/** This CLI as the user must type it: `npx -y cloud-alm-mcp-server` (`@beta` for a prerelease), or the bare name from a global install. */
const cli = (io: Io) => cliCommand(packageSpec(version()), io.env, io.scriptPath);

export const HELP = `${PACKAGE_NAME}: an MCP server for SAP Cloud ALM

Usage:
  ${PACKAGE_NAME} [stdio]          Start the MCP server on stdio (default)
  ${PACKAGE_NAME} http             Start the streamable HTTP server (bearer per request)
  ${PACKAGE_NAME} setup [file|-]   Check and save the service key, then add the
                                   server to Claude Code, Codex, Claude Desktop
                                   and Cursor (the ones installed). In a
                                   terminal it asks which key and which apps
      --client <list>              Only these: claude-code,codex,claude-desktop,
                                   cursor, all or none
      --no-input                   Ask nothing (agents and scripts)
      --no-skills                  Do not install the skills (fit-gap, status
                                   report…) for Claude Code, Codex and Cursor
      --force                      Replace a saved key of another tenant
                                   without asking
      --skip-check                 Save without contacting SAP
  ${PACKAGE_NAME} init [file|-]    Check a service key, save it, print client config
      --force                      Replace a key saved before
      --skip-check                 Save without contacting SAP
  ${PACKAGE_NAME} doctor           Check the setup: Node, key, token, scopes, API;
                                   say whether reports are on
  ${PACKAGE_NAME} feedback [on|off]  Short reports from your assistant to Didro about
                                   tool problems (the server attaches no records):
                                   say whether they are on, or switch them
  ${PACKAGE_NAME} uninstall        Remove the server and its skills from the clients
                                   setup knows (each changed file is kept as .bak)
      --key                        Also delete the saved service key
      --client <list>              Only these clients
  ${PACKAGE_NAME} --version | --help

Not installed globally? Put npx in front, as in:
  npx -y ${packageSpec(version())} setup

setup asks for the key: a file, pasted text, a key downloaded to ~/Downloads
in the last week, or the one saved before; with a file named it starts from
that file. Run by an agent or a script, or with --no-input, it asks nothing:
it takes the file named ("-": stdin), else the newest key in ~/Downloads from
the last week, else the one saved before. init reads the file given, or stdin
("-", or nothing: paste it, then Ctrl-D). The key is saved, readable only by
you, at:
  ${"$"}${CONFIG_DIR_ENV}/service-key.json, else ~/.config/${PACKAGE_NAME}/service-key.json
  (%APPDATA%\\${PACKAGE_NAME}\\service-key.json on Windows)

Environment:
  ${SERVICE_KEY_ENV}   the service key: a file path or the JSON itself
                     (default: the key saved by setup or init)
  CALM_WEB_URL       the Cloud ALM UI address for links to items,
                     https://<tenant>.<region>.alm.cloud.sap
                     (default in stdio mode: derived from the key)
  CALM_CONTENT_PRESENTATION=explicit
                     read tools open no card; the assistant shows its
                     final selection with calm_show
  CALM_APPROVAL=card stdio mode: changes are approved in the card only,
                     never by a yes in the chat. "chat" or unset: the card
                     where the app shows one with working buttons, else the chat
  ${FEEDBACK_ENV}=off  no reports about tool problems from this client
  CALM_FEEDBACK_URL  send the reports to this https receiver instead of
                     Didro (http mode: reports exist only when it is set)
  CALM_FEEDBACK_TOKEN  bearer token for the receiver in CALM_FEEDBACK_URL
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

type Flags = { positional: string[]; force: boolean; skipCheck: boolean; key: boolean; noInput: boolean; noSkills: boolean; clients?: Client[] };

function parseFlags(args: string[], command = "init"): Flags {
  const flags: Flags = { positional: [], force: false, skipCheck: false, key: false, noInput: false, noSkills: false };
  const takesClients = command === "setup" || command === "uninstall";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (command === "uninstall" && arg === "--key") flags.key = true;
    else if (command !== "uninstall" && arg === "--force") flags.force = true;
    else if (command !== "uninstall" && arg === "--skip-check") flags.skipCheck = true;
    else if (command === "setup" && arg === "--no-input") flags.noInput = true;
    else if (command === "setup" && arg === "--no-skills") flags.noSkills = true;
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
 * Check a key before installing or rotating it. Warnings allow partial access.
 */
async function checkAndSave(
  io: Io,
  input: { text: string; origin: string; file?: string },
  options: { replace: boolean; skipCheck: boolean },
): Promise<{ path: string; projectsReadable: boolean } | undefined> {
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

  let projectsReadable = false;
  if (!options.skipCheck) {
    const checks = await keyChecks(key, fetchOption(io));
    printChecks(io, checks);
    const failure = checks.find((check) => check.status === "fail");
    if (failure) {
      if (failure.name === "Scopes")
        io.err("Ask your SAP BTP admin for a key with a read scope listed above, then rerun this command.");
      else if (failure.name === "Read")
        io.err("The key obtained a token, but the API read failed. Check the Read message above and retry this command.");
      else
        io.err("The key did not give a token. Check the Token message above and retry this command.");
      return undefined;
    }
    projectsReadable = checks.some(check => check.name === "Read" && check.status === "ok");
  }

  if (!unchanged) writeSecretFile(target, text);
  else if ((io.platform ?? process.platform) !== "win32") chmodSync(target, 0o600);
  const how = unchanged ? "already saved" : exists ? "saved, replacing the one before," : "saved";
  // Windows has no file modes; the key lies in the user's own profile there.
  const mode = (io.platform ?? process.platform) === "win32" ? "" : " (mode 600)";
  io.out(`\nKey ${how} at ${target}${mode}.`);
  return { path: target, projectsReadable };
}

async function init(io: Io, args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const input = await readKeyInput(io, flags.positional[0]);
  const savedKey = await checkAndSave(io, input, { replace: flags.force, skipCheck: flags.skipCheck });
  if (!savedKey) return 1;
  const target = savedKey.path;
  if (input.file && resolve(input.file) !== resolve(target))
    io.out(`You can now delete ${input.file}.`);
  printSnippets(io, target);
  return 0;
}

type KeyInput = { text: string; origin: string; file?: string };

/** Whether both of the key's addresses are SAP's: where it gets its token, and the API it then reads. */
const SAP_TOKEN_HOST = /\.authentication\.[a-z0-9-]+\.hana\.ondemand\.com$/;
const SAP_API_HOST = /\.alm\.cloud\.sap$/;
/** The address of the key that is not SAP's, if any. Apps anyone can deploy on SAP BTP do not count as SAP's. */
function notSap(key: ServiceKey): string | undefined {
  for (const [address, pattern] of [[key.uaa.url, SAP_TOKEN_HOST], [key.endpoints.Api, SAP_API_HOST]] as const) {
    let host: string;
    try {
      host = new URL(address).hostname;
    } catch {
      return String(address).slice(0, 80);
    }
    if (!pattern.test(host)) return host;
  }
  return undefined;
}

/** A tenant's short name, for a choice: the first label of its token host. */
const tenantName = (key: ServiceKey) => new URL(key.uaa.url).hostname.split(".")[0] ?? "";

/** A path as typed or dragged into a terminal: quotes and shell escapes taken off. */
export function typedPath(value: string, platform: NodeJS.Platform = process.platform): string {
  const t = value.trim();
  const plain = /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : platform === "win32" ? t : t.replace(/\\(.)/g, "$1");
  return resolve(expandHome(plain));
}

const KEY_DOCS = "https://github.com/DidroAI/cloud-alm-mcp-server/blob/main/docs/service-key.md";

/** Ask which key to use until one reads as a service key; undefined when cancelled. */
async function askForKey(io: Io, e: SetupEnv, p: Prompts): Promise<KeyInput | undefined> {
  const saved = savedKeyPath(io.env);
  for (;;) {
    // Looked up again each time round: the user may just have downloaded it.
    const { key: found } = findDownloadedKey([join(e.home, "Downloads")]);
    let savedText: string | undefined;
    let savedTenant: string | undefined;
    try {
      savedText = readFileSync(saved, "utf8");
      savedTenant = tenantName(parseServiceKeyText(savedText, saved));
    } catch {}
    const options: Choice<"found" | "saved" | "file" | "paste" | "none">[] = [];
    if (found) {
      const text = readFileSync(found.path, "utf8");
      if (text.trim() !== savedText?.trim())
        options.push({
          value: "found",
          label: `Use ${basename(found.path)} from Downloads`,
          hint: tenantName(parseServiceKeyText(text, found.path)),
        });
    }
    if (savedTenant) options.push({ value: "saved", label: "Keep the key saved before", hint: savedTenant });
    options.push(
      { value: "file", label: "Choose a key file" },
      { value: "paste", label: "Paste the key", hint: "it is not shown" },
      { value: "none", label: "I don't have a key yet" },
    );
    const source = await p.select("Which Cloud ALM service key do you want to use?", options);
    if (source === undefined) return undefined;
    if (source === "found" && found)
      return { text: readFileSync(found.path, "utf8"), origin: `The file ${found.path}`, file: found.path };
    if (source === "saved" && savedText) return { text: savedText, origin: `The file ${saved}`, file: saved };
    if (source === "file") {
      const read = (value: string) => readFileSync(typedPath(value, e.platform), "utf8");
      const path = await p.text("Where is the key file?", {
        placeholder: "Type its path, or drag the file into this window",
        validate: (value) => {
          if (!value.trim()) return "Type the path of the key file.";
          let text: string;
          try {
            text = read(value);
          } catch {
            return `Cannot read ${typedPath(value, e.platform)}.`;
          }
          try {
            parseServiceKeyText(text, "That file");
          } catch (error) {
            return (error as Error).message;
          }
          return undefined;
        },
      });
      if (path === undefined) return undefined;
      const file = typedPath(path, e.platform);
      return { text: read(path), origin: `The file ${file}`, file };
    }
    if (source === "paste") {
      const text = await p.secret("Paste the key's JSON. It is not shown; press Enter if setup does not continue.");
      if (text === undefined) return undefined;
      if (!text) {
        p.warn("Nothing was pasted.");
        continue;
      }
      try {
        parseServiceKeyText(text, "The pasted text");
      } catch (error) {
        p.error((error as Error).message);
        continue;
      }
      return { text, origin: "The pasted text" };
    }
    p.note(
      [
        "The key is a JSON file from SAP BTP: a binding of the SAP Cloud ALM API",
        "service, in the subaccount of your Cloud ALM tenant. Creating it needs",
        "admin rights there.",
        "",
        "Step by step, with a video and an e-mail to send to your BTP admin:",
        KEY_DOCS,
        "",
        "When you have the file, choose it below or run this command again.",
      ].join("\n"),
      "Getting a service key",
    );
  }
}

/**
 * Install the skills for the apps that read skills from disk; one line per
 * folder for the report. Nothing when no such app was set up.
 */
function addSkills(clients: Client[], e: SetupEnv): string[] {
  const dirs = skillsDirs(clients, e);
  // Cursor reads another app's folder now: take out the copy it had of its own, or it would go stale.
  const cursorOwn = join(e.home, ".cursor", "skills");
  if (clients.includes("cursor") && !dirs.some((d) => d.dir === cursorOwn)) {
    try {
      removeSkills(cursorOwn);
    } catch {}
  }
  return dirs.map(({ dir, clients: readers }) => {
    const who = readers.map((c) => LABEL[c]).join(", ");
    try {
      const installed = installSkills(dir);
      const kept = skillNames().length - installed;
      return `${MARK.ok} ${"Skills".padEnd(14)} ${installed} installed in ${dir} (${who})${kept ? `; ${kept} left as ${kept === 1 ? "it is" : "they are"}: a skill of the same name there is not ours` : ""}`;
    } catch (error) {
      return `${MARK.warn} ${"Skills".padEnd(14)} not installed in ${dir}: ${(error as Error).message}`;
    }
  });
}

/** What to do in each app before the server shows up. */
const RESTART: Record<Client, string> = {
  "claude-desktop": "Quit Claude Desktop fully and open it again.",
  "claude-code": "Start a new Claude Code session.",
  codex: "Start a new Codex session.",
  cursor: "Reload the Cursor window.",
};

/**
 * setup for a person at a terminal: which key, a check against SAP, which
 * apps, then what to do next. Nothing is picked without being shown.
 */
async function wizard(io: Io, flags: Flags, e: SetupEnv, p: Prompts, named?: KeyInput): Promise<number> {
  const saved = savedKeyPath(io.env);
  p.intro("SAP Cloud ALM for your AI apps");

  let input: KeyInput;
  let savedKey: { path: string; projectsReadable: boolean } | undefined;
  for (;;) {
    // The file named on the command line is the first answer; when it cannot be used, ask.
    const chosen = named ?? (await askForKey(io, e, p));
    named = undefined;
    if (!chosen) {
      p.cancel("Setup cancelled. Nothing was changed.");
      return 1;
    }
    const key = parseServiceKeyText(chosen.text, chosen.origin);
    const foreign = notSap(key);
    if (foreign) {
      const go = await p.select(`This key points to ${foreign}, which is not an SAP address. Use only keys you downloaded from SAP BTP. Use it anyway?`, [
        { value: false, label: "Choose another key" },
        { value: true, label: "Use it" },
      ]);
      if (go === undefined) {
        p.cancel("Setup cancelled. Nothing was changed.");
        return 1;
      }
      if (!go) continue;
    }
    if (!flags.force && chosen.file !== saved && existsSync(saved)) {
      let before: ServiceKey | undefined;
      try {
        before = parseServiceKeyText(readFileSync(saved, "utf8"), saved);
      } catch {}
      // Compared by both addresses: two keys can share a tenant name and still open different systems.
      if (before && tenantOf(before) !== tenantOf(key)) {
        const replace = await p.select(`A key for another tenant (${tenantName(before) === tenantName(key) ? tenantOf(before) : tenantName(before)}) is saved. Replace it with the key for ${tenantName(before) === tenantName(key) ? tenantOf(key) : tenantName(key)}?`, [
          { value: true, label: "Replace it" },
          { value: false, label: "Choose another key" },
        ]);
        if (replace === undefined) {
          p.cancel("Setup cancelled. Nothing was changed.");
          return 1;
        }
        if (!replace) continue;
      }
    }
    const lines: string[] = [];
    const problems: string[] = [];
    const quiet: Io = { ...io, out: (line) => lines.push(line), err: (line) => problems.push(line) };
    savedKey = await p.spin(
      flags.skipCheck ? "Saving the key" : "Checking the key with SAP",
      () => checkAndSave(quiet, chosen, { replace: true, skipCheck: flags.skipCheck }),
      (result) => (result ? `The key for ${tenantName(key)} ${flags.skipCheck ? "is saved" : "works"}` : "This key cannot be used"),
    );
    if (lines.length) p.info(lines.join("\n").trim());
    if (problems.length) p.error(problems.join("\n"));
    if (savedKey) {
      input = chosen;
      break;
    }
  }
  const target = savedKey.path;

  const spec = packageSpec(version());
  const detected = flags.clients ?? (await detectClients(e));
  let clients = detected;
  if (!flags.clients && detected.length) {
    const picked = await p.multiselect(
      "Add Cloud ALM to which apps?",
      detected.map((client) => ({ value: client, label: LABEL[client] })),
      detected,
    );
    if (picked === undefined) {
      p.cancel("Setup cancelled. The key is saved; no app was changed.");
      return 1;
    }
    clients = picked;
  }
  let withSkills = !flags.noSkills && skillsDirs(clients, e).length > 0;
  if (withSkills) {
    const yes = await p.select(`Also install the ${skillNames().length} Cloud ALM skills (fit-gap, workshop preparation, status report, test readiness…)?`, [
      { value: true, label: "Yes", hint: "your assistant uses them on its own when a request matches" },
      { value: false, label: "No" },
    ]);
    if (yes === undefined) {
      p.cancel("Setup cancelled. The key is saved; no app was changed.");
      return 1;
    }
    withSkills = yes;
  }

  const snippets = clientSnippets(target, e.platform, spec);
  const byHand = (wanted: string[]) =>
    snippets
      .filter((s) => wanted.includes(s.client))
      .map((s) => `${s.client}: ${s.where}\n${s.text.replace(/^/gm, "  ")}`)
      .join("\n\n");
  const done: Client[] = [];
  const failed: Client[] = [];
  if (clients.length) {
    const results: string[] = [];
    for (const client of clients) {
      const r = await configureClient(client, e, target, spec, writeConfigFile);
      results.push(`${r.ok ? MARK.ok : MARK.fail} ${r.label.padEnd(14)} ${r.detail}`);
      (r.ok ? done : failed).push(client);
    }
    const missing = CLIENTS.filter((c) => !detected.includes(c)).map((c) => LABEL[c]);
    if (withSkills) results.push(...addSkills(done, e));
    if (missing.length && !flags.clients) results.push(`Not found on this computer: ${missing.join(", ")}.`);
    p.info(results.join("\n"));
    if (failed.length) p.note(byHand(failed.map((c) => LABEL[c])), "Add these by hand");
  } else if (!detected.length && !flags.clients) {
    p.warn("No AI app was found on this computer.");
    p.note(byHand(snippets.map((s) => s.client)), "Add the server to your app by hand");
  } else p.info("No app was changed.");

  const next = done.map((client) => RESTART[client]);
  if (savedKey.projectsReadable) {
    if (done.length) next.push('Then ask: "Which Cloud ALM projects can I access?"');
  } else if (!flags.skipCheck) next.push("Project access was refused. Use the Cloud ALM tools permitted by your service key.");
  if (input.file && resolve(input.file) !== resolve(target))
    next.push(`You can now delete ${input.file}: the key is saved, readable only by you.`);
  next.push(`Check the setup any time with: ${cli(io)} doctor`);
  p.note(next.join("\n"), "Next");
  const reports = localFeedback(io.env, configDir(io.env, e.platform));
  if (reports.on)
    p.info(
      "Your assistant can send Didro short reports about tool problems.\n" +
        `The server attaches no records, credentials or chat text; the sentences are the assistant's. Turn them off with: ${cli(io)} feedback off`,
    );
  p.outro(failed.length ? "Finished, with apps to add by hand." : done.length ? "Cloud ALM is ready." : "The key is saved.");
  return failed.length ? 1 : 0;
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

  let input: KeyInput;
  const arg = flags.positional[0];
  const saved = savedKeyPath(io.env);
  // A person at a terminal gets the questions, with or without a file named ("-" reads the key from a pipe).
  if (!flags.noInput && io.prompts && arg !== "-") {
    let named: KeyInput | undefined;
    if (arg) {
      named = await readKeyInput(io, arg);
      parseServiceKeyText(named.text, named.origin);
    }
    return wizard(io, flags, e, await io.prompts(), named);
  }
  if (arg) input = await readKeyInput(io, arg);
  else {
    // Downloads only: a key planted in a cloned repository is never picked up.
    const { key: found, unreadable } = findDownloadedKey([join(e.home, "Downloads")]);
    if (found) {
      io.out(`Service key: ${found.path}${found.others ? ` (the newest of ${found.others + 1})` : ""}`);
      input = { text: readFileSync(found.path, "utf8"), origin: `The file ${found.path}`, file: found.path };
      // A file nobody named is used only when it is plainly SAP's: anyone can drop a file into Downloads.
      const foreign = notSap(parseServiceKeyText(input.text, input.origin));
      if (foreign) {
        io.err(`${found.path} points to ${foreign}, which is not an SAP address, so it was not used. To use it anyway, name it: ${cli(io)} setup <file>`);
        return 1;
      }
    } else if (existsSync(saved)) {
      input = await readKeyInput(io, saved);
    } else {
      const byFile = `${cli(io)} setup <file>`;
      for (const dir of unreadable)
        io.err(
          `Could not look in ${dir}: permission denied.` +
            (e.platform === "darwin"
              ? " Allow your terminal app under System Settings → Privacy & Security → Files and Folders → Downloads, or name the file."
              : " Name the file instead."),
        );
      // Nobody to paste a key: say what is missing instead of waiting.
      if (!io.stdinIsTTY || flags.noInput || runByAgent(io.env)) {
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
  const foreign = notSap(key);
  if (foreign) io.err(`! The key points to ${foreign}, which is not an SAP address. Use only keys you downloaded from SAP BTP.`);
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
  const savedKey = await checkAndSave(io, input, { replace: true, skipCheck: flags.skipCheck });
  if (!savedKey) return 1;
  const target = savedKey.path;

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
  const configured: Client[] = [];
  for (const client of clients) {
    const r = await configureClient(client, e, target, spec, writeConfigFile);
    io.out(`${r.ok ? MARK.ok : MARK.fail} ${r.label.padEnd(14)} ${r.detail}`);
    if (r.ok) configured.push(client);
    if (!r.ok) {
      failures++;
      const s = snippets.find((x) => x.client === LABEL[client]);
      if (s) io.out(`  Add it by hand (${s.where}):\n${s.text.replace(/^/gm, "    ")}`);
    }
  }
  if (!flags.noSkills) for (const line of addSkills(configured, e)) io.out(line);
  const missing = CLIENTS.filter((c) => !clients.includes(c)).map((c) => LABEL[c]);
  if (missing.length && !flags.clients)
    io.out(`  Not found: ${missing.join(", ")}. Run \`${cli(io)} init\` to print their configuration.`);

  if (input.file && resolve(input.file) !== resolve(target))
    io.out(`\nYou can now delete ${input.file}.`);
  if (savedKey.projectsReadable && failures < clients.length)
    io.out('Open a new chat and ask: "Which Cloud ALM projects can I access?"');
  else if (!savedKey.projectsReadable && !flags.skipCheck)
    io.out("Project access was refused. Use the Cloud ALM tools permitted by your service key.");
  io.out(`Check the setup any time with: ${cli(io)} doctor`);
  io.out(`Reports about tool problems: ${feedbackLine(io)}`);
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
  for (const { dir } of skillsDirs(flags.clients ?? CLIENTS, e).concat(
    // A copy made for Cursor alone, when Claude Code and Codex were not there.
    (flags.clients ?? CLIENTS).includes("cursor") ? skillsDirs(["cursor"], e) : [],
  )) {
    try {
      const removed = removeSkills(dir);
      if (removed) io.out(`${MARK.ok} ${"Skills".padEnd(14)} ${removed} removed from ${dir}`);
    } catch (error) {
      io.out(`${MARK.fail} ${"Skills".padEnd(14)} not removed from ${dir}: ${(error as Error).message}`);
      failures++;
    }
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
  checks.push({ name: "Reports", status: "ok", detail: feedbackLine(io) });
  printChecks(io, checks);
  io.out(failed(checks) ? "\nSetup has problems." : "\nReady.");
  return failed(checks) ? 1 : 0;
}

/** Whether the assistant's reports about tool problems are on, and how to switch them. */
const feedbackLine = (io: Io) => {
  const { on, detail } = localFeedback(io.env, configDir(io.env, io.platform ?? process.platform));
  return `${detail}; turn ${on ? "off" : "on"} with: ${cli(io)} feedback ${on ? "off" : "on"}`;
};

function feedback(io: Io, args: string[]): number {
  const [choice, ...more] = args;
  if (more.length || (choice !== undefined && choice !== "on" && choice !== "off"))
    throw new UsageError("feedback takes on or off.");
  const dir = configDir(io.env, io.platform ?? process.platform);
  if (choice) setLocalFeedback(choice === "on", dir);
  const state = localFeedback(io.env, dir);
  io.out(`Reports about tool problems: ${state.detail}.`);
  if (choice) io.out("Start a new chat (quit and reopen Claude Desktop) for it to take effect.");
  else io.out(`Turn them ${state.on ? "off" : "on"} with: ${cli(io)} feedback ${state.on ? "off" : "on"}`);
  return 0;
}

export const COMMANDS = ["setup", "init", "doctor", "uninstall", "feedback", "help", "--help", "-h", "--version", "-v", "version"];

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
      case "feedback":
        return feedback(io, rest);
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
