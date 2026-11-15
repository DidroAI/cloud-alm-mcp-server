import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { packageSpec } from "../src/cli/clients.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(read(path));

const pkg = json("package.json");
const server = json("server.json");
const manifest = json("manifest.json");
const plugin = json(".claude-plugin/plugin.json");
const marketplace = json(".claude-plugin/marketplace.json");
const mcp = json(".mcp.json");

describe("distribution files", () => {
  test("every manifest carries the package's version", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
    expect(manifest.version).toBe(pkg.version);
    expect(plugin.version).toBe(pkg.version);
  });

  test("server.json names the npm package the registry can verify", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.name).toBe("io.github.DidroAI/cloud-alm-mcp-server");
    expect(server.description.length).toBeLessThanOrEqual(100);
    const [npm] = server.packages;
    expect(npm).toMatchObject({
      registryType: "npm",
      identifier: pkg.name,
      runtimeHint: "npx",
      transport: { type: "stdio" },
    });
    expect(npm.environmentVariables).toEqual([
      expect.objectContaining({ name: "CALM_SERVICE_KEY", format: "filepath", isSecret: true, isRequired: false }),
    ]);
  });

  test("the .mcpb manifest starts the CLI with the key file the user chose", () => {
    expect(manifest.server.type).toBe("node");
    expect(manifest.server.entry_point).toBe(pkg.bin["cloud-alm-mcp-server"]);
    expect(manifest.server.mcp_config.args).toEqual([`\${__dirname}/${manifest.server.entry_point}`]);
    expect(manifest.server.mcp_config.env).toEqual({ CALM_SERVICE_KEY: "${user_config.service_key_file}" });
    expect(manifest.user_config.service_key_file).toMatchObject({ type: "file", required: true });
    expect(manifest.compatibility.runtimes.node).toBe(`${pkg.engines.node}.0.0`);
    expect(manifest.privacy_policies).toEqual([
      "https://github.com/DidroAI/cloud-alm-mcp-server/blob/main/PRIVACY.md",
    ]);
  });

  test("the plugin asks for the key file and its server uses the answer", () => {
    expect(marketplace.name).toBe("didro");
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: plugin.name, source: "./" })]);
    expect(plugin.userConfig.service_key_file.type).toBe("file");
    const entry = mcp.mcpServers["cloud-alm"];
    expect(entry.env).toEqual({ CALM_SERVICE_KEY: "${user_config.service_key_file}" });
    expect(entry.args).toEqual(["-y", packageSpec(pkg.version)]);
  });

  test("the install links in docs/INSTALL-SNIPPETS.md decode to the npx configuration", () => {
    const docs = read("docs/INSTALL-SNIPPETS.md");
    const config = { command: "npx", args: ["-y", packageSpec(pkg.version)] };

    const cursor = [...docs.matchAll(/(?:cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install|https:\/\/cursor\.com\/install-mcp)\?name=cloud-alm&config=([\w%+/=-]+)/g)];
    expect(cursor.length).toBe(2);
    for (const [, encoded] of cursor)
      expect(JSON.parse(Buffer.from(decodeURIComponent(encoded as string), "base64").toString())).toEqual(config);

    const direct = [...docs.matchAll(/^vscode:mcp\/install\?(\S+)$/gm)];
    const wrapped = [...docs.matchAll(/https:\/\/vscode\.dev\/redirect\?url=([\w%.-]+)/g)];
    expect(direct.length).toBe(1);
    expect(wrapped.length).toBe(2);
    const inner = [
      ...direct.map(([, query]) => query as string),
      ...wrapped.map(([, url]) => {
        const link = decodeURIComponent(url as string);
        expect(link).toMatch(/^vscode(-insiders)?:mcp\/install\?/);
        return link.slice(link.indexOf("?") + 1);
      }),
    ];
    for (const query of inner)
      expect(JSON.parse(decodeURIComponent(query))).toEqual({ name: "cloud-alm", ...config });
  });
});
