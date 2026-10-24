/**
 * Approval-based access control (pure, dependency-injected, offline-testable).
 *
 * Rules
 *  - Approval is required only when the OWNER_EMAIL secret is set. Without it
 *    the app behaves exactly as before, so deploying this is safe.
 *  - The owner (verified email === OWNER_EMAIL) is always approved: no row,
 *    no email, no friction for demos.
 *  - Everyone else needs a `user_access` row with status "approved".
 *  - An approval lasts APPROVAL_DAYS (default 7; 0 = never expires). After
 *    that the user is treated as pending and the owner is asked again.
 *  - Any lookup failure fails CLOSED (treated as pending).
 */
export type AccessStatus = "approved" | "pending" | "blocked";
export type EnvReader = (name: string) => string | undefined;

export interface AccessUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

export interface AccessRecord {
  status: AccessStatus;
  /** ISO time of the owner's decision (null while pending). */
  decidedAt: string | null;
}

export interface AccessStore {
  getRecord(userId: string): Promise<AccessRecord | null>;
}

export const DEFAULT_APPROVAL_DAYS = 7;

/** How long an approval lasts, in ms. 0 means it never expires. */
export function approvalTtlMs(env: EnvReader): number {
  const raw = (env("APPROVAL_DAYS") ?? "").trim();
  const days = raw === "" ? DEFAULT_APPROVAL_DAYS : Number(raw);
  return Number.isFinite(days) && days >= 0
    ? days * 86_400_000
    : DEFAULT_APPROVAL_DAYS * 86_400_000;
}

/** True when an approved record is older than the approval lifetime (a missing date counts as expired). */
export function isApprovalExpired(
  record: AccessRecord,
  nowMs: number,
  ttlMs: number,
): boolean {
  if (record.status !== "approved" || ttlMs === 0) return false;
  const decided = record.decidedAt ? Date.parse(record.decidedAt) : NaN;
  return !Number.isFinite(decided) || nowMs - decided > ttlMs;
}

/** The status that counts right now: an expired approval is pending again. */
export function effectiveStatus(
  record: AccessRecord | null,
  nowMs: number,
  ttlMs: number,
): AccessStatus {
  if (!record) return "pending";
  return isApprovalExpired(record, nowMs, ttlMs) ? "pending" : record.status;
}

export const ownerEmail = (env: EnvReader): string =>
  (env("OWNER_EMAIL") ?? "").trim().toLowerCase();

export const approvalRequired = (env: EnvReader): boolean =>
  ownerEmail(env) !== "";

/** The owner must have a *confirmed* email, so nobody can claim it by typing it in. */
export function isOwner(user: AccessUser, env: EnvReader): boolean {
  const owner = ownerEmail(env);
  return owner !== "" && (user.email ?? "").trim().toLowerCase() === owner &&
    Boolean(user.email_confirmed_at);
}

export async function resolveAccess(
  user: AccessUser,
  env: EnvReader,
  store: AccessStore,
  nowMs: number = Date.now(),
): Promise<AccessStatus> {
  if (!approvalRequired(env) || isOwner(user, env)) return "approved";
  try {
    return effectiveStatus(
      await store.getRecord(user.id),
      nowMs,
      approvalTtlMs(env),
    );
  } catch {
    return "pending";
  }
}

/** Adapter for a supabase-js client created with the caller's JWT. */
export interface QueryClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<
          {
            data: { status?: unknown; decided_at?: unknown } | null;
            error: unknown;
          }
        >;
      };
    };
  };
}

export function storeFromClient(client: QueryClient | null): AccessStore {
  return {
    async getRecord(userId) {
      if (!client) throw new Error("no client");
      const { data, error } = await client.from("user_access").select(
        "status, decided_at",
      ).eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("lookup failed");
      const s = data?.status;
      if (s !== "approved" && s !== "pending" && s !== "blocked") return null;
      return {
        status: s,
        decidedAt: typeof data?.decided_at === "string"
          ? data.decided_at
          : null,
      };
    },
  };
}

export const accessDeniedMessage = (status: AccessStatus): string =>
  status === "blocked"
    ? "Your access to Solo AI has been turned off."
    : "Your access request is waiting for approval.";

// ── Signed approve / reject links ───────────────────────────────────────────

export type Decision = "approve" | "reject";
const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [
      "sign",
    ],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) return null;
  const expiresAt = Number(exp);
  if (!Number.isInteger(expiresAt) || expiresAt < nowSec) return null;
  const expected = await hmacHex(secret, `${decision}.${userId}.${exp}`);
  return safeEqual(expected, sig) ? { decision, userId } : null;
}
