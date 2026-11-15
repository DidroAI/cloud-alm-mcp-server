/**
 * The skills of `skills/` as MCP prompts, so hosts without skill support
 * still offer the workflows (fit-gap, workshop prep, status report…). A
 * prompt is the skill's text plus the user's request.
 */
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";

export type Skill = { name: string; title: string; description: string; body: string };

const SKILLS_DIR = new URL("../skills/", import.meta.url);

/** Read `skills/<name>/SKILL.md` files; none when the folder is missing. */
export function loadSkills(dir: URL = SKILLS_DIR): Skill[] {
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
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(front?.[1] ?? "")?.[1]?.trim();
    const description = field("description");
    if (!front || !description) continue;
    const body = text.slice(front[0].length).trim();
    const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? name;
    skills.push({ name: field("name") ?? name, title, description, body });
  }
  return skills;
}

let cached: Skill[] | undefined;

export function registerSkillPrompts(server: McpServer, skills: Skill[] = (cached ??= loadSkills())) {
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
