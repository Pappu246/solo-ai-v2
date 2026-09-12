/**
 * SSE Stream Diagnostics Integration
 *
 * Tracks image search events as they flow through the SSE parser.
 * Disabled when VITE_IMAGE_SEARCH_DEBUG is not set to 'true'.
 */

import {
  recordFrontendEvent,
  recordSSEEvent,
  recordImageLoad,
} from './image-diagnostics';

const isDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return import.meta.env.VITE_IMAGE_SEARCH_DEBUG === 'true';
};

export function logSSEImageSearchStarted(requestId: string, queries: string[]): void {
  if (!isDebugEnabled()) return;
  recordSSEEvent(requestId, 'started');
  console.debug(`[image-search] ${requestId}: search started`, { queries });
}

export function logSSEImageSearchResults(requestId: string, imageCount: number): void {
  if (!isDebugEnabled()) return;
  recordSSEEvent(requestId, 'results', imageCount);
  recordFrontendEvent(requestId, 'received');
  console.debug(`[image-search] ${requestId}: ${imageCount} images received via SSE`);
}

export function logSSEImageSearchError(requestId: string, message: string): void {
  if (!isDebugEnabled()) return;
  recordSSEEvent(requestId, 'error');
  recordFrontendEvent(requestId, 'error');
  console.debug(`[image-search] ${requestId}: SSE error`, { message: message.slice(0, 200) });
}

export function logImageLoadResult(requestId: string, url: string, success: boolean): void {
  if (!isDebugEnabled()) return;
  recordImageLoad(requestId, url, success);
  if (success) {
    console.debug(`[image-search] ${requestId}: image loaded`, { url: sanitizeUrl(url) });
  } else {
    console.debug(`[image-search] ${requestId}: image load failed`, { url: sanitizeUrl(url) });
  }
}

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname.substring(0, 50)}...`;
  } catch {
    return '[invalid-url]';
  }
}
