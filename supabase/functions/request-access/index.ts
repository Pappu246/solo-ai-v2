/**
 * request-access: called by the app after sign-in.
 * Returns { status: "approved" | "pending" | "blocked" } for the caller and,
 * the first time a non-owner asks, emails the owner an approve/reject link.
 *
 * Needs a valid user JWT. The owner (OWNER_EMAIL) is always "approved".
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../shared/cors.ts";
import { sendMail } from "../shared/mail.ts";
import { type QueryClient, storeFromClient } from "../shared/access.ts";
import { requestAccess } from "./logic.ts";

const env = (n: string) => Deno.env.get(n);
const cors = (req: Request) =>
  corsHeaders(req, env("APP_ORIGIN"), {
    allowMethods: "POST, OPTIONS",
    allowHeaders: "Content-Type, Authorization, X-Client-Info, Apikey",
  });
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const supabaseUrl = env("SUPABASE_URL") || "";
let publishableKey = "";
try {
  publishableKey = JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || "";
} catch {
  publishableKey = "";
}
publishableKey ||= env("SUPABASE_ANON_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed", code: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !supabaseUrl || !publishableKey) {
    return json(req, { error: "Unauthorized", code: "unauthorized" }, 401);
  }
  // A client carrying the caller's JWT: RLS limits it to the caller's own row.
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await client.auth.getUser(auth.slice(7));
  if (error || !data.user) return json(req, { error: "Unauthorized", code: "unauthorized" }, 401);
  const user = data.user;

  const reader = storeFromClient(client as unknown as QueryClient);
  const log = (event: string, fields: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ at: new Date().toISOString(), fn: "request-access", event, ...fields }));

  try {
    const result = await requestAccess({
      user,
      env,
      store: {
        getStatus: (id) => reader.getStatus(id),
        async insertPending(id) {
          const { error: insertError } = await client.from("user_access").insert({ user_id: id, status: "pending" });
          if (!insertError) return "inserted";
          if ((insertError as { code?: string }).code === "23505") return "exists"; // asked twice at once
          throw new Error("insert failed");
        },
      },
      sendEmail: (msg) => sendMail(fetch, env, msg),
      nowMs: () => Date.now(),
      log,
    });
    return json(req, result);
  } catch {
    log("request_access_failed");
    return json(req, { error: "Could not check access right now.", code: "internal_error" }, 500);
  }
});
