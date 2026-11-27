/**
 * Client for the `study` Edge Function: YouTube link → transcript → study pack
 * (notes, quiz, flashcards with timestamps). Results are cached per video in
 * localStorage so a page refresh does not re-spend model tokens.
 */
import { supabase, SUPABASE_URL } from '../supabase';
import { AppError } from '../errors';
import { retryTransient } from '../retry';

/** Mirrors the Edge Function's study pack shape (see supabase/functions/study). */
export interface StudyNote {
  heading: string;
  body: string;
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
export interface StudyResult {
  videoId: string;
  pack: StudyPack;
}

export const STUDY_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/study`;

/** `https://youtu.be/<id>?t=<seconds>` for timestamp links. */
export function watchUrl(videoId: string, seconds?: number | null): string {
  return seconds && seconds >= 0
    ? `https://youtu.be/${videoId}?t=${Math.round(seconds)}`
    : `https://youtu.be/${videoId}`;
}

/** Extract a YouTube video id client-side (mirrors the Edge Function). */
export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com'
      || host === 'music.youtube.com' || host === 'www.youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      const knownPrefixes = new Set(['shorts', 'embed', 'live', 'v', 'e']);
      for (const part of parts) {
        if (knownPrefixes.has(part.toLowerCase())) continue;
        if (/^[A-Za-z0-9_-]{11}$/.test(part)) return part;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new AppError('Your session has expired. Please sign in again.', 401);
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

/** Error codes the Edge Function can return, mapped to friendly messages. */
const CODE_MESSAGES: Record<string, string> = {
  invalid_url: 'Paste a valid YouTube link or video id.',
  no_captions: 'This video has no captions or subtitles to study from.',
  video_unavailable: 'This video is not available.',
  transcript_unavailable: 'The captions for this video could not be downloaded.',
  network: 'Could not reach YouTube right now. Please try again.',
  no_model: 'No free study model is configured yet.',
  generation_failed: 'The study pack could not be generated right now. Please try again.',
  invalid_output: 'The study pack came back in an unexpected format. Please try again.',
  rate_limited: 'You are making too many requests. Please wait a moment.',
  usage_limit: 'You have reached your usage limit for now. Please try again later.',
  access_pending: 'Your access is waiting for approval.',
  access_blocked: 'Your access has been blocked.',
  unauthorized: 'Please sign in to use Study mode.',
  internal_error: 'Something went wrong on our side.',
};

function friendlyMessage(message: string, code?: string): string {
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  return message || 'The study pack could not be generated. Please try again.';
}

export interface StudyRequest {
  url: string;
  /** Preferred reply language name (e.g. "Hindi"), passed through to the model. */
  language?: string;
  /** Explicit model id (defaults to the free auto model in the function). */
  model?: string;
}

/** Call the study Edge Function. Throws AppError with a friendly message. */
export async function fetchStudyPack(request: StudyRequest): Promise<StudyResult> {
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetch(STUDY_FUNCTION_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
  } catch {
    throw new AppError('Could not reach the study service. Check your connection and try again.', 0);
  }
  if (!res.ok) {
    let code: string | undefined;
    let message = `The study service returned HTTP ${res.status}.`;
    try {
      const data = await res.json();
      if (data?.code) code = String(data.code);
      if (data?.error) message = String(data.error);
    } catch { /* keep the HTTP message */ }
    throw new AppError(friendlyMessage(message, code), res.status, code);
  }
  const data: unknown = await res.json();
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (!record.pack || typeof record.pack !== 'object') {
    throw new AppError('The study service returned an unexpected response.', 0);
  }
  return {
    videoId: typeof record.videoId === 'string' ? record.videoId : parseVideoId(request.url) ?? '',
    pack: record.pack as StudyPack,
  };
}

// ── localStorage cache (one pack per video, newest first) ───────────────────

const CACHE_KEY = 'solo-ai-study-packs';
const CACHE_LIMIT = 12;

export function loadStudyCache(): StudyResult[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StudyResult =>
        item && typeof item === 'object' && typeof (item as StudyResult).videoId === 'string'
        && typeof (item as StudyResult).pack === 'object',
    );
  } catch {
    return [];
  }
}

function saveStudyCache(entries: StudyResult[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries.slice(0, CACHE_LIMIT)));
  } catch { /* quota or private mode — the pack is still shown for this session */ }
}

export function rememberStudyResult(result: StudyResult): StudyResult[] {
  const entries = loadStudyCache().filter((e) => e.videoId !== result.videoId);
  const next = [result, ...entries].slice(0, CACHE_LIMIT);
  saveStudyCache(next);
  return next;
}

export function forgetStudyResult(videoId: string): StudyResult[] {
  const next = loadStudyCache().filter((e) => e.videoId !== videoId);
  saveStudyCache(next);
  return next;
}

/** Retry a transient network failure for the GET-like warm-up call, never for POST spend. */
export async function checkStudyService(): Promise<boolean> {
  const headers = await authHeaders();
  try {
    const res = await retryTransient(() => fetch(STUDY_FUNCTION_URL, { method: 'GET', headers }));
    return res.ok;
  } catch {
    return false;
  }
}
