import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, X } from 'lucide-react';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import { AUTO_LANGUAGE, VOICE_LANGUAGES, detectLanguage, rememberVoiceLanguage, resolveListenLanguage } from '../../lib/languages';
import { speak, stop as stopSpeaking } from '../../lib/tts';
import { useT } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import type { Message } from '../../types';

type Phase = 'listening' | 'thinking' | 'speaking';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Settings voice language ('auto' or a BCP-47 code). */
  voiceLanguage: string;
  rate: number;
  messages: Message[];
  isGenerating: boolean;
  onSend: (text: string) => void;
  onStopGeneration: () => void;
}

/** Hands-free conversation: you talk, it answers out loud, then listens again. */
export function LiveVoice({ open, onClose, voiceLanguage, rate, messages, isGenerating, onSend, onStopGeneration }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('listening');
  const [lang, setLang] = useState(() => resolveListenLanguage(voiceLanguage));
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [denied, setDenied] = useState(false);
  const bufferRef = useRef('');
  const waitingRef = useRef(false);
  const sawGeneratingRef = useRef(false);
  const baselineRef = useRef<string | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const speech = useSpeechInput({
    lang,
    silenceMs: 1800,
    onInterim: text => setHeard(`${bufferRef.current} ${text}`.trim()),
    onFinal: text => {
      bufferRef.current = `${bufferRef.current} ${text}`.trim();
      setHeard(bufferRef.current);
      if (voiceLanguage === AUTO_LANGUAGE) {
        const detected = detectLanguage(text, langRef.current);
        if (detected !== langRef.current) { setLang(detected); langRef.current = detected; rememberVoiceLanguage(detected); }
      }
    },
    onSilence: () => {
      const text = bufferRef.current.trim();
      bufferRef.current = '';
      if (!text) return;
      speech.stop();
      baselineRef.current = [...messagesRef.current].reverse().find(m => m.role === 'assistant')?.id ?? null;
      waitingRef.current = true;
      sawGeneratingRef.current = false;
      setPhase('thinking');
      setReply('');
      onSend(text);
    },
    onDenied: () => setDenied(true),
  });
  const { start: startListening, stop: stopListening } = speech;

  const listen = useCallback(() => {
    bufferRef.current = '';
    setHeard('');
    setPhase('listening');
    startListening();
  }, [startListening]);

  // Open → listen. Close → silence everything.
  useEffect(() => {
    if (!open) return;
    setDenied(false);
    setLang(resolveListenLanguage(voiceLanguage));
    listen();
    return () => { stopListening(); stopSpeaking(); waitingRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When the answer is complete, read it aloud, then listen again.
  useEffect(() => {
    if (!open || !waitingRef.current) return;
    if (isGenerating) { sawGeneratingRef.current = true; return; }
    if (!sawGeneratingRef.current) return;
    waitingRef.current = false;
    const last = [...messages].reverse().find(m => m.role === 'assistant');
    if (!last || last.id === baselineRef.current || !last.content.trim()) { listen(); return; }
    setReply(last.content);
    setPhase('speaking');
    const replyLang = detectLanguage(last.content, voiceLanguage === AUTO_LANGUAGE ? langRef.current : voiceLanguage);
    speak(last.content, rate, 1, { lang: replyLang, onEnd: listen });
  }, [open, isGenerating, messages, rate, voiceLanguage, listen]);

  // If the message never started (offline, blocked), don't hang on "thinking".
  useEffect(() => {
    if (phase !== 'thinking') return;
    const id = window.setTimeout(() => { if (!sawGeneratingRef.current) { waitingRef.current = false; listen(); } }, 8000);
    return () => window.clearTimeout(id);
  }, [phase, listen]);

  const close = useCallback(() => {
    stopListening(); stopSpeaking(); waitingRef.current = false;
    if (isGenerating) onStopGeneration();
    onClose();
  }, [stopListening, isGenerating, onStopGeneration, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const tap = () => {
    if (phase === 'speaking') { stopSpeaking(); listen(); }
    else if (phase === 'thinking') { onStopGeneration(); waitingRef.current = false; listen(); }
    else if (!speech.listening) listen();
  };
  const status = denied
    ? t('Microphone is blocked. Allow it in your browser’s address bar and try again.')
    : phase === 'listening' ? t('Listening… speak now')
    : phase === 'thinking' ? t('Thinking…')
    : t('Speaking… tap to interrupt');
  const langLabel = VOICE_LANGUAGES.find(l => l.code === lang)?.native ?? lang;

  return (
    <div role="dialog" aria-modal="true" aria-label={t('Live voice conversation')} className="fixed inset-0 z-[60] bg-bg/95 backdrop-blur flex flex-col items-center justify-between px-6 py-8 animate-fade-in">
      <div className="w-full flex items-center justify-between">
        <span className="text-xs text-fg-muted inline-flex items-center gap-1.5"><AudioLines className="w-4 h-4" />{t('Live voice')} · {langLabel}</span>
        <button type="button" onClick={close} aria-label={t('End live voice')} className="w-10 h-10 rounded-full grid place-items-center text-fg-muted hover:bg-surface-2"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex flex-col items-center gap-6 max-w-xl w-full">
        <button
          type="button"
          onClick={tap}
          aria-label={status}
          className={cn(
            'w-36 h-36 rounded-full grid place-items-center text-white shadow-lg transition-transform',
            denied ? 'bg-danger' : 'bg-[rgb(var(--accent))]',
            phase === 'listening' && !denied && 'animate-pulse',
            phase === 'speaking' && 'scale-105',
          )}
        >
          {phase === 'listening' ? <Mic className="w-14 h-14" /> : <AudioLines className="w-14 h-14" />}
        </button>
        <p role="status" aria-live="polite" className="text-base font-medium text-fg text-center">{status}</p>
        <p className="text-sm text-fg-muted text-center min-h-[3rem] line-clamp-4 whitespace-pre-wrap" data-testid="live-voice-text">
          {phase === 'speaking' ? reply.slice(0, 280) : heard}
        </p>
      </div>

      <button type="button" onClick={close} className="px-5 h-11 rounded-full bg-danger text-white text-sm font-medium">{t('End live voice')}</button>
    </div>
  );
}
