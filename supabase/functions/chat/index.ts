import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  apiKeyFor,
  type Attempt,
  type FailureCode,
  fallbackChain,
  isAbortError,
  isAliasedModel,
  type ModelStream,
  ProviderError,
  publicModelAvailability,
  redactSecrets,
  resolveModel,
  selectAutoModel,
  statusForCode,
  streamWithFallback,
  userMessage,
} from "./providers.ts";
import { chatProviderHealth } from "./health.ts";
import { classifyRoute } from "./routing.ts";
import { createUsageController, limitsFromEnv, ProviderConcurrency, type UsageController } from "../shared/usage.ts";
import { FixedWindowRateLimiter } from "../shared/fixed_window_rate_limit.ts";
import { corsHeaders } from "../shared/cors.ts";
import { accessDeniedMessage, type QueryClient, resolveAccess, storeFromClient } from "../shared/access.ts";
import { buildModelContext } from "./context.ts";
import { contextPrompt, SYSTEM_PROMPT } from "./context-prompt.ts";
import { parseContext, parseImages, parseMessages } from "./validation.ts";
import { executeImageSearch } from "./image-search-exec.ts";
import { decideImageSearch } from "../image-search/decision.ts";
import { sseImageSearchEvent } from "../image-search/search-events.ts";
import {
  createWebSearchProvider,
  normalizeSources,
  shouldResearch,
  sourcesPromptBlock,
  type WebSearchSource,
} from "../web-search/providers.ts";
import { runAgentLoop } from "./agent.ts";
import { sseWebSearchEvent } from "../web-search/events.ts";
import { finishRequest, markFirstToken, startRequest, tagRequest } from "./metrics.ts";
const cors = (req: Request) =>
  corsHeaders(req, Deno.env.get("APP_ORIGIN"), {
    allowMethods: "GET, POST, OPTIONS",
    allowHeaders: "Content-Type, Authorization, X-Client-Info, Apikey",
    exposeHeaders: "X-Model-Used, X-Model-Name, X-Route-Category, X-Request-Id",
  });
const json = (req: Request, b: unknown, s = 200, id?: string) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors(req), "Content-Type": "application/json", ...(id ? { "X-Request-Id": id } : {}) },
  });
const fail = (req: Request, c: string | FailureCode, m: string, s: number, id: string) => {
  finishRequest(id, "error", { code: c, status: s }, (x) => log(id, "request_summary", x));
  return json(req, { error: m, code: c, request_id: id }, s, id);
};
function log(id: string, event: string, f: Record<string, unknown> = {}) {
  const x: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) x[k] = typeof v === "string" ? redactSecrets(v).slice(0, 500) : v;
  console.log(JSON.stringify({ at: new Date().toISOString(), fn: "chat", request_id: id, event, ...x }));
}
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
let publishableKey = "";
try {
  publishableKey = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || "";
} catch {
  publishableKey = "";
}
publishableKey ||= Deno.env.get("SUPABASE_ANON_KEY") || "";
const authClient = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } })
  : null;
async function requireUser(req: Request) {
  const h = req.headers.get("Authorization");
  if (!h?.startsWith("Bearer ") || !authClient) {
    throw Object.assign(new Error("Unauthorized"), { status: 401, code: "unauthorized" });
  }
  const { data, error } = await authClient.auth.getUser(h.slice(7));
  if (error || !data.user) throw Object.assign(new Error("Unauthorized"), { status: 401, code: "unauthorized" });
  return data.user;
}
const localRateLimit = new FixedWindowRateLimiter({ limit: 30, windowMs: 60_000, maxEntries: 20_000 });
function rateLimit(id: string) {
  if (!localRateLimit.allow(id)) {
    throw Object.assign(new Error("Rate limit exceeded"), { status: 429, code: "rate_limited" });
  }
}
// Approval gate (see shared/access.ts): only active when OWNER_EMAIL is set.
async function accessStatusFor(req: Request, user: Parameters<typeof resolveAccess>[0]) {
  const auth = req.headers.get("Authorization") || "";
  const client = supabaseUrl && publishableKey && auth
    ? createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    })
    : null;
  return await resolveAccess(user, (n) => Deno.env.get(n), storeFromClient(client as unknown as QueryClient | null));
}
const usageLimits = limitsFromEnv((n) => Deno.env.get(n));
const providerConcurrency = new ProviderConcurrency(8);
function usageForRequest(req: Request, id: string): UsageController {
  const auth = req.headers.get("Authorization") || "";
  const client = supabaseUrl && publishableKey && auth
    ? createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    })
    : null;
  return createUsageController(client, { limits: usageLimits, onEvent: (event, fields) => log(id, event, fields) });
}
Deno.serve(async (req) => {
  const id = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  try {
    const user = await requireUser(req);
    if (req.method === "GET") return json(req, { models: publicModelAvailability(chatProviderHealth) }, 200, id);
    if (req.method !== "POST") return fail(req, "method_not_allowed", "Method not allowed", 405, id);
    startRequest(id);
    rateLimit(user.id);
    const access = await accessStatusFor(req, user);
    if (access !== "approved") {
      return fail(
        req,
        access === "blocked" ? "access_blocked" : "access_pending",
        accessDeniedMessage(access),
        403,
        id,
      );
    }
    const usage = usageForRequest(req, id);
    const usageDecision = await usage.checkChat(user.id);
    if (!usageDecision.allowed) {
      return fail(
        req,
        usageDecision.reason === "minute" ? "rate_limited" : "usage_limit",
        usageDecision.reason === "minute"
          ? userMessage("rate_limited")
          : "You have reached your usage limit for now. Please try again later.",
        429,
        id,
      );
    }
    const body = await req.json().catch(() => {
      throw Object.assign(new Error("Invalid JSON body"), { status: 400, code: "invalid_request" });
    });
    const messages = parseMessages(body?.messages);
    const total = messages.reduce((n, m) => n + String(m.content).length, 0);
    const images = parseImages(body?.images);
    const ctx = parseContext(body?.context),
      requested = typeof body?.model === "string" ? body.model : "",
      auto = body?.autoRoute !== false;
    const estTokens = Math.ceil((total + contextPrompt(ctx).length) / 4);
    let route = "conversation", selected = requested;
    if (!selected && auto) {
      route = images.length ? "vision" : classifyRoute(String(messages.at(-1)?.content));
      const picked = selectAutoModel(route, {
        hasImages: Boolean(images.length),
        estimatedContextTokens: estTokens,
        health: chatProviderHealth,
        isProviderConfigured: (provider) => Boolean(apiKeyFor(provider)),
      });
      selected = picked.id;
      log(id, "auto_route", {
        route,
        selected,
        provider: picked.provider,
        providerHealthy: chatProviderHealth.isHealthy(picked.provider),
        estimatedContextTokens: estTokens,
      });
    }
    selected ||= "gpt-oss-120b";
    const model = resolveModel(selected);
    if (!model) return fail(req, "model_unavailable", "The selected model is unavailable", 400, id);
    if (isAliasedModel(selected)) log(id, "model_alias_applied", { requested: selected, resolved: model.id });
    tagRequest(id, { model: model.id, provider: model.provider, route });
    if (images.length && !model.supports_vision) {
      return fail(req, "images_unsupported", userMessage("images_unsupported"), 400, id);
    }
    const bounded = buildModelContext(
      [{ role: "system", content: SYSTEM_PROMPT + contextPrompt(ctx) }, ...messages],
      model,
    );
    log(id, "context_built", {
      sourceMessages: messages.length,
      sourceChars: total,
      contextMessages: bounded.messages.length,
      contextChars: bounded.contextChars,
      compacted: bounded.compacted,
      droppedTurns: bounded.droppedTurns,
      model: model.id,
    });
    // Phase 7: opt-in agent loop (bounded rounds/deadline, session-budgeted tools).
    // Never throws and never blocks the plain path: failures degrade to a normal answer.
    if (body?.agent === true) {
      try {
        const authHeader = req.headers.get("Authorization") || "";
        const toolClient = supabaseUrl && publishableKey && authHeader
          ? createClient(supabaseUrl, publishableKey, {
            auth: { persistSession: false },
            global: { headers: { Authorization: authHeader } },
          })
          : null;
        const data = toolClient
          ? {
            listConversations: async (limit: number) => {
              const { data: rows } = await toolClient.from("conversations").select("id, title, project_id").order(
                "updated_at",
                { ascending: false },
              ).limit(Math.min(Math.max(limit, 1), 50));
              return rows ?? [];
            },
            listMessages: async (conversationId: string, limit: number) => {
              const { data: rows } = await toolClient.from("messages").select("role, content").eq(
                "conversation_id",
                conversationId,
              ).order("created_at", { ascending: true }).limit(Math.min(Math.max(limit, 1), 50));
              return rows ?? [];
            },
            searchAll: async (query: string, limit: number) => {
              const { data: rows } = await toolClient.rpc("search_all", {
                p_query: query,
                p_limit: Math.min(Math.max(limit, 1), 20),
                p_offset: 0,
              });
              return (rows ?? []).map((r: { kind: string; title: string; snippet: string | null }) => ({
                kind: r.kind,
                title: r.title,
                snippet: r.snippet ?? "",
              }));
            },
          }
          : undefined;
        const agentResult = await runAgentLoop({
          model,
          messages: bounded.messages,
          ctx: {
            userId: user.id,
            requestId: id,
            env: (n) => Deno.env.get(n),
            fetchImpl: fetch,
            log: (event, fields) => log(id, event, fields),
            data,
          },
          env: (n) => Deno.env.get(n),
          fetchImpl: fetch,
          signal: req.signal,
          requested: true,
          log: (event, fields) => log(id, event, fields),
        });
        log(id, "agent_loop", {
          stop: agentResult.stop,
          rounds: agentResult.rounds,
          toolCalls: agentResult.records.length,
          okTools: agentResult.records.filter((r) => r.ok).length,
          durationMs: agentResult.durationMs,
        });
        if (agentResult.block) {
          const sys = bounded.messages[0];
          bounded.messages[0] = { ...sys, content: `${String(sys.content)}${agentResult.block}` };
        }
      } catch (e) {
        log(id, "agent_loop_failure", { error: e instanceof Error ? e.name : "unknown" });
      }
    }
    const attempts: Attempt[] = [];
    const last = messages.filter((m) => m.role === "user").at(-1);
    // The image-search decision (a small model call) and web research (a search
    // call) are independent, so they run side by side instead of one after the
    // other. Each task catches its own failures and logs them; neither can block
    // or break the answer. The first-token time is logged in request_summary.
    const decisionTask = async (): Promise<Awaited<ReturnType<typeof decideImageSearch>> | null> => {
      if (!last || images.length) return null;
      try {
        const result = await decideImageSearch(String(last.content), { env: (n) => Deno.env.get(n), fetchImpl: fetch });
        log(id, "image_search_decision", {
          shouldSearch: result.shouldSearch,
          queryCount: result.queries.length,
          queries: result.shouldSearch ? result.queries : [],
          confidence: result.confidence,
        });
        return result;
      } catch (e) {
        log(id, "image_search_decision_failure", { error: e instanceof Error ? e.name : "unknown" });
        return null;
      }
    };
    const researchRequested = body?.research === true;
    const research = researchRequested || (last ? shouldResearch(String(last.content)) : false);
    const researchTask = async (): Promise<WebSearchSource[]> => {
      if (!research || !last) return [];
      log(id, "research_start", { requested: researchRequested });
      try {
        const webProvider = createWebSearchProvider((n) => Deno.env.get(n), fetch);
        if (!webProvider) {
          log(id, "research_provider_unavailable");
          return [];
        }
        const raw = await Promise.race([
          webProvider.search(String(last.content).replace(/\s+/g, " ").slice(0, 300), 6),
          new Promise<WebSearchSource[]>((_, rej) => setTimeout(() => rej(new Error("timeout")), 7000)),
        ]);
        const sources = normalizeSources(raw, { max: 6, maxPerDomain: 2 });
        log(id, "research_results", { count: sources.length, domains: [...new Set(sources.map((s) => s.domain))] });
        return sources;
      } catch (e) {
        log(id, "research_failed", { error: e instanceof Error ? e.name : "unknown" });
        return [];
      }
    };
    const [decision, webSources] = await Promise.all([decisionTask(), researchTask()]);
    if (webSources.length) {
      const sys = bounded.messages[0];
      bounded.messages[0] = { ...sys, content: `${String(sys.content)}${sourcesPromptBlock(webSources)}` };
    }
    let stream: ModelStream;
    try {
      stream = (await streamWithFallback(
        fallbackChain(model, Boolean(images.length), {
          estimatedContextTokens: estTokens,
          health: chatProviderHealth,
          isProviderConfigured: (provider) => Boolean(apiKeyFor(provider)),
        }),
        bounded.messages,
        images,
        {
          signal: req.signal,
          health: chatProviderHealth,
          maxAttempts: 8,
          concurrency: providerConcurrency,
          onAttempt: (a: Attempt) => {
            attempts.push(a);
            tagRequest(id, { attempts: attempts.length });
            log(id, "provider_attempt_failed", { ...a });
          },
        },
      )).stream;
    } catch (e) {
      if (isAbortError(e)) {
        finishRequest(id, "aborted", {}, (x) => log(id, "request_summary", x));
        return new Response(null, { status: 499, headers: cors(req) });
      }
      const pe = e instanceof ProviderError
        ? e
        : new ProviderError({ provider: model.provider, code: "provider_error", detail: String(e) });
      log(id, "chat_failed", { code: pe.code, status: pe.status, attempts: attempts.length });
      return fail(req, pe.code, userMessage(pe.code), statusForCode(pe.code), id);
    }
    const used = stream.model, enc = new TextEncoder();
    let sentChars = 0;
    let streamError: string | null = null;
    const trackDelta = (t: string) => {
      const first = sentChars === 0;
      sentChars += t.length;
      if (first) markFirstToken(id);
      return enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
    };
    const trackDone = () => {
      if (sentChars) void usage.recordTokens(user.id, Math.ceil(sentChars / 4));
      return enc.encode("data: [DONE]\n\n");
    };
    async function* combined() {
      if (webSources.length) yield enc.encode(sseWebSearchEvent({ type: "results", sources: webSources }));
      else if (research) {
        yield enc.encode(sseWebSearchEvent({ type: "error", message: "Web research returned no sources right now." }));
      }
      if (decision?.shouldSearch) {
        yield enc.encode(sseImageSearchEvent({ type: "started", queries: decision.queries }));
        const p = executeImageSearch(decision.queries, id, log);
        for await (const e of stream.events) {
          if (e.type === "delta") yield trackDelta(e.text);
          else if (e.type === "done") {
            const r = await p;
            if (r.error) yield enc.encode(sseImageSearchEvent({ type: "error", message: r.error }));
            else if (r.images.length) yield enc.encode(sseImageSearchEvent({ type: "results", images: r.images }));
            log(id, "image_search_sse", { resultCount: r.images.length, error: Boolean(r.error) });
            yield trackDone();
            return;
          } else if (e.type === "error") {
            streamError = e.code;
            yield enc.encode(
              `event: error\ndata: ${JSON.stringify({ error: e.code, code: e.code, request_id: id })}\n\n`,
            );
            return;
          }
        }
      } else {for await (const e of stream.events) {
          if (e.type === "delta") yield trackDelta(e.text);
          else if (e.type === "done") {
            yield trackDone();
            return;
          } else if (e.type === "error") {
            streamError = e.code;
            yield enc.encode(
              `event: error\ndata: ${JSON.stringify({ error: e.code, code: e.code, request_id: id })}\n\n`,
            );
            return;
          }
        }}
    }
    const out = new ReadableStream<Uint8Array>({
      async start(c) {
        try {
          for await (const x of combined()) c.enqueue(x);
        } catch (e) {
          if (isAbortError(e)) {
            finishRequest(id, "aborted", { sentChars }, (x) => log(id, "request_summary", x));
            return;
          }
          streamError = "stream_error";
          log(id, "stream_error", { error: e instanceof Error ? e.name : "unknown" });
        } finally {
          finishRequest(
            id,
            streamError ? "error" : "ok",
            { code: streamError ?? undefined, sentChars },
            (x) => log(id, "request_summary", x),
          );
          c.close();
        }
      },
    });
    return new Response(out, {
      headers: {
        ...cors(req),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Request-Id": id,
        "X-Model-Used": used.id,
        "X-Model-Name": used.name,
        "X-Route-Category": route,
      },
    });
  } catch (e) {
    if (isAbortError(e)) {
      finishRequest(id, "aborted", {}, (x) => log(id, "request_summary", x));
      return new Response(null, { status: 499, headers: cors(req) });
    }
    const s = Number((e as { status?: number }).status) || 500,
      c = String((e as { code?: string }).code || (s >= 500 ? "internal_error" : "invalid_request"));
    if (s >= 500) log(id, "unhandled_error", { detail: String(e) });
    return fail(
      req,
      c,
      s >= 500
        ? "Something went wrong on our side."
        : String((e as Error)?.message || "The request could not be processed."),
      s,
      id,
    );
  }
});
