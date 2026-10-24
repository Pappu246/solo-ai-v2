import {
  accessDeniedMessage,
  type AccessStatus,
  type AccessStore,
  approvalRequired,
  approvalTtlMs,
  isOwner,
  type QueryClient,
  resolveAccess,
  signDecision,
  storeFromClient,
  verifyDecision,
} from "./access.ts";
import { buildApprovalEmail, escapeHtml, sendMail } from "./mail.ts";
import { primaryOrigin } from "./cors.ts";

function assert(c: unknown, m = "assertion failed"): asserts c {
  if (!c) throw new Error(m);
}
function eq<T>(a: T, b: T, m = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(
      `${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`,
    );
  }
}

const ENV = (o: Record<string, string>) => (n: string) => o[n];
const owner = {
  id: "o",
  email: "Owner@Example.com",
  email_confirmed_at: "2026-01-01",
};
const stranger = {
  id: "u1",
  email: "x@y.com",
  email_confirmed_at: "2026-01-01",
};
const store = (
  s: AccessStatus | null | "throw",
  decidedAt: string | null = new Date().toISOString(),
): AccessStore => ({
  getRecord: () =>
    s === "throw"
      ? Promise.reject(new Error("db down"))
      : Promise.resolve(s ? { status: s, decidedAt } : null),
});

Deno.test("access: nothing changes until OWNER_EMAIL is set", async () => {
  eq(approvalRequired(ENV({})), false);
  eq(await resolveAccess(stranger, ENV({}), store(null)), "approved");
  eq(approvalRequired(ENV({ OWNER_EMAIL: "  " })), false);
});

Deno.test("access: owner is always approved, matched case-insensitively and only when confirmed", async () => {
  const env = ENV({ OWNER_EMAIL: "owner@example.com" });
  assert(isOwner(owner, env));
  eq(
    await resolveAccess(owner, env, store("throw")),
    "approved",
    "owner never depends on the database",
  );
  assert(
    !isOwner({ ...owner, email_confirmed_at: null }, env),
    "unconfirmed email must not count",
  );
  assert(
    !isOwner({
      id: "z",
      email: "owner@example.com.evil.com",
      email_confirmed_at: "x",
    }, env),
  );
});

Deno.test("access: others need approval, and every failure is closed", async () => {
  const env = ENV({ OWNER_EMAIL: "owner@example.com" });
  eq(await resolveAccess(stranger, env, store("approved")), "approved");
  eq(await resolveAccess(stranger, env, store("pending")), "pending");
  eq(await resolveAccess(stranger, env, store("blocked")), "blocked");
  eq(
    await resolveAccess(stranger, env, store(null)),
    "pending",
    "no row yet = pending",
  );
  eq(
    await resolveAccess(stranger, env, store("throw")),
    "pending",
    "lookup failure fails closed",
  );
  assert(accessDeniedMessage("blocked") !== accessDeniedMessage("pending"));
});

Deno.test("access: an approval expires after APPROVAL_DAYS (default 7) and can be disabled", async () => {
  const day = 86_400_000;
  const now = Date.parse("2026-10-24T00:00:00Z");
  const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();
  const env = ENV({ OWNER_EMAIL: "owner@example.com" });
  eq(
    await resolveAccess(stranger, env, store("approved", at(6)), now),
    "approved",
  );
  eq(
    await resolveAccess(stranger, env, store("approved", at(8)), now),
    "pending",
    "expired after 7 days",
  );
  eq(
    await resolveAccess(stranger, env, store("approved", null), now),
    "pending",
    "no decision date = expired",
  );
  eq(
    await resolveAccess(stranger, env, store("blocked", at(30)), now),
    "blocked",
    "blocked never expires into pending",
  );
  const short = ENV({ OWNER_EMAIL: "owner@example.com", APPROVAL_DAYS: "1" });
  eq(
    await resolveAccess(stranger, short, store("approved", at(2)), now),
    "pending",
  );
  const forever = ENV({ OWNER_EMAIL: "owner@example.com", APPROVAL_DAYS: "0" });
  eq(
    await resolveAccess(stranger, forever, store("approved", at(400)), now),
    "approved",
  );
  eq(
    approvalTtlMs(ENV({ APPROVAL_DAYS: "abc" })),
    7 * day,
    "bad value falls back to 7 days",
  );
});

Deno.test("access: storeFromClient reads only a valid status", async () => {
  const client = (data: unknown, error: unknown = null): QueryClient => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: data as never, error }),
        }),
      }),
    }),
  });
  eq(
    await storeFromClient(
      client({ status: "approved", decided_at: "2026-01-01T00:00:00Z" }),
    ).getRecord("u"),
    {
      status: "approved",
      decidedAt: "2026-01-01T00:00:00Z",
    },
  );
  eq(await storeFromClient(client(null)).getRecord("u"), null);
  eq(
    await storeFromClient(client({ status: "admin" })).getRecord("u"),
    null,
    "unknown values are ignored",
  );
  let threw = false;
  try {
    await storeFromClient(client(null, { message: "x" })).getRecord("u");
  } catch {
    threw = true;
  }
  assert(threw, "database errors surface so the caller can fail closed");
});

Deno.test("tokens: sign/verify round trip, tamper, expiry, wrong secret", async () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const t = await signDecision("s3cret", "approve", id, 2000);
  eq(await verifyDecision("s3cret", t, 1000), {
    decision: "approve",
    userId: id,
  });
  eq(await verifyDecision("s3cret", t, 2001), null, "expired");
  eq(await verifyDecision("other", t, 1000), null, "wrong secret");
  eq(
    await verifyDecision("s3cret", t.replace("approve", "reject"), 1000),
    null,
    "decision cannot be flipped",
  );
  eq(
    await verifyDecision(
      "s3cret",
      t.replace(id, "123e4567-e89b-12d3-a456-426614174999"),
      1000,
    ),
    null,
    "user cannot be swapped",
  );
  eq(await verifyDecision("s3cret", "garbage", 1000), null);
  eq(await verifyDecision("", t, 1000), null, "empty secret never verifies");
});

Deno.test("mail: content is escaped and send failures never throw", async () => {
  const msg = buildApprovalEmail({
    to: "o@x.com",
    userEmail: `a<script>"@x.com`,
    approveUrl: "https://a/?approve=1",
    rejectUrl: "https://a/?approve=2",
  });
  assert(
    !msg.html.includes("<script>"),
    "user-controlled text must be escaped",
  );
  assert(msg.html.includes("&lt;script&gt;"));
  eq(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const ok = await sendMail(
    (u, i) => {
      calls.push({ url: u, init: i });
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    ENV({ RESEND_API_KEY: "re_x" }),
    msg,
  );
  assert(ok && calls[0].url === "https://api.resend.com/emails");
  assert(
    (calls[0].init?.headers as Record<string, string>).Authorization ===
      "Bearer re_x",
  );
  assert(String(calls[0].init?.body).includes("onboarding@resend.dev"));
  eq(
    await sendMail(
      () => Promise.reject(new Error("net")),
      ENV({ RESEND_API_KEY: "re_x" }),
      msg,
    ),
    false,
  );
  eq(
    await sendMail(
      () => Promise.resolve(new Response("no", { status: 500 })),
      ENV({ RESEND_API_KEY: "re_x" }),
      msg,
    ),
    false,
  );
  eq(
    await sendMail(() => Promise.resolve(new Response("{}")), ENV({}), msg),
    false,
    "no key = not sent",
  );
});

Deno.test("cors: primaryOrigin picks the first valid origin", () => {
  eq(
    primaryOrigin("https://app.example.com, https://b.example.com"),
    "https://app.example.com",
  );
  eq(primaryOrigin(undefined), "https://solo-ai-v2-mu.vercel.app");
});
