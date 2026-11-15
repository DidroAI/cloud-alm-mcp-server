import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseServiceKey, type ServiceKey } from "../calm/index.js";

/** Env var with the service key: a path to its JSON file, or the JSON itself. */
export const SERVICE_KEY_ENV = "CALM_SERVICE_KEY";
/** Env var overriding where `init` saves the key (mostly for tests). */
export const CONFIG_DIR_ENV = "CALM_CONFIG_DIR";
/** File name of the saved key inside the config directory. */
export const SAVED_KEY_FILE = "service-key.json";

type Env = Record<string, string | undefined>;

/** `~/…` → the home directory. */
export function expandHome(path: string, home = homedir()): string {
  return path.replace(/^~(?=$|[/\\])/, home);
}

/**
 * This tool's config directory: `CALM_CONFIG_DIR`, else
 * `%APPDATA%\cloud-alm-mcp-server` on Windows, else
 * `$XDG_CONFIG_HOME/cloud-alm-mcp-server` (default `~/.config/…`).
 */
export function configDir(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const override = env[CONFIG_DIR_ENV]?.trim();
  if (override) return expandHome(override, home);
  if (platform === "win32" && env.APPDATA)
    return join(env.APPDATA, "cloud-alm-mcp-server");
  const base = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  return join(base, "cloud-alm-mcp-server");
}

export function savedKeyPath(env: Env = process.env): string {
  return join(configDir(env), SAVED_KEY_FILE);
}

/** True when the value is the key JSON itself rather than a path. */
export const isInlineJson = (value: string) => value.trimStart().startsWith("{");

/**
 * Parse service key text. Never echoes the text: a JSON parse error's own
 * message can quote the input, so it is replaced.
 */
export function parseServiceKeyText(text: string, origin: string): ServiceKey {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${origin} is not valid JSON.`);
  }
  try {
    return parseServiceKey(json);
  } catch {
    throw new Error(
      `${origin} is not a Cloud ALM API service key: it needs uaa.url, uaa.clientid, uaa.clientsecret and endpoints.Api.`,
    );
  }
}

/** True when the text is a Cloud ALM API service key. */
export function isServiceKey(text: string): boolean {
  try {
    parseServiceKey(JSON.parse(text));
    return true;
  } catch {
    return false;
  }
}

/** Where the key came from, for messages. Never the key itself. */
export type KeySource =
  | { kind: "inline"; label: string }
  | { kind: "file"; path: string; label: string };

/**
 * Where to find the key: `CALM_SERVICE_KEY` (path or inline JSON), else the
 * key saved by `init`. Undefined when neither is set.
 */
export function keySource(
  env: Env = process.env,
  exists: (path: string) => boolean,
): KeySource | undefined {
  const value = env[SERVICE_KEY_ENV]?.trim();
  if (value) {
    if (isInlineJson(value))
      return { kind: "inline", label: `${SERVICE_KEY_ENV} (inline JSON)` };
    const path = expandHome(value);
    return { kind: "file", path, label: `${SERVICE_KEY_ENV} → ${path}` };
  }
  const saved = savedKeyPath(env);
  if (exists(saved)) return { kind: "file", path: saved, label: saved };
  return undefined;
}

/** Read and check the key from a source. */
export function loadServiceKey(
  source: KeySource,
  env: Env = process.env,
  read: (path: string) => string = (p) => readFileSync(p, "utf8"),
): ServiceKey {
  if (source.kind === "inline")
    return parseServiceKeyText(env[SERVICE_KEY_ENV] ?? "", SERVICE_KEY_ENV);
  let text: string;
  try {
    text = read(source.path);
  } catch {
    throw new Error(`Cannot read the service key file ${source.path}.`);
  }
  return parseServiceKeyText(text, `The service key file ${source.path}`);
}

/**
 * Replace every secret value of a key (and any long opaque string) in a
 * message with `[redacted]`, as a last line of defence before printing.
 */
export function redact(message: string, secrets: string[] = []): string {
  let out = message;
  for (const secret of secrets)
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  return out
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [redacted]")
    .replace(/[A-Za-z0-9_\-+=.]{48,}/g, "[redacted]");
}

export const keySecrets = (key: ServiceKey | undefined): string[] =>
  key ? [key.uaa.clientsecret, key.uaa.clientid] : [];
