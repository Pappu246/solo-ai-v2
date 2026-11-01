import { supabase } from './supabase';

export type FeedbackCategory = 'bug' | 'idea' | 'praise' | 'other';

export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  rating?: number | null;
}

export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 2000;

/** Error text safe to show: never leaks database details. */
export function feedbackErrorMessage(error: { message?: string; code?: string } | null): string {
  if (!error) return '';
  if (/limit reached/i.test(error.message ?? '')) return 'You have sent enough feedback for today. Please try again tomorrow.';
  return 'Could not send feedback. Please try again.';
}

/** Insert-only: the user cannot read feedback back, only the project owner can. */
export async function sendFeedback(input: FeedbackInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = input.message.trim();
  if (message.length < FEEDBACK_MIN) return { ok: false, error: 'Please write a little more.' };
  if (message.length > FEEDBACK_MAX) return { ok: false, error: 'Feedback is too long.' };
  const rating = input.rating && input.rating >= 1 && input.rating <= 5 ? Math.round(input.rating) : null;
  try {
    const { error } = await supabase.from('feedback').insert({
      category: input.category,
      message,
      rating,
      page: window.location.pathname.slice(0, 200),
      user_agent: navigator.userAgent.slice(0, 300),
    });
    if (error) return { ok: false, error: feedbackErrorMessage(error) };
    return { ok: true };
  } catch {
    return { ok: false, error: feedbackErrorMessage({}) };
  }
}
