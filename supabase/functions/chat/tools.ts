/**
 * Phase 6: safe tool registry.
 *
 * A tool is a server-side capability the model may invoke (Phase 7's agent
 * loop drives it). Everything about the design is deny-by-default:
 *
 *  - Tools only exist if registered; names must match `^[a-z][a-z0-9_]{0,63}$`
 *    (so `__proto__`, paths and provider identifiers can never be tool names).
 *  - Arguments are size-capped JSON objects validated by each tool's `parse`;
 *    failures surface as safe, actionable messages — never raw exceptions.
 *  - Every call runs under a per-session budget and a per-tool timeout, so a
 *    looping model cannot pin an isolate or burn the usage quota.
 *  - Outputs are JSON-serialized and length-capped before they reach the
 *    model; thrown errors become generic reasons and are only logged through
 *    the redaction helpers.
 *
 * The registry is pure (no Deno.env, no global fetch): dependencies arrive
 * through `ToolContext`, which keeps the offline test suite deterministic.
 */

import type { FetchLike } from "../web-search/safeFetch.ts";
import { createWebSearchProvider, normalizeSources } from "../web-search/providers.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ToolParameters {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
}

export interface ToolContext {
  userId: string;
  requestId: string;
  /** Environment reader (Deno.env.get in production, injected in tests). */
  env: (name: string) => string | undefined;
  /** Outbound HTTP; injected so tests never touch the network. */
  fetchImpl?: FetchLike;
  /** Structured log sink; receives already-redacted fields. */
  log?: (event: string, fields: Record<string, unknown>) => void;
  /**
   * Optional read-only, user-scoped data accessor (RLS-enforced Supabase
   * client in production, injected fake in tests). When absent the retrieval
   * tools report themselves as unavailable rather than failing or guessing.
   * It is deliberately read-only: the interface exposes no writes, so no tool
   * can mutate state through it.
   */
  data?: ToolData;
}

/**
 * A read-only, user-scoped view of the caller's workspace. Every method is
 * implicitly bounded by Row Level Security on the server, and the edge layer
 * additionally clamps `limit` and caps result length, so a tool cannot be used
 * to read another user's data or to pull an unbounded payload into context.
 */
export interface ToolData {
  /** RLS-scoped `conversations` rows (id, title, project_id, updated_at). */
  listConversations(limit: number): Promise<Array<{ id: string; title: string; project_id: string | null }>>;
  /** RLS-scoped `messages` for one of the caller's conversations. */
  listMessages(conversationId: string, limit: number): Promise<Array<{ role: string; content: string }>>;
  /** RLS-scoped `search_all` RPC across the caller's files/projects/memories. */
  searchAll(query: string, limit: number): Promise<Array<{ kind: string; title: string; snippet: string }>>;
}

export interface ToolSpec<A> {
  name: string;
  description: string;
  parameters: ToolParameters;
  /** Validate + coerce raw arguments; throw `ToolInputError` with safe copy. */
  parse: (raw: Record<string, unknown>) => A;
  /** Perform the action and return the JSON/text payload handed to the model. */
  execute: (args: A, ctx: ToolContext) => Promise<string>;
  timeoutMs?: number;
}

export interface ToolDeclaration {
  type: "function";
  function: { name: string; description: string; parameters: ToolParameters };
}

export type ToolFailureCode =
  | "budget_exhausted"
  | "unknown_tool"
  | "invalid_arguments"
  | "timeout"
  | "unavailable"
  | "failed";

export interface ToolResult {
  ok: boolean;
  tool: string;
  /** JSON/text payload for the model when `ok`. */
  output?: string;
  /** Safe, user-readable failure reason when `!ok`. */
  error?: string;
  code?: ToolFailureCode;
  durationMs: number;
}

/** A parse/validation failure whose message is safe to show the model. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** A capability that is deliberately switched off / unconfigured. */
export class ToolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolUnavailableError";
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
/** Serialized argument budget — models occasionally dump whole documents. */
export const MAX_ARGS_CHARS = 4096;
/** Serialized output budget — protects the follow-up request's context. */
export const MAX_OUTPUT_CHARS = 8000;
const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15_000;
const MAX_DESCRIPTION_CHARS = 500;

// ── Argument helpers (shared by tool `parse` implementations) ───────────────

export function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolInputError("Arguments must be a JSON object.");
  }
  return raw as Record<string, unknown>;
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  opts: { min?: number; max: number },
): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`\`${key}\` is required and must be a non-empty string.`);
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  const min = opts.min ?? 1;
  if (trimmed.length < min) throw new ToolInputError(`\`${key}\` must be at least ${min} characters.`);
  if (trimmed.length > opts.max) throw new ToolInputError(`\`${key}\` must be at most ${opts.max} characters.`);
  return trimmed;
}

export function optionalInt(
  obj: Record<string, unknown>,
  key: string,
  opts: { min: number; max: number; def: number },
): number {
  const value = obj[key];
  if (value === undefined || value === null) return opts.def;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ToolInputError(`\`${key}\` must be an integer.`);
  }
  if (n < opts.min || n > opts.max) {
    throw new ToolInputError(`\`${key}\` must be between ${opts.min} and ${opts.max}.`);
  }
  return n;
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  max: number,
): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolInputError(`\`${key}\` must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new ToolInputError(`\`${key}\` must be at most ${max} characters.`);
  return trimmed;
}

// ── Registry ────────────────────────────────────────────────────────────────

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec<unknown>>();

  register<A>(spec: ToolSpec<A>): this {
    if (!TOOL_NAME_RE.test(spec.name)) {
      throw new Error(`Invalid tool name: ${spec.name}`);
    }
    if (this.tools.has(spec.name)) {
      throw new Error(`Duplicate tool: ${spec.name}`);
    }
    if (!spec.description || spec.description.length > MAX_DESCRIPTION_CHARS) {
      throw new Error(`Tool ${spec.name} needs a description of 1..${MAX_DESCRIPTION_CHARS} chars`);
    }
    const timeout = Math.min(Math.max(spec.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
    this.tools.set(spec.name, { ...spec, timeoutMs: timeout } as ToolSpec<unknown>);
    return this;
  }

  has(name: string): boolean {
    return TOOL_NAME_RE.test(name) && this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** OpenAI-style tool declarations for a provider `tools` parameter. */
  declarations(): ToolDeclaration[] {
    return [...this.tools.values()].map(tool => ({
      type: "function" as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }

  session(ctx: ToolContext, options: { maxCalls?: number } = {}): ToolSession {
    return new ToolSession(this, ctx, options);
  }

  /** @internal resolved only after the name pattern check. */
  resolve(name: string): ToolSpec<unknown> | null {
    if (!TOOL_NAME_RE.test(name)) return null;
    return this.tools.get(name) ?? null;
  }
}

// ── Session (budgeted execution) ────────────────────────────────────────────

export interface ToolCallRecord {
  tool: string;
  ok: boolean;
  output?: string;
  error?: string;
}

const DEFAULT_MAX_CALLS = 6;

export class ToolSession {
  private readonly records: ToolCallRecord[] = [];
  private calls = 0;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly ctx: ToolContext,
    private readonly options: { maxCalls?: number } = {},
  ) {}

  get used(): number {
    return this.calls;
  }

  get remaining(): number {
    return Math.max(0, this.maxCalls - this.calls);
  }

  private get maxCalls(): number {
    const requested = this.options.maxCalls ?? DEFAULT_MAX_CALLS;
    return Math.min(Math.max(Math.floor(requested) || 0, 0), 20);
  }

  history(): ToolCallRecord[] {
    return this.records.map(r => ({ ...r }));
  }

  async call(name: string, rawArgs: unknown): Promise<ToolResult> {
    const started = Date.now();
    this.calls += 1;
    const done = (result: Omit<ToolResult, "tool" | "durationMs">): ToolResult => ({
      tool: name,
      durationMs: Date.now() - started,
      ...result,
    });

    if (this.calls > this.maxCalls) {
      return done({
        ok: false,
        code: "budget_exhausted",
        error: `Tool budget exhausted (${this.maxCalls} calls per request). Answer with what you have.`,
      });
    }

    const spec = this.registry.resolve(name);
    if (!spec) {
      return done({ ok: false, code: "unknown_tool", error: `Unknown tool \`${String(name).slice(0, 64)}\`.` });
    }

    let record: ToolCallRecord = { tool: name, ok: false };
    try {
      const args = spec.parse(this.coerceArgs(rawArgs));
      const output = await withTimeout(spec.execute(args, this.ctx), spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const safeOutput = sanitizeOutput(typeof output === "string" ? output : JSON.stringify(output));
      record = { tool: name, ok: true, output: safeOutput };
      this.records.push(record);
      this.ctx.log?.("tool_call_ok", { tool: name, durationMs: Date.now() - started, chars: safeOutput.length });
      return done({ ok: true, output: safeOutput });
    } catch (error) {
      const failure = classifyFailure(error, name, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      record = { tool: name, ok: false, error: failure.error };
      this.records.push(record);
      this.ctx.log?.("tool_call_failed", {
        tool: name,
        code: failure.code,
        durationMs: Date.now() - started,
        error: redact(error),
      });
      return done({ ok: false, code: failure.code, error: failure.error });
    }
  }

  private coerceArgs(raw: unknown): Record<string, unknown> {
    let value = raw;
    if (typeof value === "string") {
      if (value.length > MAX_ARGS_CHARS) {
        throw new ToolInputError(`Arguments exceed ${MAX_ARGS_CHARS} characters.`);
      }
      try {
        value = JSON.parse(value);
      } catch {
        throw new ToolInputError("Arguments must be valid JSON.");
      }
    }
    if (value === undefined || value === null) value = {};
    const json = safeStringify(value);
    if (json.length > MAX_ARGS_CHARS) {
      throw new ToolInputError(`Arguments exceed ${MAX_ARGS_CHARS} characters.`);
    }
    return asObject(value);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function classifyFailure(
  error: unknown,
  tool: string,
  timeoutMs: number,
): { code: ToolFailureCode; error: string } {
  if (error instanceof ToolInputError) return { code: "invalid_arguments", error: error.message };
  if (error instanceof ToolUnavailableError) return { code: "unavailable", error: error.message };
  if (error instanceof ToolTimeoutError) {
    return { code: "timeout", error: `The \`${tool}\` tool timed out after ${Math.round(timeoutMs / 1000)}s. Answer without it.` };
  }
  return { code: "failed", error: `The \`${tool}\` tool failed. Answer without it, or try a different call.` };
}

class ToolTimeoutError extends Error {
  constructor() {
    super("Tool timed out");
    this.name = "ToolTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolTimeoutError()), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/** JSON-stringify with graceful fallback for circular/throwing values. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "\"[unserializable]\"";
  }
}

/** Cap model-facing output; overlong payloads are truncated, not dropped. */
export function sanitizeOutput(json: string): string {
  if (json.length <= MAX_OUTPUT_CHARS) return json;
  return `${json.slice(0, MAX_OUTPUT_CHARS - 16)}…[truncated]`;
}

/** Strip anything secret-looking out of a logged error string. */
function redact(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/(api[_-]?key|token|secret|password|bearer)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}

// ── Built-in tools ──────────────────────────────────────────────────────────

const current_time: ToolSpec<{ timezone?: string }> = {
  name: "current_time",
  description: "Get the current date and time, optionally in a specific IANA timezone.",
  parameters: {
    type: "object",
    properties: {
      timezone: { type: "string", description: "IANA timezone, e.g. Europe/Berlin. Defaults to UTC." },
    },
  },
  parse: raw => {
    const timezone = optionalString(raw, "timezone", 64) ?? "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      throw new ToolInputError(`\`timezone\` is not a valid IANA timezone: ${timezone}`);
    }
    return { timezone };
  },
  execute: async args => {
    const now = new Date();
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: args.timezone,
      dateStyle: "full",
      timeStyle: "long",
    }).format(now);
    return JSON.stringify({ timezone: args.timezone, iso: now.toISOString(), local });
  },
};

const web_search: ToolSpec<{ query: string; limit: number }> = {
  name: "web_search",
  description: "Search the web and return up-to-date sources (title, URL, domain, snippet). Use for news, current events, or facts you are unsure about.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query, 1-300 characters." },
      limit: { type: "integer", description: "How many sources to return (1-10, default 6)." },
    },
    required: ["query"],
  },
  timeoutMs: 8000,
  parse: raw => ({
    query: requireString(raw, "query", { max: 300 }),
    limit: optionalInt(raw, "limit", { min: 1, max: 10, def: 6 }),
  }),
  execute: async (args, ctx) => {
    const provider = createWebSearchProvider(ctx.env, ctx.fetchImpl);
    if (!provider) {
      throw new ToolUnavailableError("Web search is not configured on this workspace.");
    }
    const raw = await provider.search(args.query, args.limit);
    const sources = normalizeSources(raw, { max: args.limit, maxPerDomain: 2 });
    if (!sources.length) return JSON.stringify({ sources: [], note: "No results found." });
    return JSON.stringify({ sources });
  },
};

const calculator: ToolSpec<{ expression: string }> = {
  name: "calculator",
  description: "Evaluate an arithmetic expression (+ - * / % ** parentheses, unary minus). Returns the numeric result. Use for math you cannot do reliably in your head.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Arithmetic expression, e.g. `2 * (3 + 4)`." },
    },
    required: ["expression"],
  },
  timeoutMs: 2000,
  parse: raw => ({ expression: requireString(raw, "expression", { max: 200 }) }),
  execute: async args => {
    const value = evaluateArithmetic(args.expression);
    if (value === null) throw new ToolInputError(`\`expression\` is not a valid arithmetic expression: ${args.expression}`);
    if (!Number.isFinite(value)) throw new ToolInputError("The expression did not evaluate to a finite number.");
    return JSON.stringify({ expression: args.expression, value });
  },
};

/**
 * A tiny, dependency-free arithmetic evaluator. It never touches the network,
 * the filesystem or eval — only a fixed grammar of numbers and operators, so
 * an untrusted model cannot reach anything through it.
 */
export function evaluateArithmetic(input: string): number | null {
  const tokens = tokenizeArithmetic(input);
  if (!tokens) return null;
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = (tok: string) => { if (tokens[pos] === tok) { pos++; return true; } return false; };

  // Shared descent budget: every recursive step consumes one, so no input
  // (however deeply nested or chained) can blow the stack or loop forever.
  // 200 tokens can never need more than ~400 steps, so this is generous.
  let budget = 400;
  const spend = (): boolean => (--budget >= 0);

  const parsePrimary = (): number | null => {
    if (!spend()) return null;
    const tok = peek();
    if (tok === undefined) return null;
    if (tok === "(") {
      pos++;
      const v = parseAddSub();
      if (v === null || !eat(")")) return null;
      return v;
    }
    if (tok === "+") { pos++; return parsePrimary(); }
    if (tok === "-") { pos++; const v = parsePrimary(); return v === null ? null : -v; }
    if (/^\d+(\.\d+)?$/.test(tok)) { pos++; return Number(tok); }
    return null;
  };

  const parseUnary = (): number | null => {
    if (!spend()) return null;
    let sign = 1;
    while (peek() === "-" || peek() === "+") {
      if (peek() === "-") sign = -sign;
      pos++;
    }
    const v = parsePower();
    return v === null ? null : sign * v;
  };

  // `**` is right-associative and binds tighter than unary minus, so
  // `-3 ** 2 === -(3 ** 2) === -9` (JS semantics). The exponent is parsed as
  // a unary/power chain, so `2 ** -1` works while `2 ** 5 ** 5` stays bounded
  // by the shared descent budget instead of recursing forever.
  const parsePower = (): number | null => {
    if (!spend()) return null;
    const base = parsePrimary();
    if (base === null) return null;
    if (peek() !== "**") return base;
    pos++;
    const exp = parseUnary();
    if (exp === null) return null;
    return base ** exp;
  };

  const parseMulDiv = (): number | null => {
    let left = parseUnary();
    if (left === null) return null;
    for (;;) {
      const op = peek();
      if (op !== "*" && op !== "/" && op !== "%") return left;
      pos++;
      const right = parseUnary();
      if (right === null) return null;
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
  };

  const parseAddSub = (): number | null => {
    let left = parseMulDiv();
    if (left === null) return null;
    for (;;) {
      const op = peek();
      if (op !== "+" && op !== "-") return left;
      pos++;
      const right = parseMulDiv();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
  };

  const value = parseAddSub();
  if (value === null || pos !== tokens.length) return null;
  // Overflow from exponent chains yields Infinity/NaN; report as unparseable
  // so the tool refuses rather than returning a meaningless number.
  return Number.isFinite(value) ? value : null;
}

function tokenizeArithmetic(input: string): string[] | null {
  const src = input.replace(/\s+/g, "");
  if (!src || src.length > 200) return null;
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "(") { tokens.push(ch); i++; continue; }
    if (ch === ")") { tokens.push(ch); i++; continue; }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%") {
      // `**` is a single power operator.
      if (ch === "*" && src[i + 1] === "*") { tokens.push("**"); i += 2; continue; }
      tokens.push(ch); i++; continue;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { tokens.push(num[0]); i += num[0].length; continue; }
    return null; // any other character (letters, dots, commas…) is rejected
  }
  return tokens;
}

/**
 * Guard for the user-scoped tools: without a `data` accessor the tool cannot
 * honestly claim it can read anything, so it reports itself unavailable instead
 * of throwing or returning fabricated results.
 */
function requireData(ctx: ToolContext): ToolData {
  if (!ctx.data) {
    throw new ToolUnavailableError(
      "Workspace search is not available in this deployment.",
    );
  }
  return ctx.data;
}

/** Clamp a caller-supplied result window; models sometimes overshoot. */
function clampLimit(value: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

const conversation_search: ToolSpec<{ query: string; limit: number }> = {
  name: "conversation_search",
  description: "Search the user's own saved conversations by title. Returns matching conversation ids and titles only (never message bodies). Use to resume or reference a past chat.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Title substring to match, 1-120 characters." },
      limit: { type: "integer", description: "Max conversations to return (1-20, default 8)." },
    },
    required: ["query"],
  },
  timeoutMs: 4000,
  parse: raw => ({
    query: requireString(raw, "query", { max: 120 }),
    limit: optionalInt(raw, "limit", { min: 1, max: 20, def: 8 }),
  }),
  execute: async (args, ctx) => {
    const data = requireData(ctx);
    const limit = clampLimit(args.limit, 20);
    const all = await data.listConversations(limit * 4);
    const needle = args.query.toLowerCase();
    const matches = all
      .filter(c => c.title.toLowerCase().includes(needle))
      .slice(0, limit)
      .map(c => ({ id: c.id, title: c.title, project_id: c.project_id }));
    if (!matches.length) return JSON.stringify({ conversations: [], note: "No matching conversations." });
    return JSON.stringify({ conversations: matches });
  },
};

const conversation_read: ToolSpec<{ conversation_id: string; limit: number }> = {
  name: "conversation_read",
  description: "Read the most recent messages of one of the user's own conversations. Refuses any conversation the signed-in user does not own (enforced by the database).",
  parameters: {
    type: "object",
    properties: {
      conversation_id: { type: "string", description: "The conversation id (from conversation_search)." },
      limit: { type: "integer", description: "Max recent messages to return (1-40, default 12)." },
    },
    required: ["conversation_id"],
  },
  timeoutMs: 5000,
  parse: raw => ({
    conversation_id: requireString(raw, "conversation_id", { max: 64 }),
    limit: optionalInt(raw, "limit", { min: 1, max: 40, def: 12 }),
  }),
  execute: async (args, ctx) => {
    const data = requireData(ctx);
    const limit = clampLimit(args.limit, 40);
    const messages = await data.listMessages(args.conversation_id, limit);
    if (!messages.length) {
      return JSON.stringify({
        messages: [],
        note: "No messages found. The conversation may not exist or may not belong to this user.",
      });
    }
    return JSON.stringify({ messages });
  },
};

const knowledge_search: ToolSpec<{ query: string; limit: number }> = {
  name: "knowledge_search",
  description: "Full-text search across the user's own uploaded files, projects and memories. Returns kind, title and a short snippet per hit. Use to ground answers in the user's own documents.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search terms, 1-200 characters." },
      limit: { type: "integer", description: "Max hits to return (1-20, default 6)." },
    },
    required: ["query"],
  },
  timeoutMs: 6000,
  parse: raw => ({
    query: requireString(raw, "query", { max: 200 }),
    limit: optionalInt(raw, "limit", { min: 1, max: 20, def: 6 }),
  }),
  execute: async (args, ctx) => {
    const data = requireData(ctx);
    const limit = clampLimit(args.limit, 20);
    const hits = await data.searchAll(args.query, limit);
    if (!hits.length) return JSON.stringify({ results: [], note: "No matching files, projects or memories." });
    return JSON.stringify({ results: hits.slice(0, limit) });
  },
};

/** The default tool set registered by the chat function's agent loop. */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(current_time)
    .register(calculator)
    .register(web_search)
    .register(conversation_search)
    .register(conversation_read)
    .register(knowledge_search);
}
