/**
 * access-approve: the owner confirms an approve/reject link from the email.
 *
 * Public endpoint (verify_jwt = false): the signed, expiring token IS the
 * authorization. Browsers call it from the app page, so link previews that
 * only GET the URL can never change anything. Uses the service role key
 * (provided to Edge Functions by Supabase) for this one write.
 *
 *   POST { token }                  -> { ok, preview: true, decision, email }
 *   POST { token, confirm: true }   -> { ok, decision, email }   (applies it)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../shared/cors.ts";
import { verifyDecision } from "../shared/access.ts";

const env = (n: string) => Deno.env.get(n);
const cors = (req: Request) =>
  corsHeaders(req, env("APP_ORIGIN"), {
    allowMethods: "POST, OPTIONS",
    // The app sends `apikey` on every Supabase call; without it in this list
    // the browser's preflight fails and the page reports "could not reach server".
    allowHeaders: "Content-Type, Authorization, X-Client-Info, Apikey",
  });
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed", code: "method_not_allowed" }, 405);

  const secret = (env("APPROVAL_SECRET") ?? "").trim();
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const url = env("SUPABASE_URL") ?? "";
  if (!secret || !serviceKey || !url) {
    return json(req, { error: "Approvals are not configured.", code: "not_configured" }, 503);
  }

  const body = await req.json().catch(() => null) as { token?: unknown; confirm?: unknown } | null;
  const verified = await verifyDecision(secret, String(body?.token ?? ""), Math.floor(Date.now() / 1000));
  if (!verified) return json(req, { error: "This link is invalid or has expired.", code: "invalid_token" }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.getUserById(verified.userId);
  if (error || !data.user) return json(req, { error: "That user no longer exists.", code: "not_found" }, 404);
  const email = data.user.email ?? "";

  if (body?.confirm !== true) return json(req, { ok: true, preview: true, decision: verified.decision, email });

  const { error: writeError } = await admin.from("user_access").upsert({
    user_id: verified.userId,
    status: verified.decision === "approve" ? "approved" : "blocked",
    decided_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (writeError) return json(req, { error: "Could not save the decision.", code: "internal_error" }, 500);

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      fn: "access-approve",
      event: verified.decision,
      user_id: verified.userId,
    }),
  );
  return json(req, { ok: true, decision: verified.decision, email });
});
