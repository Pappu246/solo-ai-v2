/** Owner notification email (Resend). Dependency-injected for offline tests. */
export type EnvReader = (name: string) => string | undefined;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export const escapeHtml = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function buildApprovalEmail(
  input: { to: string; userEmail: string; approveUrl: string; rejectUrl: string },
): MailMessage {
  const who = escapeHtml(input.userEmail);
  const button = (href: string, label: string, color: string) =>
    `<a href="${
      escapeHtml(href)
    }" style="display:inline-block;padding:10px 18px;margin-right:8px;border-radius:8px;background:${color};color:#fff;text-decoration:none;font-weight:600">${label}</a>`;
  return {
    to: input.to,
    subject: `Solo AI: ${input.userEmail} wants access`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px"><p><b>${who}</b> asked to use Solo AI.</p><p>${
      button(input.approveUrl, "Approve", "#16a34a")
    }${
      button(input.rejectUrl, "Reject", "#dc2626")
    }</p><p style="color:#666;font-size:12px">Links expire in 7 days. You will be asked to confirm before anything changes.</p></div>`,
    text:
      `${input.userEmail} asked to use Solo AI.\nApprove: ${input.approveUrl}\nReject: ${input.rejectUrl}\n(Links expire in 7 days.)`,
  };
}

/** Sends through Resend. Never throws; returns whether the provider accepted it. */
export async function sendMail(fetchImpl: FetchLike, env: EnvReader, msg: MailMessage): Promise<boolean> {
  const apiKey = (env("RESEND_API_KEY") ?? "").trim();
  if (!apiKey) return false;
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: (env("MAIL_FROM") ?? "").trim() || "Solo AI <onboarding@resend.dev>",
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
