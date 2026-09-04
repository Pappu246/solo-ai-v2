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
