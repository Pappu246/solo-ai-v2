import { describe, it, expect } from 'vitest';
import { groupMessages, formatMessageTime, GROUP_GAP_MS } from './grouping';
import type { Message } from '../../types';

function msg(id: string, role: Message['role'], at: string): Message {
  return {
    id,
    conversation_id: 'c1',
    role,
    content: `${role} ${id}`,
    created_at: at,
  };
}

const T0 = Date.parse('2026-06-01T10:00:00.000Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

describe('groupMessages', () => {
  it('groups consecutive same-role messages that are close in time', () => {
    const g = groupMessages([msg('a', 'user', at(0)), msg('b', 'user', at(60_000))]);
    expect(g[0].isFirstInGroup).toBe(true);
    expect(g[0].isLastInGroup).toBe(false);
    expect(g[1].isFirstInGroup).toBe(false);
    expect(g[1].isLastInGroup).toBe(true);
  });

  it('starts a new group when the role changes', () => {
    const g = groupMessages([msg('a', 'user', at(0)), msg('b', 'assistant', at(30_000)), msg('c', 'user', at(60_000))]);
    expect(g.map(x => x.isFirstInGroup)).toEqual([true, true, true]);
    expect(g.map(x => x.isLastInGroup)).toEqual([true, true, true]);
  });

  it('splits same-role messages apart when the gap exceeds the limit', () => {
    const g = groupMessages([msg('a', 'user', at(0)), msg('b', 'user', at(GROUP_GAP_MS + 1000))]);
    expect(g[0].isLastInGroup).toBe(true);
    expect(g[1].isFirstInGroup).toBe(true);
  });

  it('treats a lone message as both first and last', () => {
    const g = groupMessages([msg('a', 'assistant', at(0))]);
    expect(g[0].isFirstInGroup).toBe(true);
    expect(g[0].isLastInGroup).toBe(true);
  });

  it('handles an empty list', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('keeps index and message references intact', () => {
    const messages = [msg('a', 'user', at(0)), msg('b', 'assistant', at(1000))];
    const g = groupMessages(messages);
    expect(g[0].index).toBe(0);
    expect(g[0].message).toBe(messages[0]);
  });
});

describe('formatMessageTime', () => {
  it('returns just the time for today', () => {
    const today = new Date();
    const iso = new Date(today.getTime() - 60_000).toISOString();
    const out = formatMessageTime(iso);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
    expect(out).not.toContain(',');
  });

  it('includes a weekday or date for older messages', () => {
    const old = new Date(Date.now() - 400 * 86_400_000); // ~13 months ago
    expect(formatMessageTime(old.toISOString())).not.toEqual(formatMessageTime(new Date().toISOString()));
  });

  it('returns an empty string for invalid dates', () => {
    expect(formatMessageTime('not-a-date')).toBe('');
  });
});
