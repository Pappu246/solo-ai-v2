/**
 * Turn a YouTube transcript into a study pack (notes, quiz, flashcards) using
 * the same free model catalog as the chat function. Dependency-injected fetch
 * so the prompt building and output validation are unit-testable offline.
 */
import {
  apiKeyFor,
  buildProviderRequest,
  fallbackChain,
  redactSecrets,
  resolveModel,
  type EnvReader,
  type FetchLike,
  type ModelSpec,
} from '../chat/providers.ts';
import { parseToolCalls } from '../chat/agent.ts';
import { languagePrompt } from '../chat/context-prompt.ts';
import type { TranscriptSegment } from './youtube.ts';

export type StudyErrorCode = 'no_model' | 'generation_failed' | 'invalid_output';

export class StudyGenerationError extends Error {
  readonly code: StudyErrorCode;
  constructor(code: StudyErrorCode, message: string) {
    super(message);
    this.name = 'StudyGenerationError';
    this.code = code;
  }
}

export interface StudyNote {
  heading: string;
  /** Markdown body. */
  body: string;
  /** Optional timestamp in seconds pointing at where the note comes from. */
  timestamp: number | null;
}

export interface StudyQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  timestamp: number | null;
}

export interface StudyFlashcard {
  front: string;
  back: string;
  timestamp: number | null;
}

export interface StudyPack {
  title: string;
  summary: string;
  notes: StudyNote[];
  quiz: StudyQuestion[];
  flashcards: StudyFlashcard[];
}

const SYSTEM_PROMPT = `You are Solo AI's study assistant. You receive the captions of a YouTube video and turn them into a structured study pack.

Respond with ONE JSON object and nothing else (no markdown fences, no commentary), using exactly this shape:
{
  "title": string,                    // short title of the video, 3-10 words
  "summary": string,                  // 2-4 sentence plain summary of the video
  "notes": [                          // 3-6 study notes
    { "heading": string, "body": string, "timestamp": number | null }
  ],
  "quiz": [                           // 5-8 multiple-choice questions
    { "question": string, "options": string[4], "answerIndex": number, "explanation": string, "timestamp": number | null }
  ],
  "flashcards": [                     // 6-12 flashcards
    { "front": string, "back": string, "timestamp": number | null }
  ]
}

Rules:
- Base EVERYTHING strictly on the captions provided. Never invent facts, numbers, or claims.
- Set "timestamp" to the video second the note/question/card comes from, when the captions make it clear. Use null otherwise. Never invent timestamps.
- Make the notes a clear, ordered study guide (key concepts first, then details and examples).
- Quiz questions must be unambiguous with exactly four options and exactly one correct answer (answerIndex is the 0-based index).
- Flashcards must be concise: a short prompt on the front, a focused answer on the back.
- Reply in the language requested by the user, keeping technical terms in their original form where natural.`;

export function transcriptToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${Math.round(s.start)}s] ${s.text}`).join('\n');
}

export function buildStudyMessages(
  videoId: string,
  transcriptText: string,
  truncated: boolean,
  languageName: unknown,
): { role: 'system' | 'user'; content: string }[] {
  const user =
    `YouTube video id: ${videoId}\n` +
    `Caption text (${transcribedWords(transcriptText)} words, ${truncated ? 'truncated for length — use what is provided' : 'complete'}):\n` +
    `<<<TRANSCRIPT START>>>\n${transcriptText}\n<<<TRANSCRIPT END>>>\n\n` +
    'Produce the study pack JSON now.';
  return [
    { role: 'system', content: SYSTEM_PROMPT + languagePrompt(languageName) },
    { role: 'user', content: user },
  ];
}

function transcribedWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Extract the first balanced {...} JSON object from a model response. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
      } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Normalise + validate a model payload into a StudyPack. Throws on malformed output. */
export function parseStudyPack(payload: unknown): StudyPack {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const notes = Array.isArray(record.notes) ? record.notes : [];
  const quiz = Array.isArray(record.quiz) ? record.quiz : [];
  const flashcards = Array.isArray(record.flashcards) ? record.flashcards : [];
  if (!notes.length && !quiz.length && !flashcards.length) {
    throw new StudyGenerationError('invalid_output', 'The model did not produce a study pack.');
  }
  const ts = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const pack: StudyPack = {
    title: asString(record.title, 'Study notes'),
    summary: asString(record.summary),
    notes: notes.slice(0, 8).map((n) => {
      const item = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
      return { heading: asString(item.heading, 'Note'), body: asString(item.body), timestamp: ts(item.timestamp) };
    }).filter((n) => n.body),
    quiz: quiz.slice(0, 10).map((q) => {
      const item = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
      const options = Array.isArray(item.options)
        ? item.options.map((o) => asString(o)).filter(Boolean).slice(0, 6)
        : [];
      const answerIndex = Math.trunc(Number(item.answerIndex));
      return {
        question: asString(item.question, 'Question'),
        options,
        answerIndex: Number.isFinite(answerIndex) && answerIndex >= 0 && answerIndex < options.length
          ? answerIndex
          : 0,
        explanation: asString(item.explanation),
        timestamp: ts(item.timestamp),
      };
    }).filter((q) => q.question && q.options.length >= 2),
    flashcards: flashcards.slice(0, 15).map((c) => {
      const item = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      return { front: asString(item.front), back: asString(item.back), timestamp: ts(item.timestamp) };
    }).filter((c) => c.front && c.back),
  };
  if (!pack.notes.length && !pack.quiz.length && !pack.flashcards.length) {
    throw new StudyGenerationError('invalid_output', 'The model did not produce a study pack.');
  }
  return pack;
}

interface GenerateOptions {
  env: EnvReader;
  fetchImpl: FetchLike;
  videoId: string;
  transcriptText: string;
  truncated: boolean;
  languageName?: unknown;
  requestedModel?: string | null;
  signal?: AbortSignal;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

async function fetchJsonOnce(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort((signal as { reason?: unknown } | undefined)?.reason);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Generate the study pack. Tries each model in the free fallback chain once;
 * a failure on one provider degrades to the next instead of surfacing to the user.
 */
export async function generateStudyPack(options: GenerateOptions): Promise<StudyPack> {
  const { env, fetchImpl, videoId, transcriptText, truncated, languageName, requestedModel, signal } = options;
  const primary = resolveModel(requestedModel && requestedModel.trim() ? requestedModel : 'gpt-oss-120b');
  if (!primary) {
    throw new StudyGenerationError('no_model', 'The study model is not available.');
  }
  const chain: ModelSpec[] = fallbackChain(primary, false, {
    health: { isHealthy: () => true },
    isProviderConfigured: (provider) => Boolean(apiKeyFor(provider, env)),
  }).filter((m) => Boolean(apiKeyFor(m.provider, env)));
  if (!chain.length) {
    throw new StudyGenerationError('no_model', 'No free study model is configured yet.');
  }
  const messages = buildStudyMessages(videoId, transcriptText, truncated, languageName);
  const errors: string[] = [];
  for (const model of chain) {
    if (signal?.aborted) break;
    let apiKey: string;
    try {
      apiKey = apiKeyFor(model.provider, env);
    } catch {
      continue;
    }
    if (!apiKey) continue;
    try {
      const { url, init } = buildProviderRequest(model, messages, apiKey, { stream: false });
      const payload = await fetchJsonOnce(url, init, fetchImpl, 120_000, signal);
      const { text } = parseToolCalls(model.provider, payload);
      const pack = parseStudyPack(extractJsonObject(text));
      options.log?.('study_generation_ok', { model: model.id, chars: text.length });
      return pack;
    } catch (error) {
      const detail = redactSecrets(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      errors.push(`${model.id}: ${detail.slice(0, 160)}`);
      options.log?.('study_generation_attempt_failed', { model: model.id, error: detail.slice(0, 300) });
    }
  }
  throw new StudyGenerationError(
    'generation_failed',
    'The study pack could not be generated right now. Please try again in a moment.',
  );
}
