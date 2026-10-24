import {
  type AccessRecord,
  type AccessStatus,
  type AccessUser,
  approvalRequired,
  approvalTtlMs,
  type EnvReader,
  isApprovalExpired,
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
    getRecord(userId: string): Promise<AccessRecord | null>;
    insertPending(userId: string): Promise<"inserted" | "exists">;
    /** Service-role write: turn an expired approval back into a pending request. */
    resetToPending(userId: string): Promise<void>;
  };
  sendEmail(msg: MailMessage): Promise<boolean>;
  nowMs(): number;
  log(event: string, fields?: Record<string, unknown>): void;
}

/**
 * Called by the app after sign-in. Returns the caller's access status and, the
 * first time a non-owner asks, emails the owner a signed approve/reject link.
 */
export async function requestAccess(
  d: RequestAccessDeps,
): Promise<{ status: AccessStatus }> {
  if (!approvalRequired(d.env) || isOwner(d.user, d.env)) {
    return { status: "approved" };
  }

  const existing = await d.store.getRecord(d.user.id);
  if (existing) {
    if (!isApprovalExpired(existing, d.nowMs(), approvalTtlMs(d.env))) {
      return { status: existing.status };
    }
    // The approval ran out: ask the owner again.
    await d.store.resetToPending(d.user.id);
    await notifyOwner(d);
    d.log("approval_expired");
    return { status: "pending" };
  }

  if ((await d.store.insertPending(d.user.id)) === "inserted") {
    await notifyOwner(d);
  }
  return { status: "pending" };
}

async function notifyOwner(d: RequestAccessDeps): Promise<void> {
  try {
    const secret = (d.env("APPROVAL_SECRET") ?? "").trim();
    if (!secret) {
      return d.log("approval_email_skipped", {
        reason: "APPROVAL_SECRET not set",
      });
    }
    const expires = Math.floor(d.nowMs() / 1000) + TOKEN_TTL_SECONDS;
    const base = primaryOrigin(d.env("APP_ORIGIN"));
    const link = async (decision: "approve" | "reject") =>
      `${base}/?approve=${
        encodeURIComponent(
          await signDecision(secret, decision, d.user.id, expires),
        )
      }`;
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
