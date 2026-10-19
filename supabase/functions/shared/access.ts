/**
 * Approval-based access control (pure, dependency-injected, offline-testable).
 *
 * Rules
 *  - Approval is required only when the OWNER_EMAIL secret is set. Without it
 *    the app behaves exactly as before, so deploying this is safe.
 *  - The owner (verified email === OWNER_EMAIL) is always approved: no row,
 *    no email, no friction for demos.
 *  - Everyone else needs a `user_access` row with status "approved".
 *  - Any lookup failure fails CLOSED (treated as pending).
 */
export type AccessStatus = "approved" | "pending" | "blocked";
export type EnvReader = (name: string) => string | undefined;

export interface AccessUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

export interface AccessStore {
  getStatus(userId: string): Promise<AccessStatus | null>;
}

export const ownerEmail = (env: EnvReader): string => (env("OWNER_EMAIL") ?? "").trim().toLowerCase();

export const approvalRequired = (env: EnvReader): boolean => ownerEmail(env) !== "";

/** The owner must have a *confirmed* email, so nobody can claim it by typing it in. */
export function isOwner(user: AccessUser, env: EnvReader): boolean {
  const owner = ownerEmail(env);
  return owner !== "" && (user.email ?? "").trim().toLowerCase() === owner && Boolean(user.email_confirmed_at);
}

export async function resolveAccess(user: AccessUser, env: EnvReader, store: AccessStore): Promise<AccessStatus> {
  if (!approvalRequired(env) || isOwner(user, env)) return "approved";
  try {
    return (await store.getStatus(user.id)) ?? "pending";
  } catch {
    return "pending";
  }
}

/** Adapter for a supabase-js client created with the caller's JWT. */
export interface QueryClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: { status?: unknown } | null; error: unknown }>;
      };
    };
  };
}

export function storeFromClient(client: QueryClient | null): AccessStore {
  return {
    async getStatus(userId) {
      if (!client) throw new Error("no client");
      const { data, error } = await client.from("user_access").select("status").eq("user_id", userId).maybeSingle();
      if (error) throw new Error("lookup failed");
      const s = data?.status;
      return s === "approved" || s === "pending" || s === "blocked" ? s : null;
    },
  };
}

export const accessDeniedMessage = (status: AccessStatus): string =>
  status === "blocked" ? "Your access to Solo AI has been turned off." : "Your access request is waiting for approval.";

// ── Signed approve / reject links ───────────────────────────────────────────

export type Decision = "approve" | "reject";
const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function signDecision(
  secret: string,
  decision: Decision,
  userId: string,
  expiresAtSec: number,
): Promise<string> {
  const payload = `${decision}.${userId}.${expiresAtSec}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyDecision(
  secret: string,
  token: string,
  nowSec: number,
): Promise<{ decision: Decision; userId: string } | null> {
  if (!secret || typeof token !== "string" || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [decision, userId, exp, sig] = parts;
  if (decision !== "approve" && decision !== "reject") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
  const expiresAt = Number(exp);
  if (!Number.isInteger(expiresAt) || expiresAt < nowSec) return null;
  const expected = await hmacHex(secret, `${decision}.${userId}.${exp}`);
  return safeEqual(expected, sig) ? { decision, userId } : null;
}
