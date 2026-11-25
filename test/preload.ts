/**
 * Runs before every test file: no CALM_* variables and no network,
 * whatever the machine holds. The home directory is pointed at an empty
 * folder too, but Bun reads it once at start, so a test that must not see
 * a saved key names a config directory of its own.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "calm-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.APPDATA = join(home, "AppData");
process.env.XDG_CONFIG_HOME = join(home, ".config");
for (const name of Object.keys(process.env)) if (name.startsWith("CALM_") || name === "CLAUDE_CONFIG_DIR") delete process.env[name];

const real = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const host = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new Error(`A test reached for ${host}: give it a fake fetch.`);
  return real(input as never, init);
}) as typeof fetch;
