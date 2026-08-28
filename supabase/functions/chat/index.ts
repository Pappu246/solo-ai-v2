import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const origins = (Deno.env.get("APP_ORIGIN") || "").split(",").map(v => v.trim()).filter(Boolean);
const cors = (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const allow = origins.length ? (origins.includes(origin) ? origin : origins[0]) : (origin || "*");
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Access-Control-Expose-Headers": "X-Model-Used, X-Model-Name, X-Route-Category",
  };
};

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
let publishableKey = "";
try { publishableKey = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || ""; } catch {}
publishableKey ||= Deno.env.get("SUPABASE_ANON_KEY") || "";
const authClient = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } })
  : null;

async function requireUser(req: Request) {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ") || !authClient) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const { data, error } = await authClient.auth.getUser(header.slice(7));
  if (error || !data.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return data.user;
}

const buckets = new Map<string, { at: number; count: number }>();
function rateLimit(userId: string) {
  const now = Date.now(); const b = buckets.get(userId);
  if (!b || now - b.at >= 60_000) { buckets.set(userId, { at: now, count: 1 }); return; }
  if (b.count >= 30) throw Object.assign(new Error("Rate limit exceeded. Please wait a minute."), { status: 429 });
  b.count++;
}

class ProviderError extends Error {
  constructor(public provider: string, public status: number, detail: string) {
    super(`${provider} error: ${status}${detail ? ` ${detail.slice(0, 300)}` : ""}`);
  }
  get retryable() { return this.status === 408 || this.status === 409 || this.status === 429 || this.status >= 500; }
}

const models = [
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", category: "conversation", speed: 4, quality: 5, cost: 4, free: false, context_length: 128000, supports_vision: true, supports_tools: true, tag: "Vision" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", category: "fast", speed: 5, quality: 4, cost: 2, free: false, context_length: 128000, supports_vision: true, supports_tools: true },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic", category: "coding", speed: 4, quality: 5, cost: 4, free: false, context_length: 1000000, supports_vision: true, supports_tools: true, tag: "Top" },
  { id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic", category: "reasoning", speed: 3, quality: 5, cost: 5, free: false, context_length: 1000000, supports_vision: true, supports_tools: true },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic", category: "fast", speed: 5, quality: 4, cost: 2, free: false, context_length: 200000, supports_vision: true, supports_tools: true },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "google", category: "research", speed: 5, quality: 5, cost: 2, free: false, context_length: 1048576, supports_vision: true, supports_tools: true, tag: "Latest" },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", provider: "google", category: "reasoning", speed: 4, quality: 5, cost: 4, free: false, context_length: 1048576, supports_vision: true, supports_tools: true, tag: "Pro" },
  { id: "llama-3.3-70b", name: "Llama 3.3 70B", provider: "groq", category: "conversation", speed: 5, quality: 4, cost: 1, free: false, context_length: 131072, supports_vision: false, supports_tools: true },
  { id: "llama-3.1-8b", name: "Llama 3.1 8B", provider: "groq", category: "fast", speed: 5, quality: 3, cost: 1, free: false, context_length: 131072, supports_vision: false, supports_tools: true, tag: "Fast" },
  { id: "gpt-oss-20b", name: "GPT OSS 20B", provider: "groq", category: "fast", speed: 5, quality: 4, cost: 1, free: false, context_length: 131072, supports_vision: false, supports_tools: true },
  { id: "gpt-oss-120b", name: "GPT OSS 120B", provider: "groq", category: "reasoning", speed: 5, quality: 5, cost: 2, free: false, context_length: 131072, supports_vision: false, supports_tools: true, tag: "Best" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek", category: "reasoning", speed: 4, quality: 5, cost: 2, free: false, context_length: 1000000, supports_vision: false, supports_tools: true, tag: "Latest" },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek", category: "fast", speed: 5, quality: 4, cost: 1, free: false, context_length: 1000000, supports_vision: false, supports_tools: true, tag: "Fast" },
] as const;

type Model = typeof models[number];
type Message = { role: "user" | "assistant" | "system"; content: string | Array<Record<string, unknown>> };
type Image = { base64: string; mime_type: string };

const keyFor: Record<string, string> = {
  openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GOOGLE_API_KEY", groq: "GROQ_API_KEY", deepseek: "DEEPSEEK_API_KEY",
};
const key = (provider: string) => { const name = keyFor[provider]; return name ? Deno.env.get(name) || "" : ""; };
const signal = () => AbortSignal.timeout(90_000);

function category(text: string) {
  const t = text.toLowerCase();
  const scores = {
    coding: ["code","debug","typescript","javascript","python","react","sql","api","algorithm"],
    reasoning: ["explain","analyze","logic","math","calculate","proof","solve","strategy","compare"],
    research: ["research","latest","news","search","find","history","facts","report","study","paper"],
    fast: ["quick","brief","short","simple","translate","summarize"],
  } as const;
  const ranked = Object.entries(scores).map(([name, words]) => [name, words.reduce((n, w) => n + (t.includes(w) ? w.length : 0), 0)] as const).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : "conversation";
}

function providerMessages(messages: Message[], provider: string, images: Image[]): Message[] {
  if (!images.length) return messages;
  const lastUser = [...messages].map(m => m.role).lastIndexOf("user");
  return messages.map((m, i) => {
    if (i !== lastUser || typeof m.content !== "string") return m;
    if (provider === "openai") return { ...m, content: [{ type: "text", text: m.content }, ...images.map(x => ({ type: "image_url", image_url: { url: `data:${x.mime_type};base64,${x.base64}` } }))] };
    if (provider === "anthropic") return { ...m, content: [...images.map(x => ({ type: "image", source: { type: "base64", media_type: x.mime_type, data: x.base64 } })), { type: "text", text: m.content }] };
    if (provider === "google") return { ...m, content: [{ text: m.content }, ...images.map(x => ({ inlineData: { mimeType: x.mime_type, data: x.base64 } }))] };
    return m;
  });
}

async function streamFetch(url: string, init: RequestInit, provider: string) {
  const response = await fetch(url, { ...init, signal: signal() });
  if (!response.ok) throw new ProviderError(provider, response.status, await response.text());
  if (!response.body) throw new ProviderError(provider, 502, "Provider returned no response body");
  return response.body;
}

async function openAI(messages: Message[], model: string, apiKey: string) {
  return streamFetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages, stream: true, max_tokens: 4096 }) }, "OpenAI");
}

async function anthropic(messages: Message[], model: string, apiKey: string) {
  const system = messages.filter(m => m.role === "system").map(m => String(m.content)).join("\n") || "You are a helpful AI assistant.";
  const body = { model, system, messages: messages.filter(m => m.role !== "system"), max_tokens: 4096, stream: true };
  const bodyStream = await streamFetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) }, "Anthropic");
  return adaptSSE(bodyStream, data => data.type === "content_block_delta" ? data.delta?.text : null);
}

async function google(messages: Message[], model: string, apiKey: string) {
  const contents = messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: Array.isArray(m.content) ? m.content : [{ text: m.content }] }));
  const endpoint = model === "gemini-3.1-pro" ? "gemini-3.1-pro-preview" : "gemini-3.7-flash";
  const bodyStream = await streamFetch(`https://generativelanguage.googleapis.com/v1beta/models/${endpoint}:streamGenerateContent?alt=sse&key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 4096 } }) }, "Google");
  return adaptSSE(bodyStream, data => data.candidates?.[0]?.content?.parts?.[0]?.text || null);
}

async function groq(messages: Message[], model: string, apiKey: string) {
  const ids: Record<string, string> = { "llama-3.3-70b": "llama-3.3-70b-versatile", "llama-3.1-8b": "llama-3.1-8b-instant", "gpt-oss-20b": "openai/gpt-oss-20b", "gpt-oss-120b": "openai/gpt-oss-120b" };
  return streamFetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: ids[model] || model, messages, stream: true, max_tokens: 4096 }) }, "Groq");
}

async function deepseek(messages: Message[], model: string, apiKey: string) {
  return streamFetch("https://api.deepseek.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages, stream: true, max_tokens: 4096 }) }, "DeepSeek");
}

async function adaptSSE(stream: ReadableStream<Uint8Array>, extract: (data: any) => string | null) {
  const reader = stream.getReader(); const decoder = new TextDecoder(); const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({ async start(controller) {
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim(); if (!raw || raw === "[DONE]") continue;
          try { const data = JSON.parse(raw); const text = extract(data); if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)); } catch {}
        }
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    } finally { controller.close(); }
  }});
}

async function callModel(model: Model, messages: Message[], images: Image[]) {
  if (images.length && !model.supports_vision) throw new ProviderError(model.provider, 400, "Selected model does not support image input.");
  const apiKey = key(model.provider); if (!apiKey) throw new ProviderError(model.provider, 503, "Provider is not configured");
  const payload = providerMessages(messages, model.provider, images);
  if (model.provider === "openai") return openAI(payload, model.id, apiKey);
  if (model.provider === "anthropic") return anthropic(payload, model.id, apiKey);
  if (model.provider === "google") return google(payload, model.id, apiKey);
  if (model.provider === "groq") return groq(payload, model.id, apiKey);
  if (model.provider === "deepseek") return deepseek(payload, model.id, apiKey);
  throw new ProviderError(model.provider, 400, "Unsupported provider");
}

function fallbacks(primary: string, hasImages: boolean) {
  const ids = hasImages ? ["gemini-3.7-flash", "gpt-4o"] : ["gpt-oss-120b", "gemini-3.7-flash", "deepseek-v4-flash"];
  return [primary, ...ids].filter((id, i, all) => all.indexOf(id) === i).map(id => models.find(m => m.id === id)).filter(Boolean) as Model[];
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  try {
    const user = await requireUser(req);
    if (req.method === "GET") return json(req, { models });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    rateLimit(user.id);

    const body = await req.json();
    const rawMessages = body?.messages;
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) return json(req, { error: "At least one message is required" }, 400);
    if (rawMessages.length > 50) return json(req, { error: "Conversation is too long" }, 413);

    const messages: Message[] = rawMessages.map((m: unknown) => {
      if (!m || typeof m !== "object") throw Object.assign(new Error("Invalid message"), { status: 400 });
      const x = m as { role?: unknown; content?: unknown };
      if (!["user", "assistant", "system"].includes(String(x.role))) throw Object.assign(new Error("Invalid message role"), { status: 400 });
      if (x.role === "system") throw Object.assign(new Error("System messages are server-controlled"), { status: 400 });
      const content = String(x.content ?? "");
      if (content.length > 16000) throw Object.assign(new Error("Message exceeds 16,000 characters"), { status: 413 });
      return { role: x.role as Message["role"], content };
    });
    const total = messages.reduce((n, m) => n + String(m.content).length, 0);
    if (total > 120000) return json(req, { error: "Conversation context is too large" }, 413);

    const images: Image[] = Array.isArray(body?.images) ? body.images.slice(0, 4).map((x: any) => {
      const mime_type = String(x?.mime_type || "image/jpeg"); const base64 = String(x?.base64 || "");
      if (!/^image\/(png|jpeg|webp|gif)$/.test(mime_type)) throw Object.assign(new Error("Unsupported image type"), { status: 400 });
      if (!base64 || base64.length > 12_000_000) throw Object.assign(new Error("Invalid or oversized image"), { status: 413 });
      return { mime_type, base64 };
    }) : [];

    const requested = typeof body?.model === "string" && body.model ? body.model : "";
    const autoRoute = body?.autoRoute !== false;
    let route = "conversation";
    let selected = requested;
    if (!selected && autoRoute) {
      route = images.length ? "vision" : category(String(messages[messages.length - 1].content));
      const byRoute: Record<string, string> = { coding: "claude-sonnet-5", reasoning: "deepseek-v4-pro", research: "gemini-3.7-flash", fast: "gpt-oss-20b", conversation: "gpt-oss-120b", vision: "gemini-3.7-flash" };
      selected = byRoute[route] || byRoute.conversation;
    }
    selected ||= "gpt-oss-120b";
    const model = models.find(m => m.id === selected);
    if (!model) return json(req, { error: `Unsupported model: ${selected}` }, 400);
    if (images.length && !model.supports_vision) return json(req, { error: "Selected model does not support images. Turn on Auto Route or choose a vision model." }, 400);

    let stream: ReadableStream<Uint8Array> | null = null; let used = model; let lastError = "";
    for (const candidate of fallbacks(model.id, images.length > 0)) {
      try { stream = await callModel(candidate, messages, images); used = candidate; break; }
      catch (e) { lastError = (e as Error).message; if (!(e instanceof ProviderError) || !e.retryable) break; }
    }
    if (!stream) return json(req, { error: `All configured models failed. ${lastError}` }, 502);

    return new Response(stream, { headers: { ...cors(req), "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "X-Model-Used": used.id, "X-Model-Name": used.name, "X-Route-Category": route } });
  } catch (e) {
    const status = Number((e as { status?: number }).status) || 500;
    return json(req, { error: (e as Error).message || "Internal server error" }, status);
  }
});
