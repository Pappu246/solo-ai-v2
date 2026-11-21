import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveVoice } from './LiveVoice';
import type { Message } from '../../types';

class FakeRec {
  static last: FakeRec | null = null;
  lang = ''; continuous = false; interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FakeRec.last = this; }
  start() {} stop() { this.onend?.(); } abort() {}
}
const spoken: { text: string; lang: string }[] = [];
class FakeUtterance { text: string; lang = ''; rate = 1; pitch = 1; voice = null; onend: (() => void) | null = null; onerror = null; constructor(t: string) { this.text = t; } }

const msg = (id: string, role: 'user' | 'assistant', content: string): Message => ({ id, conversation_id: 'c', role, content, created_at: '' } as Message);

beforeEach(() => {
  vi.useFakeTimers();
  spoken.length = 0;
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRec;
  (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak: (u: FakeUtterance) => { spoken.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend?.(), 10); },
    cancel: vi.fn(), getVoices: () => [], speaking: false,
  } });
});
afterEach(() => { vi.useRealTimers(); });

describe('LiveVoice', () => {
  it('listens, sends after a pause, speaks the reply, then listens again', () => {
    const onSend = vi.fn();
    const props = { open: true, onClose: vi.fn(), voiceLanguage: 'hi-IN', rate: 1, onSend, onStopGeneration: vi.fn() };
    const { rerender } = render(<LiveVoice {...props} messages={[]} isGenerating={false} />);
    expect(screen.getByText(/Listening/)).toBeTruthy();
    expect(FakeRec.last?.lang).toBe('hi-IN');

    act(() => FakeRec.last!.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'नमस्ते' }], { isFinal: true })] }));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onSend).toHaveBeenCalledWith('नमस्ते');
    expect(screen.getByText(/Thinking/)).toBeTruthy();

    rerender(<LiveVoice {...props} messages={[msg('1', 'user', 'नमस्ते')]} isGenerating />);
    rerender(<LiveVoice {...props} messages={[msg('1', 'user', 'नमस्ते'), msg('2', 'assistant', '**नमस्ते!** मैं मदद के लिए हूँ।')]} isGenerating={false} />);
    expect(spoken[0].text).not.toContain('*');
    expect(spoken[0].lang).toBe('hi-IN');
    expect(screen.getByText(/Speaking/)).toBeTruthy();

    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText(/Listening/)).toBeTruthy();
  });

  it('End closes it', () => {
    const onClose = vi.fn();
    render(<LiveVoice open onClose={onClose} voiceLanguage="en-US" rate={1} messages={[]} isGenerating={false} onSend={vi.fn()} onStopGeneration={vi.fn()} />);
    act(() => screen.getAllByLabelText('End live voice')[0].click());
    expect(onClose).toHaveBeenCalled();
  });
});
