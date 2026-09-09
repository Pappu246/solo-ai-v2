/**
 * Shared SSE event types for image search.
 *
 * These events are emitted by the chat function when image search is triggered,
 * and can also be used by a standalone image-search function.
 *
 * Protocol extension:
 * - event: image_search
 *   data: { type: "started", queries: string[] }
 * - event: image_search
 *   data: { type: "results", images: ImageResult[] }
 * - event: image_search
 *   data: { type: "error", message: string }
 */

import type { ImageResult } from "./providers.ts";

export type ImageSearchEvent =
  | { type: "started"; queries: string[] }
  | { type: "results"; images: ImageResult[] }
  | { type: "error"; message: string };

/**
 * Format an image search event as an SSE frame.
 */
export function sseImageSearchEvent(event: ImageSearchEvent): string {
  return `event: image_search\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse an image search SSE frame (for client-side consumption).
 */
export function parseImageSearchEvent(data: string): ImageSearchEvent | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    if (!("type" in parsed)) return null;

    const type = parsed.type;
    if (type === "started" && Array.isArray(parsed.queries)) {
      return { type: "started", queries: parsed.queries };
    }
    if (type === "results" && Array.isArray(parsed.images)) {
      return { type: "results", images: parsed.images };
    }
    if (type === "error" && typeof parsed.message === "string") {
      return { type: "error", message: parsed.message };
    }

    return null;
  } catch {
    return null;
  }
}
