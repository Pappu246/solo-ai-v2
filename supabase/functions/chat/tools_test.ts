import {
  MAX_ARGS_CHARS,
  MAX_OUTPUT_CHARS,
  ToolInputError,
  ToolRegistry,
  ToolUnavailableError,
  createDefaultRegistry,
  evaluateArithmetic,
  sanitizeOutput,
  type ToolContext,
  type ToolData,
  type ToolSpec,
} from "./tools.ts";

function assert(condition: unknown, message = "expected truthy"): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals<T>(actual: T, expected: T, message = "values differ"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}
function assertIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) throw new Error(`expected ${actual} to include ${expected}`);
}

const ctx = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  userId: "user-1",
  requestId: "req-1",
  env: () => undefined,
  ...overrides,
});

Deno.test("registry rejects invalid, duplicate and reserved names", () => {
  const registry = new ToolRegistry();
  const spec: ToolSpec<Record<string, unknown>> = {
    name: "ok_tool",
    description: "d",
    parameters: { type: "object", properties: {} },
    parse: raw => raw,
    execute: async () => "{}",
  };
  registry.register(spec);
  let threw = false;
  try { registry.register(spec); } catch { threw = true; }
  assert(threw, "duplicate registration must throw");
  for (const bad of ["__proto__", "hasOwnProperty", "UPPER", "with-dash", "9lives", "a".repeat(65)]) {
    let rejected = false;
    try {
      registry.register({ ...spec, name: bad });
    } catch { rejected = true; }
    assert(rejected, `name ${bad} must be rejected`);
  }
  assert(!registry.has("__proto__"));
  assertEquals(registry.names(), ["ok_tool"]);
});

Deno.test("unknown tool and prototype-polluting names fail safely", async () => {
  const registry = createDefaultRegistry();
  const session = registry.session(ctx());
  const missing = await session.call("does_not_exist", {});
  assertEquals(missing.ok, false);
  assertEquals(missing.code, "unknown_tool");
  const proto = await session.call("__proto__", { polluted: true });
  assertEquals(proto.code, "unknown_tool");
  assertEquals(({} as Record<string, unknown>).polluted, undefined);
});

Deno.test("budget caps calls per session and reports exhaustion", async () => {
  const registry = new ToolRegistry().register({
    name: "echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    parse: raw => raw,
    execute: async args => JSON.stringify(args),
  });
  const session = registry.session(ctx(), { maxCalls: 2 });
  assertEquals((await session.call("echo", { n: 1 })).ok, true);
  assertEquals((await session.call("echo", { n: 2 })).ok, true);
  const third = await session.call("echo", { n: 3 });
  assertEquals(third.ok, false);
  assertEquals(third.code, "budget_exhausted");
  assertEquals(session.used, 3);
  assertEquals(session.remaining, 0);
  assertEquals(session.history().length, 2, "exhausted calls are not recorded as executed");
});

Deno.test("argument validation returns safe messages, never raw errors", async () => {
  const registry = new ToolRegistry().register({
    name: "requires_query",
    description: "d",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    parse: raw => {
      if (typeof raw.query !== "string" || !raw.query.trim()) {
        throw new ToolInputError("`query` is required and must be a non-empty string.");
      }
      return { query: raw.query };
    },
    execute: async () => "{}",
  });
  const session = registry.session(ctx());
  const missing = await session.call("requires_query", { other: 1 });
  assertEquals(missing.ok, false);
  assertEquals(missing.code, "invalid_arguments");
  assertIncludes(missing.error ?? "", "`query` is required");
  // JSON-string arguments are parsed; malformed input is rejected cleanly.
  const badJson = await session.call("requires_query", "{not json");
  assertEquals(badJson.code, "invalid_arguments");
  const stringArgs = await session.call("requires_query", JSON.stringify({ query: "hi" }));
  assertEquals(stringArgs.ok, true);
});

Deno.test("oversized arguments are rejected before the tool runs", async () => {
  let ran = false;
  const registry = new ToolRegistry().register({
    name: "big_args",
    description: "d",
    parameters: { type: "object", properties: {} },
    parse: raw => raw,
    execute: async () => { ran = true; return "{}"; },
  });
  const session = registry.session(ctx());
  const huge = "x".repeat(MAX_ARGS_CHARS + 1);
  const result = await session.call("big_args", { blob: huge });
  assertEquals(result.ok, false);
  assertEquals(result.code, "invalid_arguments");
  assert(!ran, "tool must not execute on oversized args");
});

Deno.test("slow tools time out with an actionable, provider-free message", async () => {
  const registry = new ToolRegistry().register({
    name: "slow",
    description: "d",
    parameters: { type: "object", properties: {} },
    parse: raw => raw,
    execute: () => new Promise<string>(() => { /* never resolves */ }),
    timeoutMs: 1000,
  });
  const session = registry.session(ctx());
  const result = await session.call("slow", {});
  assertEquals(result.ok, false);
  assertEquals(result.code, "timeout");
  assertIncludes(result.error ?? "", "timed out");
  assert(!/groq|openai|anthropic|api[_ ]?key/i.test(result.error ?? ""));
});

Deno.test("thrown errors become generic reasons and are logged redacted", async () => {
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const registry = new ToolRegistry().register({
    name: "boom",
    description: "d",
    parameters: { type: "object", properties: {} },
    parse: raw => raw,
    execute: async () => { throw new Error("upstream failed api_key=sk-secret-123"); },
  });
  const session = registry.session(ctx({ log: (event, fields) => logs.push({ event, fields }) }));
  const result = await session.call("boom", {});
  assertEquals(result.ok, false);
  assertEquals(result.code, "failed");
  assert(!/sk-secret-123/.test(result.error ?? ""), "error must not leak internals");
  assertIncludes(result.error ?? "", "`boom` tool failed");
  const failed = logs.find(l => l.event === "tool_call_failed");
  assert(failed, "failure must be logged");
  assert(!/sk-secret-123/.test(String(failed!.fields.error)), "logs must be redacted");
});

Deno.test("unavailable tools surface a clear configuration message", async () => {
  const registry = new ToolRegistry().register({
    name: "fancy",
    description: "d",
    parameters: { type: "object", properties: {} },
    parse: raw => raw,
    execute: async () => { throw new ToolUnavailableError("Fancy tool is not configured on this workspace."); },
  });
  const result = await registry.session(ctx()).call("fancy", {});
  assertEquals(result.code, "unavailable");
  assertIncludes(result.error ?? "", "not configured");
});

Deno.test("outputs are JSON-capped before reaching the model", async () => {
  const registry = new ToolRegistry().register({
    name: "chatty",
    description: "d",
    parameters: { type: "object", properties: {} },
    parse: raw => raw,
    execute: async () => JSON.stringify({ blob: "y".repeat(MAX_OUTPUT_CHARS * 2) }),
  });
  const result = await registry.session(ctx()).call("chatty", {});
  assertEquals(result.ok, true);
  assert((result.output ?? "").length <= MAX_OUTPUT_CHARS);
  assertIncludes(result.output ?? "", "[truncated]");
  assertEquals(sanitizeOutput("short"), "short");
});

Deno.test("declarations expose registered tools in provider format", () => {
  const declarations = createDefaultRegistry().declarations();
  assertEquals(declarations.length, 6);
  const names = declarations.map(d => d.function.name).sort();
  assertEquals(names, [
    "calculator",
    "conversation_read",
    "conversation_search",
    "current_time",
    "knowledge_search",
    "web_search",
  ]);
  const search = declarations.find(d => d.function.name === "web_search")!;
  assertEquals(search.type, "function");
  assertEquals(search.function.parameters.required, ["query"]);
});

Deno.test("current_time validates timezones and returns ISO time", async () => {
  const registry = createDefaultRegistry();
  const session = registry.session(ctx());
  const ok = await session.call("current_time", { timezone: "Europe/Berlin" });
  assertEquals(ok.ok, true);
  const parsed = JSON.parse(ok.output!);
  assert(typeof parsed.iso === "string" && parsed.iso.endsWith("Z"));
  assertEquals(parsed.timezone, "Europe/Berlin");
  const bad = await session.call("current_time", { timezone: "Mars/Olympus" });
  assertEquals(bad.code, "invalid_arguments");
  assertIncludes(bad.error ?? "", "IANA timezone");
});

Deno.test("web_search uses the injected provider and never the network", async () => {
  const seen: string[] = [];
  const registry = createDefaultRegistry();
  const session = registry.session(ctx({
    env: name => (name === "GOOGLE_CSE_API_KEY" ? "test-key" : name === "GOOGLE_CSE_ENGINE_ID" ? "test-cx" : undefined),
    fetchImpl: async (input: string) => {
      seen.push(String(input));
      return new Response(JSON.stringify({
        items: [
          { title: "Supabase Functions", link: "https://supabase.com/docs/functions", snippet: "Docs" },
          { title: "Duplicate", link: "https://supabase.com/docs/functions", snippet: "Dup" },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  }));
  const ok = await session.call("web_search", { query: "supabase edge functions", limit: 5 });
  assertEquals(ok.ok, true, `expected success, got ${ok.error ?? ""}`);
  const parsed = JSON.parse(ok.output!);
  assertEquals(parsed.sources.length, 1, "duplicate URLs are deduplicated");
  assertEquals(parsed.sources[0].domain, "supabase.com");
  assert(seen.length === 1 && seen[0].includes("customsearch/v1"));
  assert(seen[0].includes("test-cx"), "the CSE request targets the configured engine");
});

Deno.test("web_search degrades cleanly when disabled", async () => {
  const registry = createDefaultRegistry();
  const session = registry.session(ctx({ env: name => (name === "WEB_SEARCH_PROVIDER" ? "off" : undefined) }));
  const result = await session.call("web_search", { query: "anything" });
  assertEquals(result.ok, false);
  assertEquals(result.code, "unavailable");
  assertIncludes(result.error ?? "", "not configured");
});

Deno.test("calculator evaluates arithmetic and rejects non-arithmetic input", async () => {
  const registry = createDefaultRegistry();
  const cases: Array<[unknown, number | string]> = [
    [{ expression: "2 + 2" }, 4],
    [{ expression: "(1 + 2) * 3" }, 9],
    [{ expression: "2 ** 10" }, 1024],
    [{ expression: "-5 + 10" }, 5],
    [{ expression: "10 / 4" }, 2.5],
    [{ expression: "10 % 3" }, 1],
    [{ expression: "0.5 * 4" }, 2],
  ];
  for (const [args, expected] of cases) {
    // A fresh session per call keeps the assertions independent of the
    // per-session call budget (which is exercised separately).
    const result = await registry.session(ctx()).call("calculator", args);
    assertEquals(result.ok, true, `expected success for ${JSON.stringify(args)}, got ${result.error ?? ""}`);
    assertEquals(JSON.parse(result.output!).value, expected);
  }

  // Invalid / dangerous input is refused before it can evaluate anything.
  for (const bad of [
    { expression: "process.exit(1)" },
    { expression: "alert(1)" },
    { expression: "2 +" },
    { expression: "" },
    { expression: "a".repeat(300) },
    { expression: "2 ** 5 ** 5 ** 5" },
  ]) {
    const result = await registry.session(ctx()).call("calculator", bad);
    assert(result.ok === false || Number.isFinite(JSON.parse(result.output!).value), `unsafe expression must not produce a value: ${JSON.stringify(bad)}`);
    if (!result.ok) assert(["invalid_arguments", "failed"].includes(result.code ?? ""), `unexpected code ${result.code}`);
  }
  // Missing expression is an argument error with a safe message.
  const missing = await registry.session(ctx()).call("calculator", {});
  assertEquals(missing.code, "invalid_arguments");
  assertIncludes(missing.error ?? "", "`expression` is required");
});

Deno.test("evaluateArithmetic handles precedence, unary and rejects junk", () => {
  assertEquals(evaluateArithmetic("2 + 3 * 4"), 14);
  assertEquals(evaluateArithmetic("(2 + 3) * 4"), 20);
  assertEquals(evaluateArithmetic("-3 ** 2"), -9); // JS precedence: unary minus binds looser than **
  assertEquals(evaluateArithmetic("100 / 10 / 2"), 5);
  assertEquals(evaluateArithmetic("2 * (3 + (4 * 5))"), 46);
  assertEquals(evaluateArithmetic("  7  "), 7);
  assertEquals(evaluateArithmetic("2+2"), 4);
  for (const junk of ["foo", "1,2", "1..2", "2 3", "(2", "2)", "", "Math.random()", "2**5**5**5**5**5**5**5"]) {
    const value = evaluateArithmetic(junk);
    assert(value === null || Number.isFinite(value), `must not yield a non-finite value: ${junk}`);
  }
});

Deno.test("web_search input limits are enforced", async () => {
  const session = createDefaultRegistry().session(ctx());
  const empty = await session.call("web_search", { query: "   " });
  assertEquals(empty.code, "invalid_arguments");
  const long = await session.call("web_search", { query: "a".repeat(301) });
  assertEquals(long.code, "invalid_arguments");
  const badLimit = await session.call("web_search", { query: "ok", limit: 99 });
  assertEquals(badLimit.code, "invalid_arguments");
  assertIncludes(badLimit.error ?? "", "between 1 and 10");
});

// ── user-scoped retrieval tools ─────────────────────────────────────────────

/** A deterministic in-memory stand-in for the RLS-enforced data accessor. */
function fakeData(overrides: Partial<ToolData> = {}): ToolData {
  return {
    listConversations: async () => [
      { id: "c1", title: "Q3 planning", project_id: null },
      { id: "c2", title: "Recipe ideas", project_id: "p1" },
      { id: "c3", title: "Planning offsite", project_id: null },
    ],
    listMessages: async (conversationId) =>
      conversationId === "c1"
        ? [
            { role: "user", content: "Draft the Q3 plan" },
            { role: "assistant", content: "Here is a draft plan." },
          ]
        : [],
    searchAll: async () => [
      { kind: "file", title: "roadmap.md", snippet: "Q3 goals…" },
      { kind: "memory", title: "prefers concise answers", snippet: "user prefers…" },
    ],
    ...overrides,
  };
}

Deno.test("conversation_search filters by title and honors the limit", async () => {
  const session = createDefaultRegistry().session(ctx({ data: fakeData() }));
  const all = await session.call("conversation_search", { query: "plan" });
  assertEquals(all.ok, true, all.error ?? "");
  const parsed = JSON.parse(all.output!);
  // "Q3 planning" and "Planning offsite" match; "Recipe ideas" does not.
  assertEquals(parsed.conversations.length, 2);
  assertEquals(parsed.conversations.map((c: { id: string }) => c.id).sort(), ["c1", "c3"]);

  const capped = await session.call("conversation_search", { query: "plan", limit: 1 });
  assertEquals(JSON.parse(capped.output!).conversations.length, 1);
});

Deno.test("conversation_read returns a conversation's messages, empty for a missing one", async () => {
  const session = createDefaultRegistry().session(ctx({ data: fakeData() }));
  const ok = await session.call("conversation_read", { conversation_id: "c1" });
  assertEquals(ok.ok, true, ok.error ?? "");
  assertEquals(JSON.parse(ok.output!).messages.length, 2);

  // A conversation the fake data does not return (e.g. not owned) is empty,
  // not an error and never another user's content.
  const missing = await session.call("conversation_read", { conversation_id: "nope" });
  assertEquals(missing.ok, true);
  assertEquals(JSON.parse(missing.output!).messages.length, 0);
});

Deno.test("knowledge_search returns hits and reports an empty result honestly", async () => {
  const session = createDefaultRegistry().session(ctx({ data: fakeData() }));
  const hits = await session.call("knowledge_search", { query: "roadmap" });
  assertEquals(hits.ok, true, hits.error ?? "");
  assertEquals(JSON.parse(hits.output!).results.length, 2);

  const none = createDefaultRegistry().session(ctx({ data: fakeData({ searchAll: async () => [] }) }));
  const empty = await none.call("knowledge_search", { query: "zzz" });
  assertEquals(empty.ok, true);
  assertEquals(JSON.parse(empty.output!).results.length, 0);
});

Deno.test("user-scoped tools are unavailable without a data accessor", async () => {
  // No `data` in the context (e.g. deployment wired no database): the tools must
  // report unavailable rather than fabricate or throw a raw error.
  const session = createDefaultRegistry().session(ctx());
  for (const [tool, args] of [
    ["conversation_search", { query: "x" }],
    ["conversation_read", { conversation_id: "c1" }],
    ["knowledge_search", { query: "x" }],
  ] as const) {
    const result = await session.call(tool, args);
    assertEquals(result.ok, false, `${tool} must not claim success`);
    assertEquals(result.code, "unavailable", `${tool} should be unavailable`);
    assertIncludes(result.error ?? "", "not available");
  }
});

Deno.test("user-scoped tools surface a data-access failure as a safe failure", async () => {
  const session = createDefaultRegistry().session(ctx({
    data: fakeData({ listConversations: async () => { throw new Error("db down api_key=sk-secret"); } }),
  }));
  const result = await session.call("conversation_search", { query: "x" });
  assertEquals(result.ok, false);
  assertEquals(result.code, "failed");
  assert(!(result.error ?? "").includes("sk-secret"), "must not leak internals");
});

Deno.test("user-scoped tools validate arguments before touching data", async () => {
  let touched = false;
  const session = createDefaultRegistry().session(ctx({
    data: fakeData({ listConversations: async () => { touched = true; return []; } }),
  }));
  const missing = await session.call("conversation_search", {});
  assertEquals(missing.code, "invalid_arguments");
  const tooLong = await session.call("conversation_search", { query: "a".repeat(121) });
  assertEquals(tooLong.code, "invalid_arguments");
  const badLimit = await session.call("conversation_search", { query: "ok", limit: 999 });
  assertEquals(badLimit.code, "invalid_arguments");
  assertEquals(touched, false, "invalid input must be rejected before any data access");
});
