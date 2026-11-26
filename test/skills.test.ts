/**
 * The skills are instructions an assistant follows to the letter: a tool,
 * a parameter or a value the server does not have sends it into a refusal.
 * These checks read the shipped skills against the server's own lists.
 */
import { describe, expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CloudAlm } from "../src/calm/index.js";
import { CloudAlmWriter } from "../src/calm/writer.js";
import { createServer, TOOL_NAMES, WRITE_TOOL_NAMES } from "../src/server.js";
import { DOCUMENT_TYPE_HELP } from "../src/views/edit.js";
import { FIND_TYPES, GAP_CHECKS } from "../src/views/tools.js";
import { BASE_URL, fakeWritableTenant } from "./tenant.js";

const root = new URL("../skills/", import.meta.url).pathname;
const skills = readdirSync(root).map((name) => ({ name, text: readFileSync(join(root, name, "SKILL.md"), "utf8") }));
const each = (pattern: RegExp, use: (skill: string, match: RegExpExecArray) => void) => {
  for (const { name, text } of skills) for (const m of text.matchAll(pattern)) use(name, m as RegExpExecArray);
};
const quoted = (list: string) => [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);

describe("the skills name only what the server has", () => {
  test("bundled skills, each with a name that is its folder and a description an app accepts", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const listed = [...readme.matchAll(/^\| `(cloud-alm-[a-z-]+)` \|/gm)].map(match => match[1]!);
    expect(skills.map(skill => skill.name).sort()).toEqual(listed.sort());
    expect(listed).toContain("cloud-alm-retest");
    for (const { name, text } of skills) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
      expect(/^name: (.+)$/m.exec(front)?.[1]).toBe(name);
      const description = /^description: ([\s\S]+)$/m.exec(front)?.[1] ?? "";
      expect(description.length).toBeGreaterThan(50);
      expect(description.length).toBeLessThanOrEqual(1024);
    }
  });

  test("tools", () => {
    const tools = new Set<string>([...TOOL_NAMES, ...WRITE_TOOL_NAMES]);
    each(/\bcalm_[a-z_]+\b/g, (skill, m) => expect(`${skill}: ${tools.has(m[0]) ? "known tool" : m[0]}`).toBe(`${skill}: known tool`));
  });

  test("parameters written as `name: value`", async () => {
    const fake = fakeWritableTenant();
    const grant = { accessToken: "t", baseUrl: BASE_URL };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(new CloudAlm(grant, { fetch: fake.fetcher }), { writer: new CloudAlmWriter(grant, { fetch: fake.fetcher }), writeMode: "on" }).connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    const known = new Set<string>();
    // Nested ones too: a test step's `evidence`, for one.
    const collect = (schema: unknown) => {
      if (!schema || typeof schema !== "object") return;
      for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
        if (key === "properties" && value && typeof value === "object") for (const name of Object.keys(value)) known.add(name);
        collect(value);
      }
    };
    for (const tool of (await client.listTools()).tools) collect(tool.inputSchema);
    each(/`([a-zA-Z]+): [^`]*`/g, (skill, m) => expect(`${skill}: ${known.has(m[1] as string) ? "known parameter" : m[1]}`).toBe(`${skill}: known parameter`));
  });

  test("gap checks and item types", () => {
    each(/checks: \[([^\]]*)\]/g, (skill, m) => {
      for (const check of quoted(m[1] ?? "")) expect(`${skill}: ${(GAP_CHECKS as readonly string[]).includes(check) ? "known check" : check}`).toBe(`${skill}: known check`);
    });
    each(/types: \[([^\]]*)\]/g, (skill, m) => {
      for (const type of quoted(m[1] ?? "")) expect(`${skill}: ${(FIND_TYPES as readonly string[]).includes(type) ? "known type" : type}`).toBe(`${skill}: known type`);
    });
  });

  test("a coverage check for a decision counts closed requirements too", () => {
    for (const { name, text } of skills)
      if (/checks: \["coverage"\]/.test(text)) expect(`${name}: ${text.includes("includeClosed: true")}`).toBe(`${name}: true`);
  });

  test("document types are Cloud ALM's, and feature statuses the words the tools print", () => {
    each(/type:? "([^"]+)"/g, (skill, m) => {
      const value = m[1] as string;
      // Task types are checked with the parameters above; a capitalised value is a document type.
      if (/^[A-Z]/.test(value)) expect(`${skill}: ${DOCUMENT_TYPE_HELP.includes(value) ? "known document type" : value}`).toBe(`${skill}: known document type`);
    });
    for (const { name, text } of skills) {
      expect(`${name}: ${/status: "(successfully tested|ready for production)"/.test(text)}`).toBe(`${name}: false`);
      expect(`${name}: ${/defect[^.\n]{0,80}status: "not relevant"/i.test(text)}`).toBe(`${name}: false`);
    }
  });
});
