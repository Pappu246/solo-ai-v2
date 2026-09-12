/**
 * Backend Image Search Diagnostics
 *
 * Tracks image search pipeline on the server side.
 * Logs to console with redacted sensitive data.
 * Never logs API keys, tokens, full prompts, provider responses, or secret URLs.
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

const diagnosticsStore = new Map<string, Partial<BackendImageSearchDiagnostics>>();
const MAX_STORED_DIAGNOSTICS = 100; // Bounded memory usage

export function initBackendDiagnostics(requestId: string): void {
  // Cleanup old diagnostics if store grows too large
  if (diagnosticsStore.size >= MAX_STORED_DIAGNOSTICS) {
    const firstKey = diagnosticsStore.keys().next().value;
    if (firstKey) diagnosticsStore.delete(firstKey);
  }

  diagnosticsStore.set(requestId, {
    requestId,
    timestamp: new Date().toISOString(),
    decision: { timestamp: new Date().toISOString(), heuristic: null, confidence: null, reason: null },
    queries: { timestamp: new Date().toISOString(), generated: [], count: 0 },
    provider: {
      timestamp: new Date().toISOString(),
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
      timestamp: new Date().toISOString(),
      eventsEmitted: 0,
      started: false,
      resultsEmitted: 0,
      totalImagesEmitted: 0,
      errors: [],
    },
  });
}

export function recordBackendDecision(
  requestId: string,
  heuristic: string | null,
  confidence: 'high' | 'medium' | 'low' | null,
  reason: string | null,
): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  diag.decision = { timestamp: new Date().toISOString(), heuristic, confidence, reason };
}

export function recordBackendQueries(requestId: string, queries: string[]): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  diag.queries = { timestamp: new Date().toISOString(), generated: queries, count: queries.length };
}

export function recordBackendProviderResult(
  requestId: string,
  name: string | null,
  rawCount: number,
  normalizedCount: number,
  filteredCount: number,
  thumbnailHosts: string[],
  status: 'success' | 'error' | 'timeout',
  error: string | null,
  durationMs: number | null,
): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  diag.provider = {
    timestamp: new Date().toISOString(),
    name,
    rawCount,
    normalizedCount,
    filteredCount,
    thumbnail_hosts: thumbnailHosts,
    status,
    error,
    durationMs,
  };
}

export function recordBackendSSEEvent(
  requestId: string,
  eventType: 'started' | 'results' | 'error',
  imageCount: number = 0,
): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.sse) return;
  diag.sse.eventsEmitted++;
  diag.sse.timestamp = new Date().toISOString();
  if (eventType === 'started') diag.sse.started = true;
  if (eventType === 'results') {
    diag.sse.resultsEmitted++;
    diag.sse.totalImagesEmitted += imageCount;
  }
}

export function recordBackendSSEError(requestId: string, message: string): void {
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.sse) return;
  diag.sse.errors.push({ timestamp: new Date().toISOString(), message: message.slice(0, 200) });
}

export function getBackendDiagnostics(requestId: string): BackendImageSearchDiagnostics | null {
  const diag = diagnosticsStore.get(requestId);
  return (diag as unknown as BackendImageSearchDiagnostics) || null;
}

export function logBackendDiagnostics(requestId: string): void {
  const diag = getBackendDiagnostics(requestId);
  if (!diag) return;
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      fn: 'chat',
      request_id: requestId,
      event: 'image_search_diagnostics',
      diagnostics: diag,
    }),
  );
}

export function clearBackendDiagnostics(requestId: string): void {
  diagnosticsStore.delete(requestId);
}
