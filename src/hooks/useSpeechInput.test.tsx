import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechInput } from './useSpeechInput';

class FakeRec {
  static all: FakeRec[] = [];
  lang = ''; continuous = false; interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() { FakeRec.all.push(this); }
  start() { this.started = true; }
  stop() { this.started = false; this.onend?.(); }
  abort() { this.started = false; }
  say(text: string, isFinal: boolean) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }); }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRec.all = [];
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRec;
});
afterEach(() => { vi.useRealTimers(); delete (window as unknown as Record<string, unknown>).SpeechRecognition; });

describe('useSpeechInput', () => {
  it('stays on through silence: restarts when the browser ends the session', () => {
    const { result } = renderHook(() => useSpeechInput({ lang: 'hi-IN', onFinal: vi.fn() }));
    act(() => result.current.start());
    expect(FakeRec.all[0].continuous).toBe(true);
    expect(FakeRec.all[0].lang).toBe('hi-IN');
    act(() => { FakeRec.all[0].onend?.(); vi.advanceTimersByTime(300); });
    expect(FakeRec.all).toHaveLength(2);
    expect(FakeRec.all[1].started).toBe(true);
    expect(result.current.listening).toBe(true);
  });

  it('ignores no-speech errors but stops when the mic is blocked', () => {
    const onDenied = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ lang: 'en-US', onFinal: vi.fn(), onDenied }));
    act(() => result.current.start());
    act(() => { FakeRec.all[0].onerror?.({ error: 'no-speech' }); FakeRec.all[0].onend?.(); vi.advanceTimersByTime(300); });
    expect(result.current.listening).toBe(true);
    act(() => FakeRec.all[1].onerror?.({ error: 'not-allowed' }));
    expect(result.current.listening).toBe(false);
    expect(onDenied).toHaveBeenCalled();
  });

  it('stop() ends for good', () => {
    const { result } = renderHook(() => useSpeechInput({ lang: 'en-US', onFinal: vi.fn() }));
    act(() => result.current.start());
    act(() => result.current.stop());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(FakeRec.all).toHaveLength(1);
    expect(result.current.listening).toBe(false);
  });

  it('calls onSilence after the pause, flushing unfinished speech', () => {
    const onFinal = vi.fn(); const onSilence = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ lang: 'en-US', silenceMs: 1500, onFinal, onSilence }));
    act(() => result.current.start());
    act(() => FakeRec.all[0].say('hello there', false));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onSilence).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(600); });
    expect(onFinal).toHaveBeenCalledWith('hello there');
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it('uses the latest language when it restarts', () => {
    const { result, rerender } = renderHook(({ lang }) => useSpeechInput({ lang, onFinal: vi.fn() }), { initialProps: { lang: 'en-US' } });
    act(() => result.current.start());
    rerender({ lang: 'ta-IN' });
    act(() => { result.current.restart(); vi.advanceTimersByTime(300); });
    expect(FakeRec.all[1].lang).toBe('ta-IN');
  });
});
