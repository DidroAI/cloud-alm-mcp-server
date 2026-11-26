/**
 * Publish the same bundled workflow through native skill discovery and
 * through prompts for clients that offer slash commands.
 */
import { readdirSync, readFileSync } from "node:fs";
import { skillEntry, SkillsExtension } from "@modelcontextprotocol/server/ext/skills";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";

type Skill = { name: string; title: string; description: string; body: string; text: string };

const SKILLS_DIR = new URL("../skills/", import.meta.url);

/** Read `skills/<name>/SKILL.md` files; none when the folder is missing. */
function loadSkills(dir: URL = SKILLS_DIR): Skill[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const name of names) {
    let text: string;
    try {
      text = readFileSync(new URL(`${name}/SKILL.md`, dir), "utf8");
    } catch {
      continue;
    }
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(front?.[1] ?? "")?.[1]?.trim();
    const description = field("description");
    if (!front || !description) continue;
    const body = text.slice(front[0].length).trim();
    const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? name;
    skills.push({ name: field("name") ?? name, title, description, body, text });
  }
  return skills;
}

// The public server factory is synchronous. Build and share the SDK manifests on
// the first discovery request, including a digest over each exact shipped file.
function bundledWorkflows() {
  const skills = loadSkills();
  const baseUri = "skill://cloud-alm/";
  const files = new Map(skills.map(skill => [`${baseUri}${skill.name}/SKILL.md`, skill.text]));
  const buildManifests = () => Promise.all(skills.map(skill =>
    skillEntry(skill.name, { "SKILL.md": skill.text }, { baseUri })));
  let manifests: ReturnType<typeof buildManifests> | undefined;
  const entries = () => manifests ??= buildManifests();
  const extension = new SkillsExtension({
    baseUri,
    source: {
      list: async () => ({ skills: await entries() }),
      get: async uri => (await entries()).find(entry => entry.uri === uri),
      read: async uri => {
        const text = files.get(uri);
        return text === undefined ? undefined : { text, mimeType: "text/markdown" };
      },
    },
  });
  return { skills, extension };
}

let cached: ReturnType<typeof bundledWorkflows> | undefined;

export function registerSkills(server: McpServer) {
  const { skills, extension } = cached ??= bundledWorkflows();
  extension.attach(server);
  for (const skill of skills)
    server.registerPrompt(
      skill.name,
      {
        title: skill.title,
        // The first sentence: what it does. The rest says when to use it.
        description: skill.description.split(/(?<=\.)\s/)[0] ?? skill.description,
        argsSchema: z.object({
          request: z.string().max(2000).optional().describe("What you want, in your words (process, date, audience…)"),
        }) as never,
      },
      ((args: { request?: string }) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `${skill.body}\n\n---\n\nFollow the workflow above with the cloud-alm tools.${args.request ? ` My request: ${args.request}` : " Ask me what is missing before you start."}`,
            },
          },
        ],
      })) as never,
    );
}
