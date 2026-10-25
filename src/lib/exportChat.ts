import type { Message } from '../types';

/** Render a conversation as readable Markdown (user/assistant turns, with the model name). */
export function conversationToMarkdown(title: string | null, messages: Pick<Message, 'role' | 'content' | 'model_name' | 'model'>[]): string {
  const lines = [`# ${(title || 'Chat').replace(/\s+/g, ' ').trim()}`, ''];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const who = m.role === 'user' ? 'You' : `Solo AI${m.model_name || m.model ? ` (${m.model_name || m.model})` : ''}`;
    lines.push(`## ${who}`, '', m.content.trim(), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function exportFilename(title: string | null, now = new Date()): string {
  const slug = (title || 'chat').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'chat';
  return `${slug}-${now.toISOString().slice(0, 10)}.md`;
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
