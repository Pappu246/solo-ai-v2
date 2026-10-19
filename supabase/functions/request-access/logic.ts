import {
  type AccessStatus,
  type AccessUser,
  approvalRequired,
  type EnvReader,
  isOwner,
  ownerEmail,
  signDecision,
  TOKEN_TTL_SECONDS,
} from "../shared/access.ts";
import { buildApprovalEmail, type MailMessage } from "../shared/mail.ts";
import { primaryOrigin } from "../shared/cors.ts";

export interface RequestAccessDeps {
  user: AccessUser;
  env: EnvReader;
  store: {
    getStatus(userId: string): Promise<AccessStatus | null>;
    insertPending(userId: string): Promise<"inserted" | "exists">;
  };
  sendEmail(msg: MailMessage): Promise<boolean>;
  nowMs(): number;
  log(event: string, fields?: Record<string, unknown>): void;
}

/**
 * Called by the app after sign-in. Returns the caller's access status and, the
 * first time a non-owner asks, emails the owner a signed approve/reject link.
 */
export async function requestAccess(d: RequestAccessDeps): Promise<{ status: AccessStatus }> {
  if (!approvalRequired(d.env) || isOwner(d.user, d.env)) return { status: "approved" };

  const existing = await d.store.getStatus(d.user.id);
  if (existing) return { status: existing };

  if ((await d.store.insertPending(d.user.id)) === "inserted") await notifyOwner(d);
  return { status: "pending" };
}

async function notifyOwner(d: RequestAccessDeps): Promise<void> {
  try {
    const secret = (d.env("APPROVAL_SECRET") ?? "").trim();
    if (!secret) return d.log("approval_email_skipped", { reason: "APPROVAL_SECRET not set" });
    const expires = Math.floor(d.nowMs() / 1000) + TOKEN_TTL_SECONDS;
    const base = primaryOrigin(d.env("APP_ORIGIN"));
    const link = async (decision: "approve" | "reject") =>
      `${base}/?approve=${encodeURIComponent(await signDecision(secret, decision, d.user.id, expires))}`;
    const sent = await d.sendEmail(buildApprovalEmail({
      to: ownerEmail(d.env),
      userEmail: d.user.email ?? "a new user",
      approveUrl: await link("approve"),
      rejectUrl: await link("reject"),
    }));
    d.log(sent ? "approval_email_sent" : "approval_email_failed");
  } catch {
    d.log("approval_email_failed");
  }
}
