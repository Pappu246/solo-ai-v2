import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { redactSecrets } from "../chat/providers.ts";
import {
  createUsageController,
  limitsFromEnv,
  type QueryClient,
} from "../shared/usage.ts";
import { FixedWindowRateLimiter } from "../shared/fixed_window_rate_limit.ts";
import { corsHeaders } from "../shared/cors.ts";
import { accessDeniedMessage, resolveAccess, storeFromClient } from "../shared/access.ts";
import {
  StudyFetchError,
  fetchTranscript,
  parseVideoId,
} from "./youtube.ts";
import {
  generateStudyPack,
  StudyGenerationError,
  transcriptToText,
  type StudyPack,
} from "./generate.ts";

const cors = (req: Request) =>
  corsHeaders(req, Deno.env.get("APP_ORIGIN"), {
    allowMethods: "GET, POST, OPTIONS",
    allowHeaders: "Content-Type, Authorization, X-Client-Info, Apikey",
    exposeHeaders: "X-Request-Id",
  });
const json = (req: Request, b: unknown, s = 200, id?: string) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors(req), "Content-Type": "application/json", ...(id ? { "X-Request-Id": id } : {}) },
  });
const fail = (req: Request, code: string, message: string, status: number, id: string) =>
  json(req, { error: message, code, request_id: id }, status, id);

function log(id: string, event: string, fields: Record<string, unknown> = {}) {
  const x: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    x[k] = typeof v === "string" ? redactSecrets(v).slice(0, 500) : v;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), fn: "study", request_id: id, event, ...x }));
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

Deno.serve(async (req) => {
  const id = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  try {
    const user = await requireUser(req);
    if (req.method === "GET") return json(req, { ok: true }, 200, id);
    if (req.method !== "POST") return fail(req, "method_not_allowed", "Method not allowed", 405, id);
    if (!localRateLimit.allow(user.id)) {
      return fail(req, "rate_limited", "Rate limit exceeded. Please wait a moment.", 429, id);
    }

    // Access gate: identical to the chat function (active only when OWNER_EMAIL is set).
    const auth = req.headers.get("Authorization") || "";
    const accessClient = supabaseUrl && publishableKey && auth
      ? createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: auth } },
      })
      : null;
    const access = await resolveAccess(user, (n) => Deno.env.get(n), storeFromClient(accessClient as unknown as QueryClient | null));
    if (access !== "approved") {
      return fail(
        req,
        access === "blocked" ? "access_blocked" : "access_pending",
        accessDeniedMessage(access),
        403,
        id,
      );
    }

    const usage = createUsageController(
      supabaseUrl && publishableKey && auth
        ? createClient(supabaseUrl, publishableKey, {
          auth: { persistSession: false },
          global: { headers: { Authorization: auth } },
        })
        : null,
      { limits: limitsFromEnv((n) => Deno.env.get(n)), onEvent: (event, fields) => log(id, event, fields) },
    );
    const usageDecision = await usage.checkChat(user.id);
    if (!usageDecision.allowed) {
      return fail(
        req,
        usageDecision.reason === "minute" ? "rate_limited" : "usage_limit",
        usageDecision.reason === "minute"
          ? "You are making too many requests. Please wait a moment."
          : "You have reached your usage limit for now. Please try again later.",
        429,
        id,
      );
    }

    const body = await req.json().catch(() => {
      throw Object.assign(new Error("Invalid JSON body"), { status: 400, code: "invalid_request" });
    });
    const videoId = parseVideoId(typeof body?.url === "string" ? body.url : "");
    if (!videoId) {
      return fail(req, "invalid_url", "Please paste a valid YouTube link or video id.", 400, id);
    }

    log(id, "study_start", { videoId, language: typeof body?.language === "string" ? body.language : null });
    let transcript: Awaited<ReturnType<typeof fetchTranscript>>;
    try {
      transcript = await fetchTranscript(videoId, fetch);
    } catch (error) {
      const code = error instanceof StudyFetchError ? error.code : "network";
      log(id, "study_transcript_failed", { videoId, code });
      return fail(req, code, error instanceof StudyFetchError ? error.message : "Could not load the transcript right now.", 400, id);
    }
    const transcriptText = transcriptToText(transcript.segments);
    log(id, "study_transcript_ok", { videoId, segments: transcript.segments.length, chars: transcriptText.length, truncated: transcript.truncated });

    let pack: StudyPack;
    try {
      pack = await generateStudyPack({
        env: (n) => Deno.env.get(n),
        fetchImpl: fetch,
        videoId,
        transcriptText,
        truncated: transcript.truncated,
        languageName: typeof body?.language === "string" ? body.language : undefined,
        requestedModel: typeof body?.model === "string" ? body.model : null,
        signal: req.signal,
        log: (event, fields) => log(id, event, fields),
      });
    } catch (error) {
      if (error instanceof StudyGenerationError) {
        log(id, "study_generation_failed", { code: error.code });
        return fail(req, error.code, error.message, 400, id);
      }
      log(id, "study_unhandled_error", { detail: String(error) });
      return fail(req, "internal_error", "Something went wrong on our side.", 500, id);
    }

    const estTokens = Math.ceil((transcriptText.length + JSON.stringify(pack).length) / 4);
    await usage.recordTokens(user.id, estTokens);
    log(id, "study_done", { videoId, notes: pack.notes.length, quiz: pack.quiz.length, flashcards: pack.flashcards.length });
    return json(req, { pack, videoId }, 200, id);
  } catch (error) {
    if ((error as { status?: number })?.status === 401) {
      return fail(req, "unauthorized", "Please sign in to use Study mode.", 401, id);
    }
    const s = Number((error as { status?: number }).status) || 500;
    log(id, "study_unhandled_error", { detail: String(error) });
    return fail(
      req,
      s >= 500 ? "internal_error" : "invalid_request",
      s >= 500 ? "Something went wrong on our side." : String((error as Error)?.message || "The request could not be processed."),
      s,
      id,
    );
  }
});
