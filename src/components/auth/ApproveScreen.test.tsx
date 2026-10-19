import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApproveScreen } from './ApproveScreen';
import { PendingApprovalScreen } from './PendingApprovalScreen';

const sendDecision = vi.fn();
vi.mock('../../lib/access', async () => {
  const actual = await vi.importActual<typeof import('../../lib/access')>('../../lib/access');
  return { ...actual, sendDecision: (...a: unknown[]) => sendDecision(...a) };
});

describe('ApproveScreen', () => {
  beforeEach(() => { sendDecision.mockReset(); });

  it('shows who is asking, changes nothing until the button is pressed, then confirms', async () => {
    sendDecision.mockResolvedValue({ decision: 'approve', email: 'new@user.com' });
    render(<ApproveScreen token="t" />);
    expect(await screen.findByText('new@user.com')).toBeInTheDocument();
    expect(sendDecision).toHaveBeenCalledTimes(1);
    expect(sendDecision).toHaveBeenLastCalledWith('t', false);

    await userEvent.click(screen.getByRole('button', { name: /yes, approve/i }));
    expect(await screen.findByRole('heading', { name: 'Approved' })).toBeInTheDocument();
    expect(sendDecision).toHaveBeenLastCalledWith('t', true);
  });

  it('offers a reject wording for reject links', async () => {
    sendDecision.mockResolvedValue({ decision: 'reject', email: 'x@y.com' });
    render(<ApproveScreen token="t" />);
    expect(await screen.findByRole('button', { name: /yes, reject/i })).toBeInTheDocument();
  });

  it('explains an invalid or expired link', async () => {
    sendDecision.mockImplementation(async () => { throw new Error('This link is invalid or has expired.'); });
    render(<ApproveScreen token="bad" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.queryByRole('button', { name: /yes/i })).not.toBeInTheDocument();
  });
});

describe('PendingApprovalScreen', () => {
  it('waits for approval, lets the user re-check or sign out', async () => {
    const onRecheck = vi.fn().mockResolvedValue(undefined);
    const onSignOut = vi.fn();
    render(<PendingApprovalScreen blocked={false} email="me@x.com" onRecheck={onRecheck} onSignOut={onSignOut} />);
    expect(screen.getByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
    expect(screen.getByText('me@x.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onRecheck).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('shows a blocked state without a re-check button', () => {
    render(<PendingApprovalScreen blocked onRecheck={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Access turned off' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
  });
});
