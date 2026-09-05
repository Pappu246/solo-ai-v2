/**
 * Converts raw errors into something a non-technical user can act on,
 * while preserving the original detail for an expandable "Details" section.
 */

export interface FriendlyError {
  title: string;
  message: string;
  detail?: string;
  retryable: boolean;
  /** Machine code from the server (`{ error, code, request_id }`), when present. */
  code?: string;
}

export class AppError extends Error {
  constructor(message: string, public status?: number, public detail?: string, public code?: string) {
    super(message);
    this.name = 'AppError';
  }
}

const UNAVAILABLE = { title: 'AI is unavailable', message: 'AI provider is temporarily unavailable. Please try again.', retryable: true };

/**
 * Machine codes returned by the chat Edge Function → user-facing copy.
 * The server never sends provider names or raw upstream bodies, so this table
 * is the only place where a known failure becomes a sentence a person can act
 * on — instead of a generic "Something went wrong".
 */
const SERVER_CODES: Record<string, { title: string; message: string; retryable: boolean }> = {
  providers_unavailable: UNAVAILABLE,
  provider_error: UNAVAILABLE,
  provider_not_configured: UNAVAILABLE,
  provider_auth: UNAVAILABLE,
  provider_payment: UNAVAILABLE,
  network_error: { title: 'Connection problem', message: 'Could not reach the AI. Check your connection and try again.', retryable: true },
  provider_timeout: { title: 'Took too long', message: 'The AI took too long to respond. Please try again.', retryable: true },
  rate_limited: { title: 'Slow down', message: 'You are sending messages too quickly. Wait a moment and try again.', retryable: true },
  model_unavailable: { title: 'Model unavailable', message: 'That model is not available right now. Switch to Auto or pick another model.', retryable: true },
  stream_incomplete: { title: 'Response interrupted', message: 'The response was interrupted. You can retry to continue.', retryable: true },
  empty_response: { title: 'Empty response', message: 'The AI returned an empty response. Please try again.', retryable: true },
  context_length_exceeded: { title: 'Message too large', message: 'This conversation is too long. Start a new chat or shorten your message.', retryable: false },
  content_filtered: { title: 'Blocked', message: 'This request was blocked by the model’s content policy. Try rephrasing it.', retryable: false },
  images_unsupported: { title: 'Images not supported', message: 'The selected model cannot read images. Switch to Auto or pick a vision-capable model.', retryable: false },
  unauthorized: { title: 'Signed out', message: 'Your session has expired. Please sign in again.', retryable: false },
  internal_error: { title: 'Something went wrong', message: 'Solo AI hit a server problem. Please try again.', retryable: true },
};

export function toFriendlyError(error: unknown): FriendlyError {
  const err = error instanceof Error ? error : new Error(String(error));
  const status = (err as AppError).status;
  const code = (err as AppError).code;
  const raw = err.message || '';
  const detail = (err as AppError).detail || raw || undefined;
  // Database errors carry their code/message in `detail` (e.g. "[42501] new row violates row-level security policy").
  const lower = `${raw} ${(err as AppError).detail ?? ''}`.toLowerCase();

  if (err.name === 'AbortError') {
    return { title: 'Stopped', message: 'Generation was stopped.', retryable: false };
  }
  // A known server code always wins: it is precise and already user-safe.
  if (code && SERVER_CODES[code]) {
    return { ...SERVER_CODES[code], detail, code };
  }
  // `invalid_request` carries a specific, safe explanation from the server.
  if (code === 'invalid_request') {
    return { title: 'Request rejected', message: raw || 'The request could not be processed.', detail, retryable: false, code };
  }
  if (status === 401 || lower.includes('session has expired') || lower.includes('unauthorized') || lower.includes('jwt')) {
    return { title: 'Signed out', message: 'Your session has expired. Please sign in again.', detail, retryable: false };
  }
  if (status === 403 || lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('[42501]')) {
    return { title: 'No access', message: 'You don’t have permission to do that.', detail, retryable: false };
  }
  if (status === 429 || lower.includes('rate limit')) {
    return { title: 'Slow down', message: 'You are sending messages too quickly. Wait a moment and try again.', detail, retryable: true };
  }
  if (status === 413 || lower.includes('too long') || lower.includes('too large') || lower.includes('exceeds')) {
    return { title: 'Message too large', message: 'This conversation or attachment is too large. Start a new chat or shorten your message.', detail, retryable: false };
  }
  if (lower.includes('does not support image') || lower.includes('cannot read images')) {
    return { title: 'Images not supported', message: 'The selected model cannot read images. Switch to Auto or pick a vision-capable model.', detail, retryable: false };
  }
  if (lower.includes('not configured') || lower.includes('all configured models failed') || lower.includes('provider is temporarily unavailable')) {
    return { ...UNAVAILABLE, detail };
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed') || lower.includes('load failed')) {
    return { title: 'Connection problem', message: 'Could not reach Solo AI. Check your internet connection and try again.', detail, retryable: true };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { title: 'Took too long', message: 'The AI took too long to respond. Please try again.', detail, retryable: true };
  }
  if (status && status >= 500) {
    return { title: 'Something went wrong', message: 'Solo AI hit a server problem. Please try again.', detail, retryable: true };
  }
  if (status && status >= 400) {
    return { title: 'Request rejected', message: raw || 'The request could not be processed.', detail, retryable: false };
  }
  return { title: 'Something went wrong', message: 'Please try again.', detail, retryable: true };
}

/** Map Supabase auth errors to clear, non-technical copy. */
export function friendlyAuthMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (lower.includes('email not confirmed')) return 'Please confirm your email address first. Check your inbox for the confirmation link.';
  if (lower.includes('user already registered')) return 'An account with this email already exists. Try signing in instead.';
  if (lower.includes('password should be at least')) return 'Password must be at least 6 characters.';
  if (lower.includes('rate limit') || lower.includes('too many requests')) return 'Too many attempts. Please wait a minute and try again.';
  if (lower.includes('failed to fetch') || lower.includes('network')) return 'Could not connect. Check your internet connection.';
  if (lower.includes('invalid email') || lower.includes('valid email')) return 'Please enter a valid email address.';
  return raw || 'Something went wrong. Please try again.';
}
