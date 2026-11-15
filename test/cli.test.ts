import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientSnippets, shellQuote } from "../src/cli/clients.js";
import { nodeCheck } from "../src/cli/checks.js";
import {
  configDir,
  keySource,
  loadServiceKey,
  redact,
  savedKeyPath,
} from "../src/cli/key.js";
import { type Io, runCommand, version } from "../src/cli/main.js";
import { coverage, TOOL_SCOPES, tokenScopes } from "../src/cli/scopes.js";
import { TOOL_NAMES, WRITE_TOOL_NAMES } from "../src/server.js";
import { stdioServer } from "../src/stdio.js";
import { BASE_URL, projects } from "./fixtures.js";

const SECRET = "Sup3r-S3cret-Value";
const CLIENT_ID = "sb-calm-read!b1|calm-api!b2";
const KEY = {
  uaa: {
    url: "https://example.authentication.eu20.hana.ondemand.com",
    clientid: CLIENT_ID,
    clientsecret: SECRET,
  },
  endpoints: { Api: BASE_URL },
  extra: "kept",
};
const KEY_TEXT = JSON.stringify(KEY, null, 2);

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (scope: string[]) =>
  `${b64({ alg: "none" })}.${b64({ scope, exp: 0 })}.c2ln`;
const ALL_READ = [
  "projects", "tasks", "features", "documents", "testcases", "testplans",
  "processmanagement", "processhierarchy", "landscape", "lib", "analytics",
  "analytics.providers", "tests", "bsm",
].map((a) => `calm-api!b2.calm-api.${a}.read`);

type FakeOptions = { tokenStatus?: number; scope?: string[]; projectsStatus?: number };

function fakeFetch(options: FakeOptions = {}) {
  const token = jwt(options.scope ?? ALL_READ);
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (url.pathname === "/oauth/token")
      return options.tokenStatus
        ? new Response("{}", { status: options.tokenStatus })
        : Response.json({ access_token: token, expires_in: 3600 });
    if (url.pathname.endsWith("/calm-projects/v1/projects"))
      return options.projectsStatus
        ? Response.json({ message: "no" }, { status: options.projectsStatus })
        : Response.json(projects);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetcher, seen, token };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "calm-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function io(
  options: { env?: Record<string, string>; stdin?: string; fetch?: typeof fetch } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const value: Io = {
    env: { CALM_CONFIG_DIR: join(dir, "config"), ...options.env },
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    readStdin: async () => options.stdin ?? "",
    stdinIsTTY: false,
    platform: "linux",
    nodeVersion: "22.12.0",
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  return { io: value, out, err, all: () => [...out, ...err].join("\n") };
}

function keyFile(text = KEY_TEXT) {
  const path = join(dir, "downloaded-key.json");
  writeFileSync(path, text);
  return path;
}

describe("init", () => {
  test("checks a key from a file, saves it mode 600 and prints client config", async () => {
    const { fetcher, token } = fakeFetch();
    const t = io({ fetch: fetcher });
    const code = await runCommand(t.io, ["init", keyFile()]);
    expect(code).toBe(0);
    const saved = savedKeyPath(t.io.env);
    expect(saved).toBe(join(dir, "config", "service-key.json"));
    expect(statSync(saved).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(saved, "utf8"))).toEqual(KEY);
    const all = t.all();
    expect(all).toContain("✓ Scopes  11 of 11 tools usable, 10 with every part");
    expect(all).toContain("~ calm_analytics: parts need calm-api.defects.read");
    expect(all).toMatch(/projects answered \(\d+\)/);
    expect(all).toContain(`claude mcp add cloud-alm --scope user -e CALM_SERVICE_KEY=${saved} -- npx -y cloud-alm-mcp-server`);
    expect(all).toContain("[mcp_servers.cloud-alm]");
    expect(all).toContain("~/.cursor/mcp.json");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(CLIENT_ID);
    expect(all).not.toContain(token);
  });

  test("reads a pasted key from stdin", async () => {
    const t = io({ fetch: fakeFetch().fetcher, stdin: KEY_TEXT });
    expect(await runCommand(t.io, ["init"])).toBe(0);
    expect(existsSync(savedKeyPath(t.io.env))).toBe(true);
  });

  test("lists the tools a key lacks scopes for", async () => {
    const scope = ["x!b1.calm-api.projects.read", "x!b1.calm-api.landscape.read", "uaa.resource"];
    const t = io({ fetch: fakeFetch({ scope }).fetcher });
    expect(await runCommand(t.io, ["init", keyFile()])).toBe(0);
    const all = t.all();
    expect(all).toContain("! Scopes  6 of 11 tools usable, 3 with every part");
    expect(all).toContain("✗ calm_overview: needs calm-api.tasks.read");
    expect(all).toContain("~ calm_list: parts need calm-api.tasks.read");
    expect(all).toContain("~ calm_landscape: parts need calm-api.bsm.read");
  });

  test("a key the token endpoint refuses is not saved", async () => {
    const t = io({ fetch: fakeFetch({ tokenStatus: 401 }).fetcher });
    expect(await runCommand(t.io, ["init", keyFile()])).toBe(1);
    expect(existsSync(savedKeyPath(t.io.env))).toBe(false);
    expect(t.all()).toContain("refused the service key");
    expect(t.all()).not.toContain(SECRET);
  });

  test("text that is not JSON is refused without being echoed", async () => {
    const t = io({ stdin: `{"uaa": ${SECRET}` });
    expect(await runCommand(t.io, ["init", "-"])).toBe(1);
    expect(t.all()).toContain("not valid JSON");
    expect(t.all()).not.toContain(SECRET);
  });

  test("JSON without the key's parts is refused", async () => {
    const t = io({ stdin: JSON.stringify({ uaa: { clientsecret: SECRET } }) });
    expect(await runCommand(t.io, ["init"])).toBe(1);
    expect(t.all()).toContain("needs uaa.url");
    expect(t.all()).not.toContain(SECRET);
  });

  test("a different saved key is kept unless --force", async () => {
    const t = io({ fetch: fakeFetch().fetcher });
    expect(await runCommand(t.io, ["init", keyFile()])).toBe(0);
    const other = JSON.stringify({ ...KEY, extra: "other" });
    const again = io({ fetch: fakeFetch().fetcher });
    expect(await runCommand(again.io, ["init", keyFile(other)])).toBe(1);
    expect(again.all()).toContain("--force");
    const forced = io({ fetch: fakeFetch().fetcher });
    expect(await runCommand(forced.io, ["init", "--force", keyFile(other)])).toBe(0);
    expect(readFileSync(savedKeyPath(t.io.env), "utf8")).toContain('"other"');
  });

  test("--skip-check saves without contacting SAP", async () => {
    const { fetcher, seen } = fakeFetch();
    const t = io({ fetch: fetcher });
    expect(await runCommand(t.io, ["init", "--skip-check", keyFile()])).toBe(0);
    expect(seen).toEqual([]);
  });

  test("unknown options are usage errors", async () => {
    const t = io();
    expect(await runCommand(t.io, ["init", "--nope"])).toBe(2);
  });
});

describe("doctor", () => {
  test("without a key, says how to get one", async () => {
    const t = io();
    expect(await runCommand(t.io, ["doctor"])).toBe(1);
    expect(t.all()).toContain("run `cloud-alm-mcp-server init`");
  });

  test("checks the saved key end to end", async () => {
    const setup = io({ fetch: fakeFetch().fetcher });
    await runCommand(setup.io, ["init", keyFile()]);
    const t = io({ fetch: fakeFetch().fetcher });
    expect(await runCommand(t.io, ["doctor"])).toBe(0);
    const all = t.all();
    expect(all).toContain("✓ Node    v22.12.0");
    expect(all).toContain(`✓ Key     ${savedKeyPath(t.io.env)}`);
    expect(all).toContain("✓ Token   issued, valid 60 min");
    expect(all).toContain("Ready.");
    expect(all).not.toContain(SECRET);
  });

  test("in write mode, checks the write tools' scopes and the default project", async () => {
    const t = io({
      fetch: fakeFetch().fetcher,
      env: { CALM_SERVICE_KEY: KEY_TEXT, CALM_WRITE: "on", CALM_PROJECT: "99999999-0000-4000-8000-000000000000" },
    });
    expect(await runCommand(t.io, ["doctor"])).toBe(1);
    const all = t.all();
    expect(all).toContain("✓ Mode    write on, approval prefer; all tools; default project 99999999");
    expect(all).toContain("✗ calm_create_task: needs calm-api.tasks.write");
    expect(all).toContain("✗ Project CALM_PROJECT 99999999-0000-4000-8000-000000000000 is not a project");
  });

  test("a bad CALM_WRITE fails the doctor", async () => {
    const t = io({ fetch: fakeFetch().fetcher, env: { CALM_SERVICE_KEY: KEY_TEXT, CALM_WRITE: "yes" } });
    expect(await runCommand(t.io, ["doctor"])).toBe(1);
    expect(t.all()).toContain("CALM_WRITE must be");
  });

  test("takes CALM_SERVICE_KEY as inline JSON", async () => {
    const t = io({ fetch: fakeFetch().fetcher, env: { CALM_SERVICE_KEY: KEY_TEXT } });
    expect(await runCommand(t.io, ["doctor"])).toBe(0);
    expect(t.all()).toContain("CALM_SERVICE_KEY (inline JSON)");
    expect(t.all()).not.toContain(SECRET);
  });

  test("flags a key file others can read", async () => {
    const path = keyFile();
    const { chmodSync } = await import("node:fs");
    chmodSync(path, 0o644);
    const t = io({ fetch: fakeFetch().fetcher, env: { CALM_SERVICE_KEY: path } });
    expect(await runCommand(t.io, ["doctor"])).toBe(0);
    expect(t.all()).toContain("readable by others");
  });

  test("a 403 on projects means reached but not readable", async () => {
    const t = io({
      fetch: fakeFetch({ projectsStatus: 403 }).fetcher,
      env: { CALM_SERVICE_KEY: KEY_TEXT },
    });
    expect(await runCommand(t.io, ["doctor"])).toBe(0);
    expect(t.all()).toContain("! Read    API reached; projects refused");
  });

  test("an unreadable key file fails", async () => {
    const t = io({ env: { CALM_SERVICE_KEY: join(dir, "missing.json") } });
    expect(await runCommand(t.io, ["doctor"])).toBe(1);
    expect(t.all()).toContain("Cannot read the service key file");
  });

  test("an old Node fails", () => {
    expect(nodeCheck("20.1.0").status).toBe("fail");
    expect(nodeCheck("24.0.0").status).toBe("ok");
  });
});

describe("other commands", () => {
  test("--version prints the package version", async () => {
    const t = io();
    expect(await runCommand(t.io, ["--version"])).toBe(0);
    expect(t.out).toEqual([version()]);
    expect(version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--help lists the commands", async () => {
    const t = io();
    expect(await runCommand(t.io, ["--help"])).toBe(0);
    for (const word of ["init", "doctor", "http", "CALM_SERVICE_KEY"])
      expect(t.all()).toContain(word);
  });
});

describe("key handling", () => {
  test("config dir follows CALM_CONFIG_DIR, XDG, APPDATA", () => {
    expect(configDir({ CALM_CONFIG_DIR: "/x" }, "linux", "/h")).toBe("/x");
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/h")).toBe("/xdg/cloud-alm-mcp-server");
    expect(configDir({}, "darwin", "/h")).toBe("/h/.config/cloud-alm-mcp-server");
    expect(configDir({ APPDATA: "C:\\A" }, "win32", "/h")).toContain("cloud-alm-mcp-server");
  });

  test("CALM_SERVICE_KEY wins over the saved key; ~ expands", () => {
    const always = () => true;
    expect(keySource({ CALM_SERVICE_KEY: "~/k.json" }, always)).toMatchObject({ kind: "file" });
    expect(keySource({ CALM_SERVICE_KEY: " {}" }, always)?.kind).toBe("inline");
    expect(keySource({ CALM_CONFIG_DIR: "/c" }, always)).toMatchObject({ path: "/c/service-key.json" });
    expect(keySource({ CALM_CONFIG_DIR: "/c" }, () => false)).toBeUndefined();
  });

  test("an inline key with bad JSON is refused without echo", () => {
    const env = { CALM_SERVICE_KEY: `{ ${SECRET}` };
    expect(() => loadServiceKey({ kind: "inline", label: "" }, env)).toThrow("not valid JSON");
    try {
      loadServiceKey({ kind: "inline", label: "" }, env);
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET);
    }
  });

  test("the stdio server starts from an inline key", () => {
    expect(() => stdioServer({ CALM_SERVICE_KEY: KEY_TEXT })).not.toThrow();
    expect(() => stdioServer({ CALM_CONFIG_DIR: join(dir, "none") })).toThrow("init");
  });

  test("redact removes known secrets, bearer values and long opaque strings", () => {
    const token = jwt(ALL_READ);
    const text = redact(`a ${SECRET} b Bearer abc c ${token} d /home/me/.config/cloud-alm-mcp-server/service-key.json`, [SECRET]);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(token);
    expect(text).toContain("Bearer [redacted]");
    expect(text).toContain("/home/me/.config/cloud-alm-mcp-server/service-key.json");
  });
});

describe("scopes", () => {
  test("reads calm-api scopes from the token payload", () => {
    expect(tokenScopes(jwt(["a!b1.calm-api.tasks.read", "uaa.resource"]))).toEqual(["calm-api.tasks.read"]);
    expect(tokenScopes(`${b64({})}.${b64({ scope: "x.calm-api.bsm.read openid" })}.s`)).toEqual(["calm-api.bsm.read"]);
    expect(tokenScopes("opaque")).toBeUndefined();
  });

  test("every tool of the server has a scope entry", () => {
    for (const name of [...TOOL_NAMES, ...WRITE_TOOL_NAMES]) expect(TOOL_SCOPES[name]).toBeDefined();
    expect(Object.keys(TOOL_SCOPES).sort()).toEqual([...TOOL_NAMES, ...WRITE_TOOL_NAMES].sort());
  });

  test("coverage: core scopes decide usable, extra scopes decide complete", () => {
    const [row] = coverage(["calm-api.landscape.read"], ["calm_landscape"]);
    expect(row).toEqual({ tool: "calm_landscape", status: "partial", missing: ["calm-api.bsm.read"] });
    expect(coverage([], ["calm_landscape"])[0]?.status).toBe("none");
  });
});

describe("client snippets", () => {
  test("quote paths with spaces for the shell and TOML", () => {
    const path = "/Users/Jo Doe/.config/cloud-alm-mcp-server/service-key.json";
    const snippets = clientSnippets(path, "darwin");
    expect(snippets[0]?.text).toContain(`-e 'CALM_SERVICE_KEY=${path}'`);
    expect(snippets.find((s) => s.client === "Codex (by hand)")?.text).toContain(`CALM_SERVICE_KEY = "${path}"`);
    expect(snippets.find((s) => s.client === "Claude Desktop")?.where).toContain("Library/Application Support");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

test("a prerelease pins its version in the setup lines", async () => {
  const { packageSpec, clientSnippets } = await import("../src/cli/clients.js");
  expect(packageSpec("0.1.0")).toBe("cloud-alm-mcp-server");
  expect(packageSpec("0.1.0-beta.0")).toBe("cloud-alm-mcp-server@0.1.0-beta.0");
  const lines = clientSnippets("/k.json", "linux", packageSpec("0.1.0-beta.0")).map((s) => s.text).join("\n");
  expect(lines).toContain("npx -y cloud-alm-mcp-server@0.1.0-beta.0");
  expect(lines).toContain('"cloud-alm-mcp-server@0.1.0-beta.0"');
});
