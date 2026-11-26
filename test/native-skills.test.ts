import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { createHttpHandler } from "../src/http.js";
import { BASE_URL } from "./tenant.js";

const root = new URL("../skills/", import.meta.url);

async function connect(modern: boolean, workflows = true) {
  const handler = createHttpHandler({ baseUrl: BASE_URL, server: { prompts: workflows } });
  const client = new Client(
    { name: "native-skills-test", version: "1" },
    modern ? { versionNegotiation: { mode: "auto" } } : {},
  );
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: (url, init) => handler(new Request(url, init)),
    requestInit: { headers: { authorization: "Bearer fixture" } },
  }));
  return client;
}

for (const [modern, version] of [[false, "2025-11-25"], [true, "2026-07-28"]] as const) {
  test(`bundled skills and prompts over ${version}`, async () => {
    const client = await connect(modern);
    try {
      expect(client.getNegotiatedProtocolVersion()).toBe(version);
      const extension = new SkillsClient(client);
      expect(extension.supported).toBe(true);
      const { skills } = await extension.list();
      const expected = readdirSync(root).sort();
      expect(skills.map(skill => skill.frontmatter.name).sort()).toEqual(expected);
      expect((await client.listPrompts()).prompts.map(prompt => prompt.name).sort()).toEqual(expected);
      for (const { uri } of skills) {
        const { skill } = await extension.get(uri);
        const file = await extension.read(skill);
        expect(file.verified).toBe(true);
        expect(file.text).toBe(readFileSync(new URL(`${skill.frontmatter.name}/SKILL.md`, root), "utf8"));
      }
    } finally {
      await client.close();
    }
  });
}

test("embedding with workflows disabled omits skills and prompts", async () => {
  const client = await connect(true, false);
  try {
    expect(new SkillsClient(client).supported).toBe(false);
    expect(client.getServerCapabilities()?.prompts).toBeUndefined();
  } finally {
    await client.close();
  }
});
