/**
 * Converts raw errors into something a non-technical user can act on,
 * while preserving the original detail for an expandable "Details" section.
 */

export interface FriendlyError {
  title: string;
  message: string;
  detail?: string;
  retryable: boolean;
}

export class AppError extends Error {
  constructor(message: string, public status?: number, public detail?: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function toFriendlyError(error: unknown): FriendlyError {
  const err = error instanceof Error ? error : new Error(String(error));
  const status = (err as AppError).status;
  const raw = err.message || '';
  const lower = raw.toLowerCase();
  const detail = (err as AppError).detail || raw || undefined;

  if (err.name === 'AbortError') {
    return { title: 'Stopped', message: 'Generation was stopped.', retryable: false };
  }
  if (status === 401 || lower.includes('session has expired') || lower.includes('unauthorized') || lower.includes('jwt')) {
    return { title: 'Signed out', message: 'Your session has expired. Please sign in again.', detail, retryable: false };
  }
  if (status === 429 || lower.includes('rate limit')) {
    return { title: 'Slow down', message: 'You are sending messages too quickly. Wait a moment and try again.', detail, retryable: true };
  }
  if (status === 413 || lower.includes('too long') || lower.includes('too large') || lower.includes('exceeds')) {
    return { title: 'Message too large', message: 'This conversation or attachment is too large. Start a new chat or shorten your message.', detail, retryable: false };
  }
  if (lower.includes('does not support image')) {
    return { title: 'Images not supported', message: 'The selected model cannot read images. Switch to Auto or pick a vision-capable model.', detail, retryable: false };
  }
  if (lower.includes('not configured') || lower.includes('all configured models failed')) {
    return { title: 'AI is unavailable', message: 'No AI provider is available right now. Please try again shortly.', detail, retryable: true };
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
