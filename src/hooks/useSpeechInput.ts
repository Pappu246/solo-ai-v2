import { useCallback, useEffect, useRef, useState } from 'react';

interface ResultLike { isFinal: boolean; 0: { transcript: string } }
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ResultLike> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function getRecognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface SpeechInputOptions {
  /** BCP-47 language to listen for. Read again on every restart, so it can change live. */
  lang: string;
  /** > 0: call `onSilence` this long after the person stops talking. 0 = never auto-stop. */
  silenceMs?: number;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onSilence?: () => void;
  /** The mic was blocked or missing. */
  onDenied?: () => void;
}

/**
 * Browser speech-to-text (Web Speech API). It keeps listening through pauses —
 * browsers end a recognition session after a few seconds of quiet, so we restart
 * it until `stop()` is called.
 */
export function useSpeechInput(options: SpeechInputOptions) {
  const [listening, setListening] = useState(false);
  const optsRef = useRef(options);
  optsRef.current = options;
  const recRef = useRef<RecognitionLike | null>(null);
  const activeRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const restartRef = useRef<number | null>(null);
  const heardRef = useRef(false);
  const interimRef = useRef('');
  const supported = getRecognitionCtor() !== null;

  const clearTimers = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (restartRef.current) window.clearTimeout(restartRef.current);
    timerRef.current = null; restartRef.current = null;
  }, []);

  const flushSilence = useCallback(() => {
    timerRef.current = null;
    if (!activeRef.current || !heardRef.current) return;
    heardRef.current = false;
    const pending = interimRef.current.trim();
    interimRef.current = '';
    if (pending) optsRef.current.onFinal(pending);
    optsRef.current.onSilence?.();
  }, []);

  const spawn = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || !activeRef.current) return;
    const rec = new Ctor();
    rec.lang = optsRef.current.lang || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) { if (text.trim()) { interimRef.current = ''; optsRef.current.onFinal(text.trim()); } }
        else interim += text;
      }
      interimRef.current = interim;
      optsRef.current.onInterim?.(interim);
      heardRef.current = true;
      const ms = optsRef.current.silenceMs ?? 0;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (ms > 0) timerRef.current = window.setTimeout(flushSilence, ms);
    };
    rec.onerror = e => {
      const err = e?.error;
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        activeRef.current = false;
        clearTimers();
        setListening(false);
        optsRef.current.onDenied?.();
      }
      // 'no-speech' / 'aborted' / 'network': onend follows and we restart.
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      if (!activeRef.current) { setListening(false); return; }
      restartRef.current = window.setTimeout(spawn, 200);
    };
    recRef.current = rec;
    try { rec.start(); } catch { activeRef.current = false; setListening(false); }
  }, [clearTimers, flushSilence]);

  const start = useCallback(() => {
    if (activeRef.current || !getRecognitionCtor()) return;
    activeRef.current = true;
    heardRef.current = false;
    interimRef.current = '';
    setListening(true);
    spawn();
  }, [spawn]);

  const stop = useCallback(() => {
    activeRef.current = false;
    clearTimers();
    interimRef.current = '';
    heardRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
  }, [clearTimers]);

  /** Re-open the session now (used after the listening language changes). */
  const restart = useCallback(() => {
    if (activeRef.current) try { recRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const toggle = useCallback(() => { if (activeRef.current) stop(); else start(); }, [start, stop]);

  useEffect(() => () => { activeRef.current = false; clearTimers(); recRef.current?.abort(); }, [clearTimers]);

  return { supported, listening, start, stop, restart, toggle };
}
