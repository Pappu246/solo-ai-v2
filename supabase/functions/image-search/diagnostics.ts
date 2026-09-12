/**
 * Backend Image Search Diagnostics
 *
 * Best-effort, bounded diagnostics for the image-search pipeline.
 * Never stores full prompts, credentials, tokens, or complete URLs.
 */

export interface BackendImageSearchDiagnostics {
  requestId: string;
  timestamp: string;
  decision: {
    timestamp: string;
    heuristic: string | null;
    confidence: 'high' | 'medium' | 'low' | null;
    reason: string | null;
  };
  queries: {
    timestamp: string;
    generated: string[];
    count: number;
  };
  provider: {
    timestamp: string;
    name: string | null;
    rawCount: number;
    normalizedCount: number;
    filteredCount: number;
    thumbnail_hosts: string[];
    status: 'success' | 'error' | 'timeout' | null;
    error: string | null;
    durationMs: number | null;
  };
  sse: {
    timestamp: string;
    eventsEmitted: number;
    started: boolean;
    resultsEmitted: number;
    totalImagesEmitted: number;
    errors: Array<{ timestamp: string; message: string }>;
  };
}

const diagnosticsStore = new Map<string, BackendImageSearchDiagnostics>();
const MAX_STORED_DIAGNOSTICS = 100;
const MAX_QUERY_LENGTH = 120;
const MAX_ERROR_LENGTH = 200;

function safeText(value: string | null, maxLength: number): string | null {
  if (value == null) return null;
  return value.replace(/[\r\n\t]/g, ' ').replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, maxLength);
}

function safeQueries(queries: string[]): string[] {
  return queries.slice(0, 3).map(query => safeText(query, MAX_QUERY_LENGTH) || '');
}

function now(): string {
  return new Date().toISOString();
}

function emptyDiagnostics(requestId: string): BackendImageSearchDiagnostics {
  const timestamp = now();
  return {
    requestId,
    timestamp,
    decision: { timestamp, heuristic: null, confidence: null, reason: null },
    queries: { timestamp, generated: [], count: 0 },
    provider: {
      timestamp,
      name: null,
      rawCount: 0,
      normalizedCount: 0,
      filteredCount: 0,
      thumbnail_hosts: [],
      status: null,
      error: null,
      durationMs: null,
    },
    sse: {
      timestamp,
      eventsEmitted: 0,
      started: false,
      resultsEmitted: 0,
      totalImagesEmitted: 0,
      errors: [],
    },
  };
}

export function initBackendDiagnostics(requestId: string): void {
  while (diagnosticsStore.size >= MAX_STORED_DIAGNOSTICS) {
    const firstKey = diagnosticsStore.keys().next().value;
    if (!firstKey) break;
    diagnosticsStore.delete(firstKey);
  }
  diagnosticsStore.set(requestId, emptyDiagnostics(requestId));
}

export function recordBackendDecision(requestId: string, heuristic: string | null, confidence: 'high' | 'medium' | 'low' | null, reason: string | null): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  diag.decision = { timestamp: now(), heuristic: safeText(heuristic, 80), confidence, reason: safeText(reason, 160) };
}

export function recordBackendQueries(requestId: string, queries: string[]): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  const generated = safeQueries(queries);
  diag.queries = { timestamp: now(), generated, count: queries.length };
}

export function recordBackendProviderResult(requestId: string, name: string | null, rawCount: number, normalizedCount: number, filteredCount: number, thumbnailHosts: string[], status: 'success' | 'error' | 'timeout', error: string | null, durationMs: number | null): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  diag.provider = {
    timestamp: now(),
    name: safeText(name, 60),
    rawCount: Math.max(0, rawCount),
    normalizedCount: Math.max(0, normalizedCount),
    filteredCount: Math.max(0, filteredCount),
    thumbnail_hosts: [...new Set(thumbnailHosts)].slice(0, 10).map(host => safeText(host, 120) || ''),
    status,
    error: safeText(error, MAX_ERROR_LENGTH),
    durationMs: durationMs == null ? null : Math.max(0, Math.round(durationMs)),
  };
}

export function recordBackendSSEEvent(requestId: string, eventType: 'started' | 'results' | 'error', imageCount = 0): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  diag.sse.timestamp = now();
  diag.sse.eventsEmitted = Math.min(diag.sse.eventsEmitted + 1, 1000);
  if (eventType === 'started') diag.sse.started = true;
  if (eventType === 'results') {
    diag.sse.resultsEmitted = Math.min(diag.sse.resultsEmitted + 1, 1000);
    diag.sse.totalImagesEmitted = Math.min(diag.sse.totalImagesEmitted + Math.max(0, imageCount), 10000);
  }
}

export function recordBackendSSEError(requestId: string, message: string): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  if (diag.sse.errors.length >= 10) return;
  diag.sse.errors.push({ timestamp: now(), message: safeText(message, MAX_ERROR_LENGTH) || 'Unknown SSE error' });
}

export function getBackendDiagnostics(requestId: string): BackendImageSearchDiagnostics | null {
  return diagnosticsStore.get(requestId) ?? null;
}

export function logBackendDiagnostics(requestId: string): void {
  const diag = getBackendDiagnostics(requestId);
  if (!diag) return;
  console.log(JSON.stringify({ at: now(), fn: 'chat', request_id: requestId, event: 'image_search_diagnostics', diagnostics: diag }));
}

export function clearBackendDiagnostics(requestId: string): void {
  diagnosticsStore.delete(requestId);
}
