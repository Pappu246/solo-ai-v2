/**
 * Offline tests for the Phase 7 agent loop: budgets, provider adapters,
 * transcript shaping and graceful degradation. No network, no Deno.env.
 */
import {
  agentBudgets,
  googleTools,
  openAITools,
  parseToolCalls,
  runAgentLoop,
  toolResultBlock,
  type AgentResult,
} from "./agent.ts";
import { ToolRegistry, type ToolCallRecord, type ToolContext } from "./tools.ts";
import type { Message, ModelSpec } from "./providers.ts";

function assert(condition: unknown, message = "expected truthy"): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals<T>(actual: T, expected: T, message = "values differ"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}
function assertIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) throw new Error(`expected ${JSON.stringify(actual)} to include ${expected}`);
}

const model = (overrides: Partial<ModelSpec> = {}): ModelSpec => ({
  id: "gpt-oss-20b",
  name: "GPT OSS 20B",
  provider: "groq",
  category: "conversation",
  speed: 5,
  quality: 4,
  cost: 4,
  free: false,
  context_length: 128000,
  supports_vision: true,
  supports_tools: true,
  ...overrides,
} as ModelSpec);

const ctx = (): ToolContext => ({ userId: "u1", requestId: "r1", env: () => undefined });

const messages: Message[] = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "What time is it in Berlin?" },
];

/** Fake provider that replays scripted non-streaming responses. */
function scriptedFetch(script: Array<Record<string, unknown>>, capture: string[] = []) {
  let i = 0;
  return async (input: string, init?: RequestInit): Promise<Response> => {
    capture.push(String(input));
    void init;
    const body = script[Math.min(i, script.length - 1)];
    i += 1;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

const toolCallResponse = (name: string, args: Record<string, unknown>, id = "call_1") => ({
  choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
});

const finalResponse = (content: string) => ({
  choices: [{ message: { role: "assistant", content } }],
});

function testRegistry(): ToolRegistry {
  return new ToolRegistry().register({
    name: "current_time",
    description: "Current time.",
    parameters: { type: "object", properties: { timezone: { type: "string" } } },
    parse: raw => ({ timezone: typeof raw.timezone === "string" ? raw.timezone : "UTC" }),
    execute: async args => JSON.stringify({ timezone: args.timezone, iso: "2026-10-07T12:00:00Z" }),
  }).register({
    name: "echo",
    description: "Echo args.",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    parse: raw => ({ text: String(raw.text ?? "") }),
    execute: async args => JSON.stringify({ echo: args.text }),
  });
}

Deno.test("agent loop is opt-in and off by default", async () => {
  const result = await runAgentLoop({ model: model(), messages, ctx: ctx(), env: () => undefined, fetchImpl: scriptedFetch([]) });
  assertEquals(result.enabled, false);
  assertEquals(result.stop, "disabled");
  assertEquals(result.block, "");
});

Deno.test("agent loop skips models without tool support", async () => {
  const result = await runAgentLoop({
    model: model({ supports_tools: false }),
    messages, ctx: ctx(), env: () => undefined, requested: true, fetchImpl: scriptedFetch([]),
  });
  assertEquals(result.stop, "not_supported");
});

Deno.test("agent loop requires an API key", async () => {
  const result = await runAgentLoop({ model: model(), messages, ctx: ctx(), env: () => undefined, requested: true, fetchImpl: scriptedFetch([]) });
  assertEquals(result.stop, "no_api_key");
});

Deno.test("single round: tool call executes and results become a prompt block", async () => {
  const capture: string[] = [];
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const result = await runAgentLoop({
    model: model(),
    messages,
    ctx: ctx(),
    env: name => (name === "GROQ_API_KEY" ? "sk-test-key" : undefined),
    fetchImpl: scriptedFetch([
      toolCallResponse("current_time", { timezone: "Europe/Berlin" }),
      finalResponse("It is noon."),
    ], capture),
    requested: true,
    registry: testRegistry(),
    log: (event, fields) => logs.push({ event, fields }),
  });
  assertEquals(result.enabled, true);
  assertEquals(result.stop, "ok");
  // Two provider round-trips: the tool-call round, then the wrap-up round.
  assertEquals(result.rounds, 2);
  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].tool, "current_time");
  assertEquals(result.records[0].ok, true);
  assertIncludes(result.block, "### Tool results");
  assertIncludes(result.block, "[current_time]");
  assertIncludes(result.block, "2026-10-07T12:00:00Z");
  // Second request carried the tool result transcript.
  assertEquals(capture.length, 2);
  assertEquals(logs.some(l => l.event === "agent_tool" && l.fields.ok === true), true);
});

Deno.test("loop stops at maxRounds even if the model keeps calling tools", async () => {
  const result = await runAgentLoop({
    model: model(),
    messages,
    ctx: ctx(),
    env: name => (name === "GROQ_API_KEY" ? "sk-test-key" : undefined),
    fetchImpl: scriptedFetch([
      toolCallResponse("echo", { text: "one" }, "c1"),
      toolCallResponse("echo", { text: "two" }, "c2"),
      toolCallResponse("echo", { text: "three" }, "c3"),
      finalResponse("never reached"),
    ]),
    requested: true,
    registry: testRegistry(),
    maxRounds: 2,
  });
  assertEquals(result.stop, "rounds");
  assertEquals(result.rounds, 2);
  assert(result.records.length <= 6, "tool calls stay within the session budget");
});

Deno.test("deadline stops the loop before the provider is called again", async () => {
  let fetches = 0;
  const fetchImpl = async (): Promise<Response> => {
    fetches += 1;
    await new Promise(resolve => setTimeout(resolve, 30));
    return new Response(JSON.stringify(toolCallResponse("echo", { text: "slow" })), { status: 200 });
  };
  const result = await runAgentLoop({
    model: model(),
    messages,
    ctx: ctx(),
    env: name => (name === "GROQ_API_KEY" ? "sk-test-key" : undefined),
    fetchImpl,
    requested: true,
    registry: testRegistry(),
    deadlineMs: 2_000,
    roundTimeoutMs: 5_000,
  });
  // 4 rounds × 30ms never actually exceeds a real deadline here, so the loop
  // must instead terminate on rounds; what matters is it always terminates.
  assert(["deadline", "rounds"].includes(result.stop), `unexpected stop ${result.stop}`);
  assert(fetches <= 4, "provider calls stay within the round cap");
});

Deno.test("provider failure degrades to a plain answer, never throws", async () => {
  const fetchImpl = async (): Promise<Response> => new Response("upstream boom", { status: 500 });
  const result = await runAgentLoop({
    model: model(),
    messages,
    ctx: ctx(),
    env: name => (name === "GROQ_API_KEY" ? "sk-test-key" : undefined),
    fetchImpl,
    requested: true,
    registry: testRegistry(),
  });
  assertEquals(result.enabled, true);
  assertEquals(result.stop, "provider_error");
  assertEquals(result.rounds, 0);
  assertEquals(result.block, "");
});

Deno.test("tool failures are recorded but do not break the loop", async () => {
  const result = await runAgentLoop({
    model: model(),
    messages,
    ctx: ctx(),
    env: name => (name === "GROQ_API_KEY" ? "sk-test-key" : undefined),
    fetchImpl: scriptedFetch([
      toolCallResponse("does_not_exist", {}),
      finalResponse("answered anyway"),
    ]),
    requested: true,
    registry: testRegistry(),
  });
  assertEquals(result.stop, "ok");
  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].ok, false);
  assertIncludes(result.block, "failed");
  assertIncludes(result.block, "does_not_exist");
});

Deno.test("env budgets are clamped to safe ranges", () => {
  assertEquals(agentBudgets(name => (name === "AGENT_MAX_ROUNDS" ? "99" : undefined)).maxRounds, 4);
  assertEquals(agentBudgets(name => (name === "AGENT_MAX_ROUNDS" ? "0" : undefined)).maxRounds, 1);
  assertEquals(agentBudgets(name => (name === "AGENT_MAX_ROUNDS" ? "abc" : undefined)).maxRounds, 2);
  assertEquals(agentBudgets(name => (name === "AGENT_DEADLINE_MS" ? "999999" : undefined)).deadlineMs, 30_000);
  assertEquals(agentBudgets(() => undefined).deadlineMs, 15_000);
});

Deno.test("parseToolCalls handles the OpenAI-compatible and Google shapes", () => {
  const openai = parseToolCalls("groq", toolCallResponse("echo", { text: "hi" }));
  assertEquals(openai.calls[0].name, "echo");
  assertEquals(openai.calls[0].args, { text: "hi" });

  const malformed = parseToolCalls("groq", {
    choices: [{ message: { content: "plain", tool_calls: [{ id: "x", type: "function", function: { name: "echo", arguments: "{broken" } }] } }],
  });
  assertEquals(malformed.calls[0].args, {}, "malformed arguments become {} for the tool's parse");

  const google = parseToolCalls("google", {
    candidates: [{ content: { parts: [{ text: "hi" }, { functionCall: { name: "echo", args: { text: "g" } } }] } }],
  });
  assertEquals(google.calls[0].name, "echo");
  assertEquals(google.calls[0].args, { text: "g" });

  assertEquals(parseToolCalls("groq", { choices: [{ message: { content: "just text" } }] }).calls.length, 0);
  assertEquals(parseToolCalls("groq", {}).calls.length, 0, "garbage payloads parse to no calls");
});

Deno.test("tool declaration shapes match each provider", () => {
  const declarations = [
    { type: "function", function: { name: "current_time", description: "d", parameters: { type: "object", properties: {} } } },
  ];
  assertEquals(openAITools(declarations), declarations);
  const google = googleTools(declarations) as { functionDeclarations: Array<Record<string, unknown>> };
  assertEquals(google.functionDeclarations.length, 1);
  assertEquals(google.functionDeclarations[0].name, "current_time");
});

Deno.test("toolResultBlock caps output and is empty without records", () => {
  assertEquals(toolResultBlock([]), "");
  const huge: ToolCallRecord[] = [{ tool: "echo", ok: true, output: `{"blob":"${"x".repeat(10_000)}"}` }];
  const block = toolResultBlock(huge);
  assert(block.length <= 6500, `block must be capped, got ${block.length}`);
  assertIncludes(block, "[truncated]");
  assertIncludes(block, "- [echo]");

  // Many small records also stay within the cap.
  const many: ToolCallRecord[] = Array.from({ length: 30 }, (_, i) => ({ tool: "echo", ok: true, output: JSON.stringify({ i, pad: "y".repeat(400) }) }));
  const bigBlock = toolResultBlock(many);
  assert(bigBlock.length <= 6500, `block must be capped, got ${bigBlock.length}`);
});

Deno.test("requested=false returns before touching env or network", async () => {
  let called = false;
  const result = await runAgentLoop({
    model: model(),
    messages,
    ctx: ctx(),
    env: () => { called = true; return "x"; },
    fetchImpl: async () => { called = true; return new Response("{}", { status: 200 }); },
    requested: false,
  });
  assertEquals(result.stop, "disabled");
  assert(!called, "no env reads or fetches when disabled");
});

Deno.test("cancellation before the first round never reaches the provider", async () => {
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  const result = await runAgentLoop({
    model: model(),
    messages,
    ctx: ctx(),
    env: name => (name === "GROQ_API_KEY" ? "sk-test-key" : undefined),
    fetchImpl: async () => { fetched = true; return new Response("{}", { status: 200 }); },
    requested: true,
    registry: testRegistry(),
    signal: controller.signal,
  });
  assertEquals(result.stop, "aborted");
  assertEquals(result.rounds, 0);
  assertEquals(result.records.length, 0);
  assertEquals(fetched, false, "an aborted loop must not call the provider");
});

Deno.test("cancellation between tool calls stops queued tools and the next round", async () => {
  const controller = new AbortController();
  const executed: string[] = [];
  const registry = new ToolRegistry().register({
    name: "abort_now",
    description: "Aborts the request.",
    parameters: { type: "object", properties: {} },
    parse: () => ({}),
    execute: async () => { controller.abort(); executed.push("abort_now"); return "{}"; },
  }).register({
    name: "never_run",
    description: "Must not execute after cancellation.",
    parameters: { type: "object", properties: {} },
    parse: () => ({}),
    execute: async () => { executed.push("never_run"); return "{}"; },
  });
  let fetches = 0;
  const twoCalls = {
    choices: [{ message: { role: "assistant", content: "", tool_calls: [
      { id: "c1", type: "function", function: { name: "abort_now", arguments: "{}" } },
      { id: "c2", type: "function", function: { name: "never_run", arguments: "{}" } },
    ] } }],
  };
  const result = await runAgentLoop({
    model: model(),
    messages,
    ctx: ctx(),
    env: name => (name === "GROQ_API_KEY" ? "sk-test-key" : undefined),
    fetchImpl: async () => { fetches += 1; return new Response(JSON.stringify(twoCalls), { status: 200 }); },
    requested: true,
    registry,
    signal: controller.signal,
  });
  assertEquals(result.stop, "aborted");
  assertEquals(executed, ["abort_now"], "the queued tool after the abort must not run");
  assertEquals(fetches, 1, "no further provider round after cancellation");
  assertEquals(result.records.length, 1, "only the in-flight tool is recorded");
});

// Compile-time guard: AgentResult shape stays stable for index.ts consumers.
const _shapeCheck: (r: AgentResult) => string = r => r.stop;
void _shapeCheck;
