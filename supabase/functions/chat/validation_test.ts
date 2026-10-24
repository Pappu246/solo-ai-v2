import { contextPrompt, SYSTEM_PROMPT } from "./context-prompt.ts";
import { parseContext, parseImages, parseMessages } from "./validation.ts";

function eq(a: unknown, b: unknown, m = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}
function rejects(fn: () => unknown, status: number, code: string) {
  try {
    fn();
  } catch (e) {
    const err = e as { status?: number; code?: string };
    eq([err.status, err.code], [status, code]);
    return;
  }
  throw new Error("expected a rejection");
}

Deno.test("parseMessages: accepts user/assistant turns and rejects bad input with status and code", () => {
  eq(parseMessages([{ role: "user", content: "hi" }, { role: "assistant", content: 5 }]), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "5" },
  ]);
  rejects(() => parseMessages([]), 400, "invalid_request");
  rejects(() => parseMessages("x"), 400, "invalid_request");
  rejects(() => parseMessages([null]), 400, "invalid_request");
  rejects(() => parseMessages([{ role: "system", content: "x" }]), 400, "invalid_request");
  rejects(() => parseMessages([{ role: "user", content: "x".repeat(64001) }]), 413, "context_length_exceeded");
  rejects(() => parseMessages(Array(501).fill({ role: "user", content: "x" })), 413, "context_length_exceeded");
  const big = Array(17).fill({ role: "user", content: "x".repeat(63000) }); // 1.07M characters
  rejects(() => parseMessages(big), 413, "context_length_exceeded");
});

Deno.test("parseImages: caps at four, defaults the mime type, rejects unsupported or empty images", () => {
  eq(parseImages(undefined), []);
  eq(parseImages([{ base64: "AAAA" }]), [{ mime_type: "image/jpeg", base64: "AAAA" }]);
  eq(parseImages(Array(6).fill({ mime_type: "image/png", base64: "AAAA" })).length, 4);
  rejects(() => parseImages([{ mime_type: "image/svg+xml", base64: "AAAA" }]), 413, "context_length_exceeded");
  rejects(() => parseImages([{ mime_type: "image/png", base64: "" }]), 413, "context_length_exceeded");
  rejects(() => parseImages([{ mime_type: "image/png", base64: "A".repeat(12000001) }]), 413, "context_length_exceeded");
});

Deno.test("parseContext: validates, trims and bounds the context", () => {
  eq(parseContext(null), null);
  eq(parseContext({}), null);
  eq(parseContext({ project: { name: " P ", instructions: "  " } }), { project: { name: "P" } });
  eq(parseContext({ memories: [{ type: "fact", content: " likes tea " }] }), {
    memories: [{ type: "fact", content: "likes tea" }],
  });
  rejects(() => parseContext([]), 400, "invalid_request");
  rejects(() => parseContext({ project: { name: "" } }), 400, "invalid_request");
  rejects(() => parseContext({ memories: [{ type: "weird", content: "x" }] }), 400, "invalid_request");
  rejects(() => parseContext({ memories: Array(13).fill({ type: "fact", content: "x" }) }), 400, "invalid_request");
  rejects(() => parseContext({ knowledge: [{ file_id: "", content: "x" }] }), 400, "invalid_request");
  const huge = Array(4).fill({ file_id: "f", content: "x".repeat(8000) }); // 32k > 24k total
  rejects(() => parseContext({ knowledge: huge }), 413, "context_length_exceeded");
});

Deno.test("contextPrompt: empty context adds nothing, full context lists project, memories and excerpts", () => {
  eq(contextPrompt(null), "");
  const text = contextPrompt({
    project: { name: "Atlas", instructions: "Be brief." },
    memories: [{ type: "preference", content: "Hindi replies" }],
    knowledge: [{ file_id: "f", file_name: "notes.md", chunk_index: 0, content: "hello" }],
  });
  for (const part of ["Project: Atlas", "Be brief.", "[preference] Hindi replies", "notes.md · excerpt 1", "hello"]) {
    if (!text.includes(part)) throw new Error(`missing ${part}`);
  }
  if (!SYSTEM_PROMPT.startsWith("You are Solo AI")) throw new Error("system prompt changed");
});
