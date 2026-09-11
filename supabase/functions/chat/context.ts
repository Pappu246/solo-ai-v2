import type { Message, ModelSpec } from "./providers.ts";

/**
 * Builds a bounded model context without changing the canonical DB history.
 * Messages are never partially truncated: whole turns are retained or omitted.
 */
export interface ContextBuildResult {
  messages: Message[];
  compacted: boolean;
  droppedTurns: number;
  sourceChars: number;
  contextChars: number;
}

const RECENT_TURNS = 12;
const ABSOLUTE_INPUT_CHARS = 180_000;
const SUMMARY_CHARS = 18_000;

function chars(messages: Message[]): number {
  return messages.reduce((n, m) => n + String(m.content).length, 0);
}

function modelCharBudget(model: ModelSpec): number {
  // Conservative character budgets leave room for system/context instructions,
  // output tokens and tokenizer variance. Never assume one model's limit.
  const tokenBudget = Math.max(12_000, Math.min(Math.floor(model.context_length * 0.68), 90_000));
  return Math.min(ABSOLUTE_INPUT_CHARS, tokenBudget * 4);
}

function summarizeTurns(turns: Message[]): string {
  const lines = turns.map((m, i) => `${i + 1}. ${m.role.toUpperCase()}: ${String(m.content).replace(/\s+/g, " ").trim()}`);
  return lines.join("\n").slice(0, SUMMARY_CHARS);
}

/**
 * Keeps recent conversation turns exactly and represents older turns as a
 * clearly-marked compact summary. The summary is deterministic so no second
 * model call is required and streaming latency stays predictable.
 */
export function buildModelContext(source: Message[], model: ModelSpec): ContextBuildResult {
  const sourceChars = chars(source);
  const budget = modelCharBudget(model);
  if (sourceChars <= budget && source.length <= 200) {
    return { messages: source, compacted: false, droppedTurns: 0, sourceChars, contextChars: sourceChars };
  }

  const recent = source.slice(-RECENT_TURNS);
  const older = source.slice(0, Math.max(0, source.length - RECENT_TURNS));
  const summary = summarizeTurns(older);
  const summaryMessage: Message = {
    role: "system",
    content: `Conversation history summary (older turns are preserved in the database but compacted for this model request). Preserve important facts, decisions, constraints and unresolved tasks from this summary.\n${summary}`,
  };

  let selected: Message[] = [summaryMessage, ...recent];
  // If even the bounded selection is too large, remove complete oldest recent
  // turns only. Never slice a message's content.
  while (selected.length > 2 && chars(selected) > budget) selected = [summaryMessage, ...selected.slice(2)];

  return {
    messages: selected,
    compacted: true,
    droppedTurns: Math.max(0, source.length - (selected.length - 1)),
    sourceChars,
    contextChars: chars(selected),
  };
}
