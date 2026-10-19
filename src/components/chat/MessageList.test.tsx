/**
 * Streaming re-render cost regression (Phase 14).
 *
 * `streamingContent` lives in the App shell, so every streamed token
 * re-renders MessageList. The message rows are memoized; for that memo to
 * hold, MessageList must hand them byte-stable props on each re-render.
 * The mock Message below mirrors the real `memo(Message)` wrapper: a render
 * count that grows while only `streamingContent` changes means an unstable
 * prop slipped into the row list.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import type { Message as MessageType } from '../../types';

const counters = vi.hoisted(() => ({ messageRenders: 0 }));

vi.mock('./Message', async () => {
  const actual = await vi.importActual<typeof import('./Message')>('./Message');
  const { memo } = await import('react');
  const MessageMock = memo(function Message() {
    counters.messageRenders += 1;
    return <div data-testid="message-row" />;
  });
  return {
    ...actual,
    Message: MessageMock,
  };
});

// Defined once at module scope so their identities are stable across
// re-renders — exactly what App.tsx passes (hook-level useCallbacks).
const onRegenerate = vi.fn();
const onEdit = vi.fn();
const onRetry = vi.fn();
const onDismissError = vi.fn();

function makeMessage(over: Pick<MessageType, 'id' | 'role' | 'content'> & Partial<MessageType>): MessageType {
  return { conversation_id: 'c1', created_at: '2026-01-01T00:00:00.000Z', ...over };
}

const baseMessages = [
  makeMessage({ id: 'm1', role: 'user', content: 'hi' }),
  makeMessage({ id: 'm2', role: 'assistant', content: 'hello there' }),
];

const baseProps = {
  messages: baseMessages,
  loading: false,
  isGenerating: true,
  streamingModel: null,
  error: null,
  canRetry: false,
  showModelBadge: false,
  ttsEnabled: false,
  ttsRate: 1,
  userInitial: 'A',
  onRegenerate,
  onEdit,
  onRetry,
  onDismissError,
};

describe('MessageList while streaming', () => {
  it('keeps memoized message rows still when only streamingContent changes', () => {
    const { rerender } = render(<MessageList {...baseProps} streamingContent="He" />);
    const afterMount = counters.messageRenders;
    expect(afterMount).toBeGreaterThan(0); // the harness counts renders at all

    // Tokens arrive: the shell re-renders MessageList each time.
    for (const token of ['Hello', 'Hello there', 'Hello there, fr']) {
      rerender(<MessageList {...baseProps} streamingContent={token} />);
    }

    // The streaming row did update, but the message rows did not re-render.
    expect(screen.getByText('Hello there, fr')).toBeInTheDocument();
    expect(counters.messageRenders).toBe(afterMount);

    // Non-vacuous: rows DO re-render when their inputs change.
    rerender(
      <MessageList
        {...baseProps}
        messages={[...baseMessages, makeMessage({ id: 'm3', role: 'user', content: 'more' })]}
        streamingContent="Hello there, friend"
      />,
    );
    expect(counters.messageRenders).toBeGreaterThan(afterMount);

    // Sensitivity check: a fresh callback identity defeats the memo — the
    // exact regression this guard exists to catch in App.tsx's props.
    const afterMessagesChange = counters.messageRenders;
    rerender(
      <MessageList {...baseProps} onEdit={vi.fn()} streamingContent="Hello there, friend!" />,
    );
    expect(counters.messageRenders).toBeGreaterThan(afterMessagesChange);
  });

  it('renders image search results with safe rel="noopener noreferrer" link attributes', async () => {
    const { Message: RealMessage } = await vi.importActual<typeof import('./Message')>('./Message');
    const msg: MessageType = {
      id: 'm_img',
      conversation_id: 'c1',
      role: 'assistant',
      content: 'Here is an image',
      created_at: '2026-01-01T00:00:00.000Z',
      images: [
        {
          title: 'Test Image',
          url: 'https://example.com/image.jpg',
          thumbnail: 'https://example.com/thumb.jpg',
          sourceUrl: 'https://example.com/source',
          sourceName: 'Example',
        },
      ],
    };

    const { container } = render(
      <RealMessage
        message={msg}
        isFirstInGroup={true}
      />
    );

    const link = container.querySelector('a[title="Test Image"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
