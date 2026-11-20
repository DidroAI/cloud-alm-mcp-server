import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliCommand, clientSnippets, packageSpec, shellQuote } from "../src/cli/clients.js";
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

  test("accepts a key file saved with a UTF-8 byte order mark", async () => {
    const t = io({ fetch: fakeFetch().fetcher });
    expect(await runCommand(t.io, ["init", keyFile(`\uFEFF${KEY_TEXT}`)])).toBe(0);
    const saved = readFileSync(savedKeyPath(t.io.env), "utf8");
    expect(saved.charCodeAt(0)).toBe(0x7b);
    expect(JSON.parse(saved)).toEqual(KEY);
    const d = io({ fetch: fakeFetch().fetcher, env: { CALM_SERVICE_KEY: keyFile(`\uFEFF${KEY_TEXT}`) } });
    expect(await runCommand(d.io, ["doctor"])).toBe(0);
  });

  test("on Windows the saved line does not speak of a file mode", async () => {
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.platform = "win32";
    expect(await runCommand(t.io, ["init", keyFile()])).toBe(0);
    expect(t.all()).toContain(`Key saved at ${savedKeyPath(t.io.env)}.`);
    expect(t.all()).not.toContain("mode 600");
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
    expect(t.all()).toContain("run `npx -y cloud-alm-mcp-server setup`");
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

  test("the key decides: a key without write scopes reads only", async () => {
    const t = io({ fetch: fakeFetch().fetcher, env: { CALM_SERVICE_KEY: KEY_TEXT, CALM_WRITE: "on" } });
    expect(await runCommand(t.io, ["doctor"])).toBe(0);
    expect(t.all()).toContain("✓ Writes  off: the key has no write scopes");
    expect(t.all()).not.toContain("Mode");
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

  test("a placeholder the client left unfilled counts as no key set", () => {
    const saved = join(dir, "config", "service-key.json");
    const env = { CALM_CONFIG_DIR: join(dir, "config"), CALM_SERVICE_KEY: "${user_config.service_key_file}" };
    expect(keySource(env, () => false)).toBeUndefined();
    expect(keySource(env, () => true)).toMatchObject({ kind: "file", path: saved });
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
    expect(() => stdioServer({ CALM_CONFIG_DIR: join(dir, "none") })).toThrow("setup");
  });

  test("the key decides the tools: write tools only for write scopes", async () => {
    const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client");
    const names = async (scope: string[]) => {
      const server = await stdioServer({ CALM_SERVICE_KEY: KEY_TEXT }, { fetch: fakeFetch({ scope }).fetcher });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(b);
      const client = new Client({ name: "t", version: "0" });
      await client.connect(a);
      return (await client.listTools()).tools.map((t) => t.name);
    };
    const read = await names(ALL_READ);
    expect(read).toContain("calm_list");
    expect(read).not.toContain("calm_create_task");
    const write = await names([...ALL_READ, "x!b1.calm-api.tasks.write"]);
    expect(write).toContain("calm_create_task");
    expect(write).toContain("calm_comment");
    expect(write).toContain("calm_confirm");
    expect(write).not.toContain("calm_create_test_case");
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

test("a prerelease runs under the beta tag, a release under the bare name", () => {
  expect(packageSpec("0.1.0")).toBe("cloud-alm-mcp-server");
  expect(packageSpec("0.1.0-beta.0")).toBe("cloud-alm-mcp-server@beta");
  expect(packageSpec("0.2.0-rc.1")).toBe("cloud-alm-mcp-server@beta");
  const lines = clientSnippets("/k.json", "linux", packageSpec("0.1.0-beta.0")).map((s) => s.text).join("\n");
  expect(lines).toContain("npx -y cloud-alm-mcp-server@beta");
  expect(lines).toContain('"cloud-alm-mcp-server@beta"');
  expect(lines).not.toContain("0.1.0-beta.0");
});

describe("follow-up commands are runnable as printed", () => {
  const spec = "cloud-alm-mcp-server";
  test("through npx unless the CLI is installed globally", () => {
    expect(cliCommand(spec, {}, "/home/u/.npm/_npx/ab12/node_modules/cloud-alm-mcp-server/dist/cli.js")).toBe(`npx -y ${spec}`);
    expect(cliCommand(spec, { npm_command: "exec" }, "/x/node_modules/cloud-alm-mcp-server/dist/cli.js")).toBe(`npx -y ${spec}`);
    expect(cliCommand(spec, {}, "/repo/dist/cli.js")).toBe(`npx -y ${spec}`);
    expect(cliCommand(spec, {}, "/usr/local/lib/node_modules/cloud-alm-mcp-server/dist/cli.js")).toBe("cloud-alm-mcp-server");
    expect(cliCommand(spec, {}, "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\cloud-alm-mcp-server\\dist\\cli.js")).toBe("cloud-alm-mcp-server");
  });

  test("init, doctor and usage errors name the npx command; a global install the bare one", async () => {
    const t = io({ fetch: fakeFetch().fetcher });
    expect(await runCommand(t.io, ["init", keyFile()])).toBe(0);
    expect(t.all()).toContain("check the setup any time with: npx -y cloud-alm-mcp-server doctor");
    const u = io();
    expect(await runCommand(u.io, ["init", "--nope"])).toBe(2);
    expect(u.all()).toContain("See npx -y cloud-alm-mcp-server --help.");
    const g = io({ env: { CALM_CONFIG_DIR: join(dir, "empty") } });
    g.io.scriptPath = "/usr/local/lib/node_modules/cloud-alm-mcp-server/dist/cli.js";
    expect(await runCommand(g.io, ["doctor"])).toBe(1);
    expect(g.all()).toContain("run `cloud-alm-mcp-server setup`");
  });

  test("the stdio server without a key says how to set up", () => {
    expect(() => stdioServer({ CALM_CONFIG_DIR: join(dir, "none") })).toThrow(
      /not set up yet.*npx -y cloud-alm-mcp-server setup/,
    );
  });
});

describe("setup", () => {
  function machine(options: { claude?: boolean; codex?: boolean; desktop?: string; cursor?: boolean } = {}) {
    const home = join(dir, "home");
    const nodeDir = join(dir, "node", "bin");
    mkdirSync(join(home, "Downloads"), { recursive: true });
    mkdirSync(nodeDir, { recursive: true });
    writeFileSync(join(nodeDir, "npx"), "");
    if (options.desktop !== undefined) {
      mkdirSync(join(home, ".config", "Claude"), { recursive: true });
      if (options.desktop) writeFileSync(join(home, ".config", "Claude", "claude_desktop_config.json"), options.desktop);
    }
    if (options.cursor) mkdirSync(join(home, ".cursor"), { recursive: true });
    const calls: string[] = [];
    const exec = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(" "));
      const installed = (cmd === "claude" && options.claude) || (cmd === "codex" && options.codex);
      return { code: installed ? 0 : 127, stdout: "", stderr: installed ? "" : "not found" };
    };
    return { home, nodeDir, calls, setup: { home, exec, execPath: join(nodeDir, "node"), env: {} } };
  }

  test("takes the newest key in Downloads, saves it and adds the server to the clients found", async () => {
    const m = machine({ claude: true, desktop: JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" }), cursor: true });
    writeFileSync(join(m.home, "Downloads", "notes.json"), '{"a":1}');
    const keyPath = join(m.home, "Downloads", "calm-demo-key.json");
    writeFileSync(keyPath, KEY_TEXT);
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["setup"])).toBe(0);
    const saved = savedKeyPath(t.io.env);
    const all = t.all();
    expect(all).toContain(`Service key: ${keyPath}`);
    expect(JSON.parse(readFileSync(saved, "utf8"))).toEqual(KEY);
    expect(m.calls).toContain(`claude mcp add cloud-alm --scope user -e CALM_SERVICE_KEY=${saved} -- npx -y ${packageSpec(version())}`);
    expect(m.calls.some((c) => c.startsWith("codex mcp add"))).toBe(false);
    const desktop = JSON.parse(readFileSync(join(m.home, ".config", "Claude", "claude_desktop_config.json"), "utf8"));
    expect(desktop.theme).toBe("dark");
    expect(desktop.mcpServers.other).toEqual({ command: "x" });
    expect(desktop.mcpServers["cloud-alm"].command).toBe(join(m.nodeDir, "npx"));
    expect(desktop.mcpServers["cloud-alm"].env.CALM_SERVICE_KEY).toBe(saved);
    expect(desktop.mcpServers["cloud-alm"].env.PATH.split(":")[0]).toBe(m.nodeDir);
    expect(existsSync(join(m.home, ".cursor", "mcp.json"))).toBe(true);
    expect(all).toContain("✓ Claude Code");
    expect(all).toContain("Not found: Codex");
    expect(all).toContain(`You can now delete ${keyPath}`);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(CLIENT_ID);
  });

  test("unusable scopes stop setup before changing a saved key or client", async () => {
    const m = machine({ cursor: true });
    const config = join(m.home, ".cursor", "mcp.json");
    writeFileSync(config, "{}");
    const original = io({ fetch: fakeFetch().fetcher });
    await runCommand(original.io, ["init", keyFile()]);
    const saved = savedKeyPath(original.io.env);
    const before = readFileSync(saved, "utf8");
    const t = io({ fetch: fakeFetch({ scope: ["unrelated.scope"], projectsStatus: 403 }).fetcher });
    t.io.setup = m.setup;
    const replacement = keyFile(JSON.stringify({ ...KEY, extra: "replacement" }));
    expect(await runCommand(t.io, ["setup", replacement])).toBe(1);
    expect(t.all()).toContain("Ask your SAP BTP admin");
    expect(t.all()).not.toContain("Open a new chat");
    expect(readFileSync(saved, "utf8")).toBe(before);
    expect(readFileSync(config, "utf8")).toBe("{}");
  });

  test("a failed API read after token exchange is reported separately from missing scopes", async () => {
    const m = machine({ cursor: true });
    const t = io({ fetch: fakeFetch({ projectsStatus: 503 }).fetcher });
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["setup", keyFile()])).toBe(1);
    expect(t.all()).toContain("the API read failed");
    expect(t.all()).not.toContain("Ask your SAP BTP admin");
    expect(existsSync(savedKeyPath(t.io.env))).toBe(false);
    expect(existsSync(join(m.home, ".cursor", "mcp.json"))).toBe(false);
  });

  test("a landscape-only key can set up a client when projects are refused", async () => {
    const m = machine({ cursor: true });
    const t = io({ fetch: fakeFetch({ scope: ["calm-api.landscape.read"], projectsStatus: 403 }).fetcher });
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["setup", keyFile()])).toBe(0);
    expect(existsSync(join(m.home, ".cursor", "mcp.json"))).toBe(true);
    expect(t.all()).toContain("Project access was refused");
    expect(t.all()).not.toContain("Which Cloud ALM projects can I access?");
  });

  test("replaces a key saved before; a broken client config fails with the snippet to add by hand", async () => {
    const m = machine({ desktop: "{ not json" });
    const first = io({ fetch: fakeFetch().fetcher });
    first.io.setup = m.setup;
    await runCommand(first.io, ["init", keyFile()]);
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = m.setup;
    const other = keyFile(JSON.stringify({ ...KEY, extra: "new" }));
    expect(await runCommand(t.io, ["setup", other])).toBe(1);
    expect(t.all()).toContain("replacing the one before");
    expect(t.all()).toContain("✗ Claude Desktop");
    expect(t.all()).toContain("Add it by hand");
    expect(JSON.parse(readFileSync(savedKeyPath(t.io.env), "utf8")).extra).toBe("new");
  });

  test("reuses the saved key after the downloaded copy has been deleted", async () => {
    const m = machine({ cursor: true });
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = m.setup;
    const downloaded = join(m.home, "Downloads", "key.json");
    writeFileSync(downloaded, KEY_TEXT);
    expect(await runCommand(t.io, ["setup", "--client", "none"])).toBe(0);
    rmSync(downloaded);
    const saved = savedKeyPath(t.io.env);
    if (process.platform !== "win32") chmodSync(saved, 0o644);
    expect(await runCommand(t.io, ["setup", "--client", "cursor"])).toBe(0);
    if (process.platform !== "win32") expect(statSync(saved).mode & 0o777).toBe(0o600);
    const config = JSON.parse(readFileSync(join(m.home, ".cursor", "mcp.json"), "utf8"));
    expect(config.mcpServers["cloud-alm"].env.CALM_SERVICE_KEY).toBe(saved);
  });

  test("a failed CLI add does not remove the existing client registration", async () => {
    const m = machine();
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = { ...m.setup, exec: async (cmd, args) => {
      m.calls.push([cmd, ...args].join(" "));
      return { code: 1, stdout: "", stderr: "Permission denied" };
    } };
    expect(await runCommand(t.io, ["setup", keyFile(), "--client", "claude-code,codex"])).toBe(1);
    expect(m.calls.length).toBe(2);
    expect(m.calls.every(call => call.includes("mcp add"))).toBe(true);
  });

  test("upgrades Claude Code's existing user registration in place", async () => {
    const m = machine();
    const t = io({ fetch: fakeFetch().fetcher });
    const claudeDir = join(m.home, "claude-profile");
    mkdirSync(claudeDir);
    const path = join(claudeDir, ".claude.json");
    const before = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" }, "cloud-alm": { command: "beta" } } });
    writeFileSync(path, before);
    t.io.setup = { ...m.setup, env: { CLAUDE_CONFIG_DIR: claudeDir }, exec: async () =>
      ({ code: 1, stdout: "", stderr: "MCP server cloud-alm already exists in user config" }) };
    expect(await runCommand(t.io, ["setup", keyFile(), "--client", "claude-code"])).toBe(0);
    expect(readFileSync(`${path}.bak`, "utf8")).toBe(before);
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.theme).toBe("dark");
    expect(after.mcpServers.other).toEqual({ command: "x" });
    expect(after.mcpServers["cloud-alm"].args).toEqual(["-y", packageSpec(version())]);
  });

  test("without a key in Downloads and no terminal, says where to get one", async () => {
    const m = machine();
    const t = io();
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["setup"])).toBe(1);
    expect(t.all()).toContain("No service key found in ~/Downloads");
  });

  test("on a terminal, says that Downloads has no key before asking to paste", async () => {
    const m = machine();
    const t = io({ fetch: fakeFetch().fetcher, stdin: KEY_TEXT });
    t.io.stdinIsTTY = true;
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["setup", "--client", "none"])).toBe(0);
    const err = t.err.join("\n");
    expect(err).toContain("No service key found in ~/Downloads from the last week.");
    expect(err).toContain("npx -y cloud-alm-mcp-server setup <file>");
    expect(err.indexOf("No service key found")).toBeLessThan(err.indexOf("Paste the service key JSON"));
    expect(existsSync(savedKeyPath(t.io.env))).toBe(true);
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "a Downloads folder that may not be read is reported, not passed over",
    async () => {
      const m = machine();
      const downloads = join(m.home, "Downloads");
      writeFileSync(join(downloads, "key.json"), KEY_TEXT);
      chmodSync(downloads, 0o000);
      try {
        const t = io();
        t.io.setup = m.setup;
        t.io.platform = "darwin";
        expect(await runCommand(t.io, ["setup"])).toBe(1);
        expect(t.all()).toContain(`Could not look in ${downloads}: permission denied.`);
        expect(t.all()).toContain("Privacy & Security");
        expect(t.all()).not.toContain("No service key found in ~/Downloads");
      } finally {
        chmodSync(downloads, 0o700);
      }
    },
  );

  test("stops first when Node is too old", async () => {
    const m = machine({ claude: true });
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = m.setup;
    t.io.nodeVersion = "18.19.0";
    expect(await runCommand(t.io, ["setup", keyFile()])).toBe(1);
    expect(t.all()).toContain("Node v18.19.0; needs 22 or later. Install the current LTS from https://nodejs.org");
    expect(existsSync(savedKeyPath(t.io.env))).toBe(false);
    expect(m.calls).toEqual([]);
  });

  test("ends with commands that run as printed", async () => {
    const m = machine({ claude: true });
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["setup", keyFile()])).toBe(0);
    expect(t.all()).toContain("Check the setup any time with: npx -y cloud-alm-mcp-server doctor");
    expect(t.all()).toContain("Run `npx -y cloud-alm-mcp-server init`");
    expect(m.calls).toContain(
      `claude mcp add cloud-alm --scope user -e CALM_SERVICE_KEY=${savedKeyPath(t.io.env)} -- npx -y cloud-alm-mcp-server`,
    );
  });

  test("Windows: writes the Store app's Claude Desktop config too", async () => {
    const m = machine();
    const appData = join(m.home, "AppData", "Roaming");
    const local = join(m.home, "AppData", "Local");
    const usual = join(appData, "Claude");
    const store = join(local, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
    mkdirSync(usual, { recursive: true });
    mkdirSync(store, { recursive: true });
    mkdirSync(join(local, "Packages", "Other_1", "LocalCache", "Roaming", "Claude"), { recursive: true });
    mkdirSync(join(local, "Packages", "Claude_empty"), { recursive: true });
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.platform = "win32";
    t.io.setup = { ...m.setup, env: { APPDATA: appData, LOCALAPPDATA: local } };
    expect(await runCommand(t.io, ["setup", keyFile()])).toBe(0);
    for (const folder of [usual, store]) {
      const config = JSON.parse(readFileSync(join(folder, "claude_desktop_config.json"), "utf8"));
      expect(config.mcpServers["cloud-alm"]).toEqual({
        command: "npx",
        args: ["-y", "cloud-alm-mcp-server"],
        env: { CALM_SERVICE_KEY: savedKeyPath(t.io.env) },
      });
    }
    expect(existsSync(join(local, "Packages", "Other_1", "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"))).toBe(false);
    expect(t.all()).toContain("✓ Claude Desktop");
    expect(t.all()).not.toContain("mode 600");
  });

  test("Windows: the Store app alone is found and is the only config written", async () => {
    const m = machine();
    const appData = join(m.home, "AppData", "Roaming");
    const local = join(m.home, "AppData", "Local");
    const store = join(local, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
    mkdirSync(store, { recursive: true });
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.platform = "win32";
    t.io.setup = { ...m.setup, env: { APPDATA: appData, LOCALAPPDATA: local } };
    expect(await runCommand(t.io, ["setup", keyFile()])).toBe(0);
    expect(existsSync(join(store, "claude_desktop_config.json"))).toBe(true);
    expect(existsSync(join(appData, "Claude"))).toBe(false);
  });

  test("--client none saves the key and prints the configuration", async () => {
    const m = machine({ claude: true });
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["setup", keyFile(), "--client", "none"])).toBe(0);
    expect(m.calls.filter((c) => c.includes("mcp add"))).toEqual([]);
    expect(t.all()).toContain("[mcp_servers.cloud-alm]");
    expect(await runCommand(t.io, ["setup", "--client", "vim"])).toBe(2);
  });
});

describe("setup safety", () => {
  test("a key of another tenant found in Downloads does not replace the saved one without --force", async () => {
    const home = join(dir, "home2");
    mkdirSync(join(home, "Downloads"), { recursive: true });
    const exec = async () => ({ code: 127, stdout: "", stderr: "" });
    const first = io({ fetch: fakeFetch().fetcher });
    await runCommand(first.io, ["init", keyFile()]);
    const other = { ...KEY, uaa: { ...KEY.uaa, url: "https://other.authentication.eu10.hana.ondemand.com" } };
    writeFileSync(join(home, "Downloads", "k.json"), JSON.stringify(other));
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = { home, exec, execPath: join(dir, "node"), env: {} };
    expect(await runCommand(t.io, ["setup", "--client", "none"])).toBe(1);
    expect(t.all()).toContain("A key for another tenant");
    expect(JSON.parse(readFileSync(savedKeyPath(t.io.env), "utf8")).uaa.url).toBe(KEY.uaa.url);
    expect(await runCommand(t.io, ["setup", "--client", "none", "--force"])).toBe(0);
    expect(JSON.parse(readFileSync(savedKeyPath(t.io.env), "utf8")).uaa.url).toBe(other.uaa.url);
  });

  test("a client config keeps its mode and gets a backup", async () => {
    const home = join(dir, "home3");
    mkdirSync(join(home, "Downloads"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const cfg = join(home, ".cursor", "mcp.json");
    writeFileSync(cfg, '{"mcpServers":{}}', { mode: 0o600 });
    const t = io({ fetch: fakeFetch().fetcher });
    t.io.setup = { home, exec: async () => ({ code: 127, stdout: "", stderr: "" }), execPath: join(dir, "node"), env: {} };
    expect(await runCommand(t.io, ["setup", keyFile(), "--client", "cursor"])).toBe(0);
    expect(statSync(cfg).mode & 0o777).toBe(0o600);
    expect(readFileSync(`${cfg}.bak`, "utf8")).toBe('{"mcpServers":{}}');
    expect(t.all()).toContain("Tenant: example.authentication.eu20.hana.ondemand.com");
  });
});

describe("uninstall", () => {
  function installed() {
    const home = join(dir, "home4");
    mkdirSync(join(home, ".config", "Claude"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const desktop = join(home, ".config", "Claude", "claude_desktop_config.json");
    const cursor = join(home, ".cursor", "mcp.json");
    const before = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" }, "cloud-alm": { command: "npx" } } });
    writeFileSync(desktop, before);
    writeFileSync(cursor, JSON.stringify({ mcpServers: { other: { command: "y" } } }));
    const calls: string[] = [];
    const exec = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(" "));
      return { code: cmd === "claude" ? 0 : 127, stdout: "", stderr: "" };
    };
    return { home, desktop, cursor, before, calls, setup: { home, exec, execPath: join(dir, "node"), env: {} } };
  }

  test("removes the server from every client, keeps a backup and the key", async () => {
    const m = installed();
    const first = io({ fetch: fakeFetch().fetcher });
    await runCommand(first.io, ["init", keyFile()]);
    const t = io();
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["uninstall"])).toBe(0);
    expect(m.calls).toContain("claude mcp remove cloud-alm --scope user");
    expect(m.calls.some((c) => c.startsWith("codex mcp"))).toBe(false);
    expect(JSON.parse(readFileSync(m.desktop, "utf8"))).toEqual({ theme: "dark", mcpServers: { other: { command: "x" } } });
    expect(readFileSync(`${m.desktop}.bak`, "utf8")).toBe(m.before);
    expect(existsSync(`${m.cursor}.bak`)).toBe(false);
    const all = t.all();
    expect(all).toContain("✓ Claude Code    removed (claude mcp remove)");
    expect(all).toContain("✓ Codex          not installed");
    expect(all).toContain("✓ Cursor         was not set up");
    expect(existsSync(savedKeyPath(t.io.env))).toBe(true);
    expect(all).toContain("npx -y cloud-alm-mcp-server uninstall --key");
  });

  test("--key also deletes the saved key; --client narrows; a second run changes nothing", async () => {
    const m = installed();
    const first = io({ fetch: fakeFetch().fetcher });
    await runCommand(first.io, ["init", keyFile()]);
    const t = io();
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["uninstall", "--key", "--client", "cursor"])).toBe(0);
    expect(existsSync(savedKeyPath(t.io.env))).toBe(false);
    expect(readFileSync(m.desktop, "utf8")).toBe(m.before);
    expect(m.calls).toEqual([]);
    expect(t.all()).toContain("Saved key deleted");
    const again = io();
    again.io.setup = m.setup;
    expect(await runCommand(again.io, ["uninstall", "--key"])).toBe(0);
    expect(again.all()).toContain("No saved key at");
    expect(await runCommand(again.io, ["uninstall", "extra"])).toBe(2);
    expect(await runCommand(again.io, ["uninstall", "--force"])).toBe(2);
  });

  test("distinguishes a removal failure from an absent registration", async () => {
    const m = installed();
    const t = io();
    let message = "Permission denied";
    t.io.setup = { ...m.setup, exec: async (_cmd, args) => args[0] === "--version"
      ? { code: 0, stdout: "", stderr: "" }
      : { code: 1, stdout: "", stderr: message } };
    expect(await runCommand(t.io, ["uninstall", "--client", "claude-code"])).toBe(1);
    expect(t.all()).toContain("Permission denied");
    message = 'No MCP server named "cloud-alm" in user scope';
    expect(await runCommand(t.io, ["uninstall", "--client", "claude-code"])).toBe(0);
  });

  test("a config that is not JSON is left alone and reported", async () => {
    const m = installed();
    writeFileSync(m.cursor, "{ not json");
    const t = io();
    t.io.setup = m.setup;
    expect(await runCommand(t.io, ["uninstall"])).toBe(1);
    expect(t.all()).toContain("✗ Cursor");
    expect(readFileSync(m.cursor, "utf8")).toBe("{ not json");
  });
});
