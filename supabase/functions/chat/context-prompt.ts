import type { Ctx } from "./validation.ts";

export const SYSTEM_PROMPT =
  "You are Solo AI, a helpful, precise assistant inside the Solo AI workspace. Answer directly and concisely. Use Markdown. If unsure, say so. Never invent citations, URLs, or file contents. Reply in the user's language.";
/** Preferred reply language chosen in Settings; ignored unless it is a plain language name. */
export function languagePrompt(name: unknown): string {
  if (typeof name !== "string" || !/^[A-Za-z][A-Za-z ()-]{1,29}$/.test(name)) return "";
  return ` The user's preferred language is ${name}: reply in ${name} unless they clearly write in, or ask for, another language.`;
}
export function contextPrompt(c: Ctx | null) {
  if (!c) return "";
  const p: string[] = [];
  if (c.project) p.push(`Project: ${c.project.name}${c.project.instructions ? `\n${c.project.instructions}` : ""}`);
  if (c.memories?.length) {
    p.push(`Remembered context:\n${c.memories.map((m) => `- [${m.type}] ${m.content}`).join("\n")}`);
  }
  if (c.knowledge?.length) {
    p.push(
      `File excerpts:\n${
        c.knowledge.map((k) => `<<< ${k.file_name} · excerpt ${k.chunk_index + 1} >>>\n${k.content}\n<<< end >>>`).join(
          "\n\n",
        )
      }`,
    );
  }
  return p.length ? `\n\n### Context\n${p.join("\n\n")}` : "";
}
