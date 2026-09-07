import type { Message } from '../../types';

/** Messages from the same role closer than this are visually grouped. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

export interface GroupedMessage {
  message: Message;
  index: number;
  /** First message of its consecutive same-role run — carries avatar + timestamp. */
  isFirstInGroup: boolean;
  /** Last message of its run. */
  isLastInGroup: boolean;
}

/**
 * Group consecutive same-role messages that are close in time, so a rapid
 * back-and-forth reads as two conversations instead of a wall of avatars.
 */
export function groupMessages(messages: Message[]): GroupedMessage[] {
  return messages.map((message, index) => {
    const prev = index > 0 ? messages[index - 1] : null;
    const sameRoleAsPrev = prev !== null && prev.role === message.role;
    const closeInTime =
      prev !== null &&
      Math.abs(new Date(message.created_at).getTime() - new Date(prev.created_at).getTime()) < GROUP_GAP_MS;
    const isFirstInGroup = !sameRoleAsPrev || !closeInTime;

    const next = index < messages.length - 1 ? messages[index + 1] : null;
    const sameRoleAsNext = next !== null && next.role === message.role;
    const closeToNext =
      next !== null &&
      Math.abs(new Date(next.created_at).getTime() - new Date(message.created_at).getTime()) < GROUP_GAP_MS;
    const isLastInGroup = !sameRoleAsNext || !closeToNext;

    return { message, index, isFirstInGroup, isLastInGroup };
  });
}

/** Compact timestamp for message rows: time today, "Mon, time" this year, dated otherwise. */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const sameYear = d.getFullYear() === now.getFullYear();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  if (sameYear) return `${d.toLocaleDateString(undefined, { weekday: 'short' })}, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Full precision, for hover tooltips. */
export function formatMessageTimeFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
