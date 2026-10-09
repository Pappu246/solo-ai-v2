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

/** The default tool set registered by the chat function's agent loop. */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry().register(current_time).register(web_search);
}
