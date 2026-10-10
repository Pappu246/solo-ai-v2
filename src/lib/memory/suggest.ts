/**
 * Phase 8: suggested-memory detection.
 *
 * Conservatively inspects a message the user just sent and, when it states
 * something durable (a preference, an instruction, a personal fact), proposes
 * saving it as a memory. False negatives are fine — a manual "Remember this"
 * button already exists — so every rule errs toward staying quiet:
 *
 *  - only short, prose-like messages (code and pasted data are skipped);
 *  - never questions, commands directed at the assistant, or one-off requests;
 *  - patterns must state something about the *user* or how they want the
 *    assistant to behave, not the topic of the moment.
 *
 * Pure and deterministic — unit tested without DOM or storage.
 */
import type { MemoryType } from '../../types';

export interface MemorySuggestion {
  /** Suggested memory classification. */
  type: MemoryType;
  /** Content to prefill the memory editor with. */
  content: string;
  /** Short user-facing reason for why this looked memorable. */
  reason: string;
}

/** Hard limits: pasted logs, long prompts and tiny messages never suggest. */
export const SUGGEST_MIN_CHARS = 12;
export const SUGGEST_MAX_CHARS = 600;

interface Rule {
  type: MemoryType;
  reason: string;
  pattern: RegExp;
}

/**
 * Ordered so the most specific reading wins: explicit preferences first,
 * then standing instructions, then personal facts.
 */
const RULES: Rule[] = [
  {
    type: 'preference',
    reason: 'This looks like a lasting preference.',
    pattern: /\b(i (?:always )?(?:prefer|like|love|hate|dislike|enjoy|can't stand|cannot stand)|my (?:favorite|favourite|go-to)|i(?:'d| would) rather|in general,? i)\b/i,
  },
  {
    type: 'instruction',
    reason: 'This looks like a standing instruction for future chats.',
    pattern: /\b(always|never|don't|do not|please (?:always|never|stop|keep|use)|remember (?:that|to)|make sure (?:to|that)|when i|i want you to|call me|from now on)\b/i,
  },
  {
    type: 'fact',
    reason: 'This looks like a personal fact worth remembering.',
    pattern: /\b(my name is|i(?:'m| am) (?:a|an|the)|i work (?:at|for|as)|i live in|i'm based|i am based|our (?:team|company|project) (?:uses|is|works)|we (?:use|build|run)|i use)\b/i,
  },
];

/** Message shapes that are clearly not memory-worthy. */
function looksLikeNonProse(text: string): boolean {
  if (/```|^\s*[{$[\]}>]|[;=]\s*$|https?:\/\/\S+\s*$/m.test(text)) return true;
  // Heavy symbol/punctuation density ⇒ code, data or a stack trace.
  const symbols = (text.match(/[{}()[\];<>|\\$#@~`]/g) ?? []).length;
  return symbols / text.length > 0.08;
}

function isQuestion(text: string): boolean {
  if (text.includes('?')) return true;
  return /^(?:what|who|why|how|when|where|which|can|could|would|will|is|are|do|does|did|should)\b/i.test(text.trim());
}

/** Requests aimed at this turn, not durable guidance. */
function isOneOffRequest(text: string): boolean {
  const oneOff = /\b(write|generate|create|draft|explain|translate|summarize|summarise|list|show|give me|fix|debug|help me|compare|calculate|convert)\b[^.?!]*[.?!]?\s*$/i.test(text);
  if (!oneOff) return false;
  // Standing guidance overrides the one-off reading.
  return /\b(always|never|from now on|going forward|remember)\b/i.test(text) === false;
}

/**
 * Detect whether a sent message is worth proposing as a memory.
 * Returns `null` (stay quiet) for anything ambiguous.
 */
export function detectMemorySuggestion(raw: string): MemorySuggestion | null {
  const text = (raw ?? '').trim();
  if (text.length < SUGGEST_MIN_CHARS || text.length > SUGGEST_MAX_CHARS) return null;
  if (looksLikeNonProse(text)) return null;
  if (isQuestion(text)) return null;
  if (isOneOffRequest(text)) return null;
  // Multi-sentence messages usually mix topics; only single-statement
  // messages are unambiguous enough to suggest.
  if ((text.match(/[.!?]/g) ?? []).length > 2) return null;

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { type: rule.type, content: text, reason: rule.reason };
    }
  }
  return null;
}
