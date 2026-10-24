import type { Image, Message } from "./providers.ts";

export type Ctx = {
  project?: { name: string; instructions?: string };
  memories?: Array<{ type: string; content: string }>;
  knowledge?: Array<{ file_id: string; file_name: string; chunk_index: number; content: string }>;
};
const TYPES = new Set(["fact", "preference", "instruction", "context"]);
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\0/g, "").slice(0, n);
export function parseContext(raw: unknown): Ctx | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw Object.assign(new Error("Invalid context"), { status: 400, code: "invalid_request" });
  }
  const r = raw as Record<string, unknown>, o: Ctx = {};
  let total = 0;
  if (r.project !== undefined) {
    const p = r.project as Record<string, unknown>,
      name = clip(p.name, 120).trim(),
      instructions = clip(p.instructions, 4000).trim();
    if (!name) throw Object.assign(new Error("Invalid project context"), { status: 400, code: "invalid_request" });
    o.project = instructions ? { name, instructions } : { name };
    total += name.length + instructions.length;
  }
  if (r.memories !== undefined) {
    if (!Array.isArray(r.memories) || r.memories.length > 12) {
      throw Object.assign(new Error("Too many memories"), { status: 400, code: "invalid_request" });
    }
    o.memories = r.memories.map((m: unknown) => {
      const x = (m && typeof m === "object" ? m : {}) as Record<string, unknown>,
        type = String(x.type ?? "fact"),
        content = clip(x.content, 1000).trim();
      if (!TYPES.has(type) || !content) {
        throw Object.assign(new Error("Invalid memory"), { status: 400, code: "invalid_request" });
      }
      total += content.length;
      return { type, content };
    });
  }
  if (r.knowledge !== undefined) {
    if (!Array.isArray(r.knowledge) || r.knowledge.length > 8) {
      throw Object.assign(new Error("Too many knowledge excerpts"), { status: 400, code: "invalid_request" });
    }
    o.knowledge = r.knowledge.map((k: unknown) => {
      const x = (k && typeof k === "object" ? k : {}) as Record<string, unknown>,
        file_id = clip(x.file_id, 64),
        file_name = clip(x.file_name, 255).trim() || "file",
        chunk_index = Number.isInteger(x.chunk_index) ? Number(x.chunk_index) : 0,
        content = clip(x.content, 8000).trim();
      if (!file_id || !content) {
        throw Object.assign(new Error("Invalid knowledge excerpt"), { status: 400, code: "invalid_request" });
      }
      total += content.length;
      return { file_id, file_name, chunk_index, content };
    });
  }
  if (total > 24000) {
    throw Object.assign(new Error("Context is too large"), { status: 413, code: "context_length_exceeded" });
  }
  return o.project || o.memories?.length || o.knowledge?.length ? o : null;
}

function badRequest(message: string, status = 400, code = "invalid_request") {
  return Object.assign(new Error(message), { status, code });
}

/** Validate the `messages` array of a chat request. Throws errors carrying `status` and `code`. */
export function parseMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw) || !raw.length) throw badRequest("At least one message is required");
  if (raw.length > 500) throw badRequest("Conversation request is too large", 413, "context_length_exceeded");
  const messages: Message[] = raw.map((m: unknown) => {
    if (!m || typeof m !== "object") throw badRequest("Invalid message");
    const x = m as { role?: unknown; content?: unknown };
    if (!["user", "assistant"].includes(String(x.role))) throw badRequest("Invalid message role");
    const content = String(x.content ?? "");
    if (content.length > 64000) throw badRequest("Message is too large", 413, "context_length_exceeded");
    return { role: x.role as Message["role"], content };
  });
  const total = messages.reduce((n, m) => n + String(m.content).length, 0);
  if (total > 1000000) throw badRequest("Conversation request is too large", 413, "context_length_exceeded");
  return messages;
}

/** Validate up to four attached images. */
export function parseImages(raw: unknown): Image[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map((x: unknown) => {
    const i = (x && typeof x === "object" ? x : {}) as { mime_type?: unknown; base64?: unknown },
      mime_type = String(i.mime_type || "image/jpeg"),
      base64 = String(i.base64 || "");
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mime_type) || !base64 || base64.length > 12000000) {
      throw badRequest("Invalid image", 413, "context_length_exceeded");
    }
    return { mime_type, base64 };
  });
}
