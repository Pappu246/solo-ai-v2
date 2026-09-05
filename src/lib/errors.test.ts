import { describe, it, expect } from 'vitest';
import { toFriendlyError, friendlyAuthMessage, AppError } from './errors';

describe('toFriendlyError', () => {
  it('maps rate limits to a retryable message', () => {
    const e = toFriendlyError(new AppError('Rate limit exceeded. Please wait a minute.', 429));
    expect(e.title).toBe('Slow down');
    expect(e.retryable).toBe(true);
  });
  it('maps expired sessions to a non-retryable message', () => {
    expect(toFriendlyError(new AppError('Unauthorized', 401)).retryable).toBe(false);
  });
  it('maps network failures', () => {
    expect(toFriendlyError(new TypeError('Failed to fetch')).title).toBe('Connection problem');
  });
  it('keeps the raw detail for the expandable section', () => {
    const e = toFriendlyError(new AppError('All configured models failed. Groq error: 500', 502));
    expect(e.title).toBe('AI is unavailable');
    expect(e.detail).toContain('Groq error');
  });
  it('treats aborts as a stop, not an error', () => {
    const err = new Error('aborted'); err.name = 'AbortError';
    expect(toFriendlyError(err).title).toBe('Stopped');
  });
  it('never returns an empty message for unknown input', () => {
    expect(toFriendlyError(undefined).message.length).toBeGreaterThan(0);
  });
});

describe('friendlyAuthMessage', () => {
  it('rewrites Supabase auth errors', () => {
    expect(friendlyAuthMessage(new Error('Invalid login credentials'))).toBe('Incorrect email or password.');
    expect(friendlyAuthMessage(new Error('Email not confirmed'))).toMatch(/confirm/i);
    expect(friendlyAuthMessage(new Error('User already registered'))).toMatch(/already exists/i);
  });
});

describe('toFriendlyError (Phase 2)', () => {
  it('maps RLS / permission failures to a clear "No access" message', () => {
    expect(toFriendlyError(new AppError('Loading files failed', undefined, '[42501] new row violates row-level security policy')).title).toBe('No access');
    expect(toFriendlyError(new AppError('Forbidden', 403)).title).toBe('No access');
    expect(toFriendlyError(new Error('permission denied for table memories')).title).toBe('No access');
    expect(toFriendlyError(new AppError('Forbidden', 403)).retryable).toBe(false);
  });
});

describe('toFriendlyError (chat 502 fix: server error codes)', () => {
  it('turns providers_unavailable into an actionable message instead of "Something went wrong"', () => {
    const e = toFriendlyError(new AppError('AI provider is temporarily unavailable. Please try again.', 502, 'req-1', 'providers_unavailable'));
    expect(e.message).toBe('AI provider is temporarily unavailable. Please try again.');
    expect(e.title).toBe('AI is unavailable');
    expect(e.retryable).toBe(true);
    expect(e.code).toBe('providers_unavailable');
  });

  it('turns stream_incomplete into a retry hint', () => {
    const e = toFriendlyError(new AppError('The response was interrupted.', 502, undefined, 'stream_incomplete'));
    expect(e.message).toBe('The response was interrupted. You can retry to continue.');
    expect(e.retryable).toBe(true);
  });

  it('maps the remaining server codes to specific copy', () => {
    expect(toFriendlyError(new AppError('x', 502, undefined, 'empty_response')).title).toBe('Empty response');
    expect(toFriendlyError(new AppError('x', 502, undefined, 'model_unavailable')).retryable).toBe(true);
    expect(toFriendlyError(new AppError('x', 504, undefined, 'provider_timeout')).title).toBe('Took too long');
    expect(toFriendlyError(new AppError('x', 429, undefined, 'rate_limited')).title).toBe('Slow down');
    expect(toFriendlyError(new AppError('x', 413, undefined, 'context_length_exceeded')).retryable).toBe(false);
    expect(toFriendlyError(new AppError('x', 400, undefined, 'content_filtered')).retryable).toBe(false);
    expect(toFriendlyError(new AppError('At least one message is required', 400, undefined, 'invalid_request')).message).toBe('At least one message is required');
  });

  it('never falls back to the generic message for a known code', () => {
    for (const code of ['providers_unavailable', 'stream_incomplete', 'empty_response', 'model_unavailable', 'provider_timeout', 'network_error']) {
      expect(toFriendlyError(new AppError('raw', 502, undefined, code)).message).not.toBe('Please try again.');
    }
  });
});
