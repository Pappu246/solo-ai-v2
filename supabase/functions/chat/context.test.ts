import { buildModelContext } from "./context.ts";
import type { ModelSpec, Message } from "./providers.ts";

const gemini: ModelSpec = { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "google", category: "research", speed: 5, quality: 5, cost: 2, free: false, context_length: 1_048_576, supports_vision: true, supports_tools: true };
const oss: ModelSpec = { id: "gpt-oss-120b", name: "GPT OSS 120B", provider: "groq", category: "conversation", speed: 5, quality: 5, cost: 2, free: false, context_length: 131_072, supports_vision: false, supports_tools: true };
const make = (n: number): Message[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn-${i + 1} ${"context ".repeat(400)}` } as Message));

Deno.test("10-message conversation remains intact", () => {
  const source = make(10), result = buildModelContext(source, oss);
  if (result.compacted) throw new Error("unexpected compaction");
  if (result.messages.length !== source.length) throw new Error("messages changed");
});

Deno.test("50-message conversation can be compacted without a hard message-count failure", () => {
  const source = make(50), result = buildModelContext(source, oss);
  if (!result.compacted) throw new Error("expected compaction");
  if (result.messages.slice(-12).map(m => m.content).join("\n") !== source.slice(-12).map(m => m.content).join("\n")) throw new Error("recent turns changed");
});

Deno.test(">50 messages retain recent turns", () => {
  const source = make(80), result = buildModelContext(source, oss);
  if (!result.compacted || result.droppedTurns <= 0) throw new Error("expected compacted context");
  for (const m of source.slice(-12)) if (!result.messages.some(x => x.content === m.content)) throw new Error("recent turn missing");
});

Deno.test("both model context budgets are model-dependent", () => {
  const source = make(120);
  const g = buildModelContext(source, gemini), o = buildModelContext(source, oss);
  if (g.contextChars > 180_000 || o.contextChars > 180_000) throw new Error("unsafe context");
});
