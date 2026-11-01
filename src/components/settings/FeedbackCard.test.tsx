import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sendFeedback = vi.fn();
vi.mock('../../lib/feedback', async () => {
  const actual = await vi.importActual<typeof import('../../lib/feedback')>('../../lib/feedback');
  return { ...actual, sendFeedback: (...a: unknown[]) => sendFeedback(...a) };
});

import { FeedbackCard } from './FeedbackCard';

describe('FeedbackCard', () => {
  it('keeps Send disabled until there is a real message, then submits and thanks', async () => {
    sendFeedback.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<FeedbackCard />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Bug' }));
    await user.click(screen.getByRole('radio', { name: '4 / 5' }));
    await user.type(screen.getByLabelText('Your feedback'), 'Sidebar overlaps on phone');
    expect(send).toBeEnabled();
    await user.click(send);
    expect(sendFeedback).toHaveBeenCalledWith({ category: 'bug', message: 'Sidebar overlaps on phone', rating: 4 });
    expect(await screen.findByRole('status')).toHaveTextContent('Thank you');
  });

  it('shows a readable error and keeps the text when sending fails', async () => {
    sendFeedback.mockResolvedValue({ ok: false, error: 'Could not send feedback. Please try again.' });
    const user = userEvent.setup();
    render(<FeedbackCard />);
    await user.type(screen.getByLabelText('Your feedback'), 'Please add dark mode');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send feedback');
    expect(screen.getByLabelText('Your feedback')).toHaveValue('Please add dark mode');
  });
});
