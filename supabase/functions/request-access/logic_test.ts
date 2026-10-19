import { requestAccess, type RequestAccessDeps } from "./logic.ts";
import { verifyDecision } from "../shared/access.ts";

function assert(c: unknown, m = "assertion failed"): asserts c {
  if (!c) throw new Error(m);
}
const UID = "123e4567-e89b-12d3-a456-426614174000";

function setup(
  opts: {
    env?: Record<string, string>;
    existing?: "approved" | "pending" | "blocked" | null;
    user?: Partial<RequestAccessDeps["user"]>;
    mailOk?: boolean;
  } = {},
) {
  const sent: Array<{ to: string; text: string; subject: string }> = [];
  const inserts: string[] = [];
  const logs: string[] = [];
  const env: Record<string, string> = {
    OWNER_EMAIL: "owner@example.com",
    APPROVAL_SECRET: "sec",
    APP_ORIGIN: "https://app.example.com",
    ...opts.env,
  };
  const deps: RequestAccessDeps = {
    user: { id: UID, email: "new@user.com", email_confirmed_at: "x", ...opts.user },
    env: (n) => env[n],
    store: {
      getStatus: () => Promise.resolve(opts.existing ?? null),
      insertPending: (id) => {
        inserts.push(id);
        return Promise.resolve("inserted");
      },
    },
    sendEmail: (m) => {
      sent.push(m);
      return Promise.resolve(opts.mailOk ?? true);
    },
    nowMs: () => 1_000_000,
    log: (e) => logs.push(e),
  };
  return { deps, sent, inserts, logs };
}

Deno.test("request-access: feature off => approved, no row, no email", async () => {
  const t = setup({ env: { OWNER_EMAIL: "" } });
  assert((await requestAccess(t.deps)).status === "approved");
  assert(t.inserts.length === 0 && t.sent.length === 0);
});

Deno.test("request-access: owner is approved instantly without a row or email", async () => {
  const t = setup({ user: { email: "OWNER@example.com" } });
  assert((await requestAccess(t.deps)).status === "approved");
  assert(t.inserts.length === 0 && t.sent.length === 0);
});

Deno.test("request-access: a new user becomes pending and the owner gets ONE email with working links", async () => {
  const t = setup();
  assert((await requestAccess(t.deps)).status === "pending");
  assert(t.inserts.length === 1 && t.sent.length === 1);
  assert(t.sent[0].to === "owner@example.com");
  const approve = /Approve: (\S+)/.exec(t.sent[0].text)![1];
  assert(approve.startsWith("https://app.example.com/?approve="));
  const token = decodeURIComponent(approve.split("?approve=")[1]);
  const v = await verifyDecision("sec", token, 1000);
  assert(v?.decision === "approve" && v.userId === UID);
});

Deno.test("request-access: asking again does not insert or email again", async () => {
  const t = setup({ existing: "pending" });
  assert((await requestAccess(t.deps)).status === "pending");
  assert(t.inserts.length === 0 && t.sent.length === 0);
  assert((await requestAccess(setup({ existing: "approved" }).deps)).status === "approved");
  assert((await requestAccess(setup({ existing: "blocked" }).deps)).status === "blocked");
});

Deno.test("request-access: email trouble never blocks the request", async () => {
  const noSecret = setup({ env: { APPROVAL_SECRET: "" } });
  assert((await requestAccess(noSecret.deps)).status === "pending");
  assert(noSecret.sent.length === 0 && noSecret.logs.includes("approval_email_skipped"));
  const failing = setup({ mailOk: false });
  assert((await requestAccess(failing.deps)).status === "pending");
  assert(failing.logs.includes("approval_email_failed"));
});
