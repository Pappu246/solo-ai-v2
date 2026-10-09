/**
 * Guard for URLs that become clickable anchor targets.
 *
 * Link data arrives from several places — live SSE events, rows loaded from
 * `messages.images` / `messages.web_sources`, and provider-normalised search
 * results. React does not block `javascript:`/`data:` URLs in `href` (it only
 * warns in development), so anything rendered as a link goes through here and
 * only `http:`/`https:` survives. An unsafe value renders as an anchor with no
 * href (visible, not clickable) rather than as a live protocol handler.
 *
 * Relative and protocol-relative URLs are rejected too: this app only ever
 * links to absolute provider URLs, and `//host` would inherit the page scheme.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
