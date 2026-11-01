import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
vi.mock('./supabase', () => ({ supabase: { from: () => ({ insert }) } }));

import { sendFeedback, feedbackErrorMessage } from './feedback';

describe('sendFeedback', () => {
  beforeEach(() => insert.mockReset());

  it('rejects empty or too-short messages without calling the database', async () => {
    expect(await sendFeedback({ category: 'idea', message: '  hi ' })).toMatchObject({ ok: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts trimmed text with a valid rating only', async () => {
    insert.mockResolvedValue({ error: null });
    const res = await sendFeedback({ category: 'bug', message: '  Button broken  ', rating: 9 });
    expect(res).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ category: 'bug', message: 'Button broken', rating: null }));
  });

  it('keeps a valid rating', async () => {
    insert.mockResolvedValue({ error: null });
    await sendFeedback({ category: 'praise', message: 'Great app', rating: 5 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ rating: 5 }));
  });

  it('hides database details on failure', async () => {
    insert.mockResolvedValue({ error: { message: 'duplicate key value violates constraint x' } });
    const res = await sendFeedback({ category: 'idea', message: 'something useful' });
    expect(res).toEqual({ ok: false, error: 'Could not send feedback. Please try again.' });
  });

  it('explains the daily limit', () => {
    expect(feedbackErrorMessage({ message: 'feedback limit reached for today' })).toMatch(/tomorrow/);
  });
});
