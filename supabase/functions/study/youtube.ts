/**
 * YouTube transcript helpers for the Study function.
 *
 * No API key: the watch page HTML exposes the caption track list
 * (`captionTracks`), and the `baseUrl` on each track returns the captions as
 * plain XML. Everything here is dependency-injected (fetch + timers) so the
 * parsing and extraction logic is unit-testable offline.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TranscriptSegment {
  /** Start time in seconds. */
  start: number;
  /** Duration in seconds (best-effort; may be 0 when the source omits it). */
  duration: number;
  text: string;
}

export type StudyFetchError =
  | { code: 'invalid_url'; message: string }
  | { code: 'video_unavailable'; message: string }
  | { code: 'no_captions'; message: string }
  | { code: 'transcript_unavailable'; message: string }
  | { code: 'network'; message: string };

export class StudyFetchError extends Error {
  readonly code: StudyFetchError['code'];
  constructor(error: StudyFetchError) {
    super(error.message);
    this.name = 'StudyFetchError';
    this.code = error.code;
  }
}

/** Extract a YouTube video id from any common URL shape (watch, shorts, youtu.be, embed, live). */
export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  // Bare 11-char id.
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    const youtuBe = host === 'youtu.be';
    const ytHosts = host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com'
      || host === 'music.youtube.com' || host === 'www.youtube-nocookie.com';
    if (!youtuBe && !ytHosts) return null;
    if (youtuBe) {
      const id = url.pathname.slice(1).split('/')[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = url.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
    const parts = url.pathname.split('/').filter(Boolean);
    const knownPrefixes = new Set(['shorts', 'embed', 'live', 'v', 'e']);
    for (const part of parts) {
      if (knownPrefixes.has(part.toLowerCase())) continue;
      if (/^[A-Za-z0-9_-]{11}$/.test(part)) return part;
    }
    return null;
  } catch {
    return null;
  }
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+678; SOCS=CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AwGgJlbiACGgYIgLC_pwY',
};

/** Extract the first JSON array that follows `key":` in `html` via balanced-bracket scanning. */
export function extractJsonArray(html: string, key: string): unknown[] | null {
  const needle = `"${key}":`;
  const at = html.indexOf(needle);
  if (at < 0) return null;
  let i = at + needle.length;
  // Tolerate whitespace before the opening bracket.
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const slice = html.slice(html.indexOf(needle) + needle.length, i);
  const start = slice.indexOf('[');
  try {
    const parsed = JSON.parse(slice.slice(start));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface CaptionTrack {
  baseUrl?: string;
  name?: { simpleText?: string };
  languageCode?: string;
  kind?: string;
}

/** Fetch the watch page and pull the caption tracks out of it. */
export async function fetchCaptionTracks(
  videoId: string,
  fetchImpl: FetchLike,
  timeoutMs = 20_000,
): Promise<CaptionTrack[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  try {
    const res = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new StudyFetchError({
        code: res.status === 404 ? 'video_unavailable' : 'network',
        message: res.status === 404
          ? 'This video is not available.'
          : `Could not reach YouTube (HTTP ${res.status}).`,
      });
    }
    const html = await res.text();
    if (html.includes('"playabilityStatus":{"status":"ERROR"')) {
      throw new StudyFetchError({ code: 'video_unavailable', message: 'This video is not available.' });
    }
    const tracks = extractJsonArray(html, 'captionTracks') as CaptionTrack[] | null;
    if (!tracks || !tracks.length) {
      throw new StudyFetchError({
        code: 'no_captions',
        message: 'This video has no captions or subtitles to study from.',
      });
    }
    return tracks;
  } catch (error) {
    if (error instanceof StudyFetchError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new StudyFetchError({ code: 'network', message: 'Timed out while loading the video page.' });
    }
    throw new StudyFetchError({ code: 'network', message: 'Could not reach YouTube right now.' });
  } finally {
    clearTimeout(timer);
  }
}

/** Pick the best caption track: prefer English, then any human language, then ASR. */
export function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const human = tracks.filter((t) => t.baseUrl && !t.kind);
  const asr = tracks.filter((t) => t.baseUrl && t.kind === 'asr');
  const byLang = (lang: string) => [...human, ...asr].find((t) => (t.languageCode ?? '').toLowerCase().startsWith(lang));
  return byLang('en') ?? human[0] ?? asr[0] ?? null;
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, name: string) => XML_ENTITIES[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse YouTube timedtext XML into timestamped segments. */
export function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const re = /<text(?:\s+[^>]*)?\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const start = Number(match[1]);
    const duration = match[2] !== undefined ? Number(match[2]) : 0;
    const text = decodeEntities(match[3]);
    if (Number.isFinite(start) && text) {
      segments.push({ start, duration: Number.isFinite(duration) ? duration : 0, text });
    }
  }
  return segments;
}

/**
 * Fetch the full transcript for a video: caption track list → timedtext XML →
 * segments. Trims the result to `maxChars` so long videos stay inside the model
 * context window.
 */
export async function fetchTranscript(
  videoId: string,
  fetchImpl: FetchLike,
  maxChars = 32_000,
): Promise<{ segments: TranscriptSegment[]; truncated: boolean }> {
  const tracks = await fetchCaptionTracks(videoId, fetchImpl);
  const track = pickTrack(tracks);
  if (!track?.baseUrl) {
    throw new StudyFetchError({ code: 'no_captions', message: 'This video has no captions or subtitles to study from.' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), 20_000);
  try {
    const res = await fetchImpl(track.baseUrl, { headers: BROWSER_HEADERS, signal: controller.signal });
    if (!res.ok) {
      throw new StudyFetchError({
        code: 'transcript_unavailable',
        message: 'The captions for this video could not be downloaded.',
      });
    }
    const xml = await res.text();
    const segments = parseTimedTextXml(xml);
    if (!segments.length) {
      throw new StudyFetchError({
        code: 'transcript_unavailable',
        message: 'The captions for this video could not be read.',
      });
    }
    let total = 0;
    let last = segments.length;
    for (let i = 0; i < segments.length; i++) {
      if (total + segments[i].text.length > maxChars) { last = i; break; }
      total += segments[i].text.length;
    }
    return { segments: segments.slice(0, last), truncated: last < segments.length };
  } catch (error) {
    if (error instanceof StudyFetchError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new StudyFetchError({ code: 'network', message: 'Timed out while downloading the captions.' });
    }
    throw new StudyFetchError({ code: 'network', message: 'Could not download the captions right now.' });
  } finally {
    clearTimeout(timer);
  }
}
