/**
 * Frontend Image Search Diagnostics - Developer-only observability
 *
 * Traces image search across request ID, decision, queries, provider, SSE, 
 * frontend parsing, gallery, and proxy stages.
 *
 * Disabled by default. Enable with VITE_IMAGE_SEARCH_DEBUG=true environment variable.
 * Never exposes API keys, tokens, full prompts, provider bodies, or secret URLs.
 */

export interface ImageSearchDiagnostics {
  // Request identification
  requestId: string;
  timestamp: string;

  // Decision stage
  decision: {
    timestamp: string;
    heuristic: string | null;
    confidence: 'high' | 'medium' | 'low' | null;
    reason: string | null;
  };

  // Query generation
  queries: {
    timestamp: string;
    generated: string[];
    count: number;
  };

  // Provider interaction
  provider: {
    timestamp: string;
    name: string | null;
    rawCount: number;
    normalizedCount: number;
    filteredCount: number;
    thumbnail_hosts: string[];
    status: 'success' | 'error' | 'timeout' | null;
    error: string | null;
  };

  // SSE transmission
  sse: {
    timestamp: string;
    eventsEmitted: number;
    started: boolean;
    resultsEmitted: number;
    totalImagesEmitted: number;
    errors: string[];
  };

  // Frontend parsing
  frontend: {
    timestamp: string;
    eventsReceived: number;
    parseErrors: number;
    parsedImageCount: number;
  };

  // Message attachment
  message: {
    timestamp: string;
    imageCount: number;
  };

  // Gallery mounting
  gallery: {
    timestamp: string;
    mounted: boolean;
    renderCount: number;
  };

  // Image proxy
  proxy: {
    timestamp: string;
    requests: Array<{
      url: string;
      status: number | null;
      contentType: string | null;
      bytes: number | null;
      loadedAt: string;
    }>;
  };

  // Image load results
  imageLoads: {
    timestamp: string;
    success: string[]; // URLs that loaded
    failed: string[]; // URLs that failed
  };
}

const isDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return import.meta.env.VITE_IMAGE_SEARCH_DEBUG === 'true';
};

const diagnosticsStore = new Map<string, Partial<ImageSearchDiagnostics>>();
const MAX_STORED_DIAGNOSTICS = 50; // Bounded memory usage

export function initDiagnostics(requestId: string): void {
  if (!isDebugEnabled()) return;
  
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
    },
    sse: {
      timestamp: new Date().toISOString(),
      eventsEmitted: 0,
      started: false,
      resultsEmitted: 0,
      totalImagesEmitted: 0,
      errors: [],
    },
    frontend: {
      timestamp: new Date().toISOString(),
      eventsReceived: 0,
      parseErrors: 0,
      parsedImageCount: 0,
    },
    message: { timestamp: new Date().toISOString(), imageCount: 0 },
    gallery: { timestamp: new Date().toISOString(), mounted: false, renderCount: 0 },
    proxy: { timestamp: new Date().toISOString(), requests: [] },
    imageLoads: { timestamp: new Date().toISOString(), success: [], failed: [] },
  });
}

export function recordDecision(
  requestId: string,
  heuristic: string | null,
  confidence: 'high' | 'medium' | 'low' | null,
  reason: string | null,
): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  diag.decision = { timestamp: new Date().toISOString(), heuristic, confidence, reason };
}

export function recordQueries(requestId: string, queries: string[]): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag) return;
  diag.queries = { timestamp: new Date().toISOString(), generated: queries, count: queries.length };
}

export function recordProviderResult(
  requestId: string,
  name: string | null,
  rawCount: number,
  normalizedCount: number,
  filteredCount: number,
  thumbnailHosts: string[],
  status: 'success' | 'error' | 'timeout',
  error: string | null,
): void {
  if (!isDebugEnabled()) return;
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
  };
}

export function recordSSEEvent(
  requestId: string,
  eventType: 'started' | 'results' | 'error',
  imageCount: number = 0,
): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.sse) return;
  diag.sse.eventsEmitted++;
  diag.sse.timestamp = new Date().toISOString();
  if (eventType === 'started') diag.sse.started = true;
  if (eventType === 'results') {
    diag.sse.resultsEmitted++;
    diag.sse.totalImagesEmitted += imageCount;
  }
  if (eventType === 'error') diag.sse.errors.push(new Date().toISOString());
}

export function recordSSEError(requestId: string, error: string): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.sse) return;
  diag.sse.errors.push(error.slice(0, 200));
}

export function recordFrontendEvent(
  requestId: string,
  type: 'received' | 'error' | 'parsed',
  imageCount: number = 0,
): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.frontend) return;
  if (type === 'received') diag.frontend.eventsReceived++;
  if (type === 'error') diag.frontend.parseErrors++;
  if (type === 'parsed') diag.frontend.parsedImageCount += imageCount;
  diag.frontend.timestamp = new Date().toISOString();
}

export function recordMessageImages(requestId: string, imageCount: number): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.message) return;
  diag.message = { timestamp: new Date().toISOString(), imageCount };
}

export function recordGalleryMounted(requestId: string, mounted: boolean): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.gallery) return;
  if (mounted) {
    diag.gallery.mounted = true;
    diag.gallery.renderCount++;
  }
  diag.gallery.timestamp = new Date().toISOString();
}

export function recordProxyRequest(
  requestId: string,
  url: string,
  status: number | null,
  contentType: string | null,
  bytes: number | null,
): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.proxy) return;
  diag.proxy.requests.push({
    url: sanitizeUrl(url),
    status,
    contentType,
    bytes,
    loadedAt: new Date().toISOString(),
  });
  diag.proxy.timestamp = new Date().toISOString();
}

export function recordImageLoad(requestId: string, url: string, success: boolean): void {
  if (!isDebugEnabled()) return;
  const diag = diagnosticsStore.get(requestId);
  if (!diag || !diag.imageLoads) return;
  const sanitized = sanitizeUrl(url);
  if (success) {
    diag.imageLoads.success.push(sanitized);
  } else {
    diag.imageLoads.failed.push(sanitized);
  }
  diag.imageLoads.timestamp = new Date().toISOString();
}

export function getDiagnostics(requestId: string): ImageSearchDiagnostics | null {
  if (!isDebugEnabled()) return null;
  const diag = diagnosticsStore.get(requestId);
  return (diag as unknown as ImageSearchDiagnostics) || null;
}

export function logDiagnostics(requestId: string): void {
  if (!isDebugEnabled()) return;
  const diag = getDiagnostics(requestId);
  if (!diag) return;
  console.group(`📊 Image Search Diagnostics [${requestId}]`);
  console.table(diag);
  console.log('Decision:', diag.decision);
  console.log('Queries:', diag.queries);
  console.log('Provider:', diag.provider);
  console.log('SSE:', diag.sse);
  console.log('Frontend:', diag.frontend);
  console.log('Message:', diag.message);
  console.log('Gallery:', diag.gallery);
  console.log('Proxy:', diag.proxy);
  console.log('Image Loads:', diag.imageLoads);
  console.groupEnd();
}

export function clearDiagnostics(requestId: string): void {
  diagnosticsStore.delete(requestId);
}

/**
 * Sanitize URLs for safe logging: strip parameters but keep base domain.
 */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname.substring(0, 50)}...`;
  } catch {
    return '[invalid-url]';
  }
}
