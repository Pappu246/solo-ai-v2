/**
 * Phase 7: agent mode with budgets.
 *
 * A bounded pre-answer loop: the model may call registered tools (Phase 6
 * registry) a limited number of times, then the final answer streams through
 * the normal path. Safety properties:
 *
 *  - opt-in only (`agent: true` from the client) and only for models that
 *    declare `supports_tools`;
 *  - rounds are capped (AGENT_MAX_ROUNDS, default 2, hard max 4);
 *  - the whole loop runs under a wall-clock deadline (AGENT_DEADLINE_MS,
 *    default 15s, hard max 30s) and each provider call has its own timeout;
 *  - tool calls themselves are budgeted by `ToolSession` (Phase 6);
 *  - tool outputs are injected into the system prompt as a numbered block —
 *    the browser only ever sees the normal streamed answer, so a failing
 *    agent loop degrades to a plain answer instead of a broken stream.
 *
 * Everything is dependency-injected (env, fetchImpl) so the offline test
 * suite is deterministic.
 */

import {
  apiKeyFor,
  buildProviderRequest,
  redactSecrets,
  type EnvReader,
  type FetchLike,
  type Message,
  type ModelSpec,
} from "./providers.ts";
import {
  createDefaultRegistry,
  type ToolCallRecord,
  type ToolContext,
  type ToolRegistry,
} from "./tools.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentRound {
  round: number;
  /** Provider-declared text for this round (may be empty). */
  text: string;
  calls: AgentToolCall[];
}

export interface AgentResult {
  enabled: boolean;
  /** Reason the loop did not run or stopped, for structured logs. */
  stop: "ok" | "disabled" | "not_supported" | "no_api_key" | "deadline" | "rounds" | "provider_error";
  rounds: number;
  /** Tool call records (successes and failures) in call order. */
  records: ToolCallRecord[];
  /** Numbered tool-result block to append to the system prompt ("" if none). */
  block: string;
  /** Wall-clock time spent in the loop. */
  durationMs: number;
}

export interface AgentOptions {
  model: ModelSpec;
  messages: Message[];
  ctx: ToolContext;
  env: EnvReader;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  /** Opt-in flag from the client (`body.agent === true`). */
  requested?: boolean;
  registry?: ToolRegistry;
  maxRounds?: number;
  deadlineMs?: number;
  /** Per provider round-trip timeout. */
  roundTimeoutMs?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

// ── Budget helpers ──────────────────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 2;
const HARD_MAX_ROUNDS = 4;
const DEFAULT_DEADLINE_MS = 15_000;
const HARD_MAX_DEADLINE_MS = 30_000;
const DEFAULT_ROUND_TIMEOUT_MS = 8_000;

function intFromEnv(env: EnvReader, name: string, def: number, min: number, max: number): number {
  const raw = Number(env(name));
  if (!Number.isFinite(raw)) return def;
  return Math.min(Math.max(Math.floor(raw), min), max);
}

export function agentBudgets(env: EnvReader): { maxRounds: number; deadlineMs: number } {
  return {
    maxRounds: intFromEnv(env, "AGENT_MAX_ROUNDS", DEFAULT_MAX_ROUNDS, 1, HARD_MAX_ROUNDS),
    deadlineMs: intFromEnv(env, "AGENT_DEADLINE_MS", DEFAULT_DEADLINE_MS, 2_000, HARD_MAX_DEADLINE_MS),
  };
}

// ── Provider tool-shape adapters ────────────────────────────────────────────

/** OpenAI-style `tools` array for chat-completions providers. */
export function openAITools(declarations: unknown[]): unknown {
  return declarations;
}

/** Anthropic `tools` array (input_schema instead of parameters). */
export function anthropicTools(declarations: Array<{ function: { name: string; description: string; parameters: unknown } }>): unknown {
  return declarations.map(d => ({
    name: d.function.name,
    description: d.function.description,
    input_schema: d.function.parameters,
  }));
}

/** Google `functionDeclarations` wrapper (already one object; see providers.ts). */
export function googleTools(declarations: Array<{ function: { name: string; description: string; parameters: unknown } }>): unknown {
  return {
    functionDeclarations: declarations.map(d => ({
      name: d.function.name,
      description: d.function.description,
      parameters: d.function.parameters,
    })),
  };
}

/** Parse a provider's non-streaming response into text + tool calls. */
export function parseToolCalls(provider: ModelSpec["provider"], payload: unknown): { text: string; calls: AgentToolCall[] } {
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const calls: AgentToolCall[] = [];
  let text = "";

  if (provider === "anthropic") {
    const content = Array.isArray(record.content) ? record.content : [];
    for (const block of content) {
      const b = (block && typeof block === "object" ? block : {}) as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") text += b.text;
      if (b.type === "tool_use") {
        calls.push({
          id: String(b.id ?? `tool_${calls.length}`),
          name: String(b.name ?? ""),
          args: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>,
        });
      }
    }
    return { text, calls: calls.filter(c => c.name) };
  }

  if (provider === "google") {
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    const parts = ((candidates[0] as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined)?.parts;
    for (const part of Array.isArray(parts) ? parts : []) {
      const p = (part && typeof part === "object" ? part : {}) as Record<string, unknown>;
      if (typeof p.text === "string") text += p.text;
      const fn = p.functionCall as Record<string, unknown> | undefined;
      if (fn && typeof fn.name === "string") {
        calls.push({ id: `call_${calls.length}`, name: fn.name, args: (fn.args && typeof fn.args === "object" ? fn.args : {}) as Record<string, unknown> });
      }
    }
    return { text, calls };
  }

  // openai / groq / deepseek
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const message = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
  if (message) {
    if (typeof message.content === "string") text = message.content;
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const tc of toolCalls) {
      const t = (tc && typeof tc === "object" ? tc : {}) as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      if (!fn || typeof fn.name !== "string") continue;
      let args: Record<string, unknown> = {};
      if (typeof fn.arguments === "string" && fn.arguments.trim()) {
        try {
          const parsed: unknown = JSON.parse(fn.arguments);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch { /* malformed arguments are caught by the tool's parse() */ }
      }
      calls.push({ id: String(t.id ?? `call_${calls.length}`), name: fn.name, args });
    }
  }
  return { text, calls };
}

// ── The loop ────────────────────────────────────────────────────────────────

/**
 * Run the bounded tool loop. Never throws: any failure returns a result with
 * `stop` set so the caller can log it and continue with a plain answer.
 */
export async function runAgentLoop(options: AgentOptions): Promise<AgentResult> {
  const started = Date.now();
  const { env, model, messages, ctx } = options;
  const empty = (stop: AgentResult["stop"]): AgentResult => ({
    enabled: false, stop, rounds: 0, records: [], block: "", durationMs: Date.now() - started,
  });

  if (!options.requested) return empty("disabled");
  if (!model.supports_tools) return empty("not_supported");

  const budgets = agentBudgets(env);
  const maxRounds = Math.min(Math.max(options.maxRounds ?? budgets.maxRounds, 1), HARD_MAX_ROUNDS);
  const deadlineMs = Math.min(Math.max(options.deadlineMs ?? budgets.deadlineMs, 2_000), HARD_MAX_DEADLINE_MS);
  const roundTimeoutMs = Math.min(Math.max(options.roundTimeoutMs ?? DEFAULT_ROUND_TIMEOUT_MS, 1_000), 20_000);

  const apiKey = apiKeyFor(model.provider, env);
  if (!apiKey) return empty("no_api_key");

  const registry = options.registry ?? createDefaultRegistry();

  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const session = registry.session(ctx, { maxCalls: 6 });
  const declarations = registry.declarations();
  const tools = toolsFor(model, declarations);

  const history: Message[] = [...messages];
  const records: ToolCallRecord[] = [];
  const rounds: AgentRound[] = [];
  let stop: AgentResult["stop"] = "ok";
  const deadline = started + deadlineMs;

  for (let round = 1; round <= maxRounds; round++) {
    if (Date.now() > deadline) { stop = "deadline"; break; }
    if (options.signal?.aborted) { stop = "provider_error"; break; }

    const { url, init } = buildProviderRequest(model, history, apiKey, { tools, stream: false });
    let payload: unknown;
    try {
      payload = await fetchJson(url, init, fetchImpl, Math.min(roundTimeoutMs, Math.max(deadline - Date.now(), 1_000)), options.signal);
    } catch (error) {
      options.log?.("agent_round_failed", { round, error: redactSecrets(error instanceof Error ? `${error.name}: ${error.message}` : String(error)) });
      stop = Date.now() > deadline ? "deadline" : "provider_error";
      break;
    }

    const { text, calls } = parseToolCalls(model.provider, payload);
    rounds.push({ round, text, calls });
    options.log?.("agent_round", { round, callCount: calls.length, textChars: text.length });

    if (!calls.length) { stop = "ok"; break; }
    if (round === maxRounds) stop = "rounds";

    // Record the assistant turn so the provider sees a coherent transcript.
    history.push(assistantTurn(model.provider, text, calls));

    for (const call of calls) {
      if (Date.now() > deadline) { stop = "deadline"; break; }
      const result = await session.call(call.name, call.args);
      records.push({ tool: result.tool, ok: result.ok, ...(result.ok ? { output: result.output } : { error: result.error }) });
      history.push(toolTurn(model.provider, call, result));
      options.log?.("agent_tool", { tool: call.name, ok: result.ok, code: result.code, durationMs: result.durationMs });
    }
    if (stop === "deadline") break;
  }

  return {
    enabled: true,
    stop,
    rounds: rounds.length,
    records,
    block: toolResultBlock(records),
    durationMs: Date.now() - started,
  };
}

// ── Transcript shaping ──────────────────────────────────────────────────────

function toolsFor(model: ModelSpec, declarations: unknown[]): unknown {
  if (model.provider === "anthropic") return anthropicTools(declarations as Array<{ function: { name: string; description: string; parameters: unknown } }>);
  if (model.provider === "google") return googleTools(declarations as Array<{ function: { name: string; description: string; parameters: unknown } }>);
  return openAITools(declarations);
}

function assistantTurn(provider: ModelSpec["provider"], text: string, calls: AgentToolCall[]): Message {
  if (provider === "anthropic") {
    return {
      role: "assistant",
      content: [
        ...(text ? [{ type: "text", text }] : []),
        ...calls.map(c => ({ type: "tool_use", id: c.id, name: c.name, input: c.args })),
      ],
    };
  }
  if (provider === "google") {
    return {
      role: "assistant",
      content: [
        ...(text ? [{ text }] : []),
        ...calls.map(c => ({ functionCall: { name: c.name, args: c.args } })),
      ],
    };
  }
  // openai-compatible
  return {
    role: "assistant",
    content: text || null,
    // carried through JSON.stringify as-is
    ...({ tool_calls: calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } as Record<string, unknown>),
  } as Message;
}

function toolTurn(provider: ModelSpec["provider"], call: AgentToolCall, result: { ok: boolean; output?: string; error?: string }): Message {
  const content = result.ok ? (result.output ?? "[]") : JSON.stringify({ error: result.error });
  if (provider === "anthropic") {
    return { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content }] };
  }
  if (provider === "google") {
    return { role: "user", content: [{ functionResponse: { name: call.name, response: { result: content } } }] };
  }
  return { role: "tool", tool_call_id: call.id, content } as unknown as Message;
}

// ── Result block for the system prompt ──────────────────────────────────────

const MAX_BLOCK_CHARS = 6000;

/** Numbered tool-result block, appended to the system prompt by the caller. */
export function toolResultBlock(records: ToolCallRecord[]): string {
  if (!records.length) return "";
  const header = [
    "",
    "",
    "### Tool results",
    "The following tool calls ran before you answered. Use them as evidence;",
  ];
  const footer = "Never invent tool results; if a tool failed, answer from what you know.";
  let used = header.join("\n").length + footer.length;
  const kept: string[] = [];
  for (const record of records) {
    const payload = record.ok ? (record.output ?? "") : JSON.stringify({ error: record.error });
    let line = `- [${record.tool}] ${record.ok ? payload : `failed — ${record.error ?? "unknown error"}`}`;
    const room = MAX_BLOCK_CHARS - used - kept.length;
    if (room < 64) break;
    if (line.length > room) line = `${line.slice(0, Math.max(0, room - 16))}…[truncated]`;
    kept.push(line);
    used += line.length + 1;
  }
  if (!kept.length) return "";
  return [...header, ...kept, footer].join("\n");
}

// ── HTTP helper ─────────────────────────────────────────────────────────────

async function fetchJson(url: string, init: RequestInit, fetchImpl: FetchLike, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort((signal as { reason?: unknown } | undefined)?.reason);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException("Agent round timeout", "TimeoutError")), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${body.slice(0, 300)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
