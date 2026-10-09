import {
  MAX_ARGS_CHARS,
  MAX_OUTPUT_CHARS,
  ToolInputError,
  ToolRegistry,
  ToolUnavailableError,
  createDefaultRegistry,
  sanitizeOutput,
  type ToolContext,
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
  assertEquals(declarations.length, 2);
  const names = declarations.map(d => d.function.name).sort();
  assertEquals(names, ["current_time", "web_search"]);
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
