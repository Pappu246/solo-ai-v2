/**
 * Shared SSE event types for web research (Phase 5).
 *
 * Protocol extension (mirrors image search):
 * - event: web_search
 *   data: { type: "started", query: string }
 * - event: web_search
 *   data: { type: "results", sources: WebSearchSource[] }
 * - event: web_search
 *   data: { type: "error", message: string }
 *
 * Emitted by the chat function when research ran. An enabled-but-failed
 * research turn emits `error` so the UI can show a clear state instead of
 * pretending sources existed.
 */

import type { WebSearchSource } from "./providers.ts";

export type WebSearchEvent =
  | { type: "started"; query: string }
  | { type: "results"; sources: WebSearchSource[] }
  | { type: "error"; message: string };

/** Format a web research event as an SSE frame. */
export function sseWebSearchEvent(event: WebSearchEvent): string {
  return `event: web_search\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Parse a web research SSE frame (for client-side consumption). */
export function parseWebSearchEvent(data: string): WebSearchEvent | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.type === "started" && typeof parsed.query === "string") {
      return { type: "started", query: parsed.query };
    }
    if (parsed.type === "results" && Array.isArray(parsed.sources)) {
      const sources = parsed.sources.filter(isWebSearchSource);
      return { type: "results", sources };
    }
    if (parsed.type === "error" && typeof parsed.message === "string") {
      return { type: "error", message: parsed.message.slice(0, 300) };
    }
    return null;
  } catch {
    return null;
  }
}

function isWebSearchSource(value: unknown): value is WebSearchSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return typeof source.url === "string"
    && typeof source.title === "string"
    && typeof source.domain === "string"
    && typeof source.rank === "number";
}
