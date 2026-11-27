import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Clock, ExternalLink, FileText, HelpCircle, Loader2,
  PlayCircle, RefreshCw, Sparkles, Trash2, Brain, Check, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Button, Spinner, useToast } from '../ui';
import { cn } from '../../lib/cn';
import { useT, getLanguage } from '../../lib/i18n';
import { renderMarkdownToHtml } from '../../lib/exportPdf';
import {
  fetchStudyPack, forgetStudyResult, loadStudyCache, parseVideoId,
  rememberStudyResult, watchUrl, type StudyResult, type StudyNote,
} from '../../lib/study/study';

type Status = 'idle' | 'loading' | 'generating' | 'error' | 'done';
type Tab = 'notes' | 'quiz' | 'flashcards';

const TAB_ICONS: Record<Tab, typeof FileText> = {
  notes: FileText,
  quiz: HelpCircle,
  flashcards: Brain,
};

/** Render note markdown once per body (async: react-markdown + katex are lazy). */
function useNoteHtml(body: string): string {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let active = true;
    setHtml('');
    renderMarkdownToHtml(body)
      .then(h => { if (active) setHtml(h); })
      .catch(() => { if (active) setHtml(''); });
    return () => { active = false; };
  }, [body]);
  return html;
}

/** Small timestamp link that opens the video at that moment. */
function Timestamp({ videoId, seconds, label }: { videoId: string; seconds: number | null; label: string }) {
  if (seconds === null || seconds < 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  const text = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
  return (
    <a
      href={watchUrl(videoId, seconds)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted hover:text-accent hover:border-accent/40"
      title={label}
    >
      <Clock className="w-3 h-3" />
      {text}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

/** A multiple-choice question with answer reveal and explanation. */
function QuizCard({
  question, options, answerIndex, explanation, timestamp, videoId,
  picked, onAnswer,
}: {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  timestamp: number | null;
  videoId: string;
  picked: number | undefined;
  onAnswer: (picked: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-fg">{question}</p>
        <Timestamp videoId={videoId} seconds={timestamp} label="Jump to this moment" />
      </div>
      <div className="mt-3 space-y-2">
        {options.map((option, i) => {
          const isAnswer = i === answerIndex;
          const isPicked = i === picked;
          const showState = picked !== undefined;
          return (
            <button
              key={i}
              type="button"
              disabled={picked !== undefined}
              onClick={() => onAnswer(i)}
              className={cn(
                'w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                'border-border bg-canvas hover:border-accent/40 hover:bg-surface-2',
                showState && isAnswer && 'border-emerald-500/60 bg-emerald-500/10',
                showState && !isAnswer && isPicked && 'border-danger/60 bg-danger/10',
                picked !== undefined && 'cursor-default',
              )}
            >
              {showState && isAnswer ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : null}
              {showState && !isAnswer && isPicked ? <X className="w-3.5 h-3.5 text-danger shrink-0" /> : null}
              <span className={cn(showState && isAnswer ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg')}>
                {option}
              </span>
            </button>
          );
        })}
      </div>
      {picked !== undefined && explanation && (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-muted">{explanation}</p>
      )}
    </div>
  );
}

/** A flip card for flashcards. */
function Flashcard({
  front, back, timestamp, videoId, index, total,
  onPrev, onNext,
}: {
  front: string;
  back: string;
  timestamp: number | null;
  videoId: string;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-fg-subtle">{index + 1} / {total}</span>
        <Timestamp videoId={videoId} seconds={timestamp} label="Jump to this moment" />
      </div>
      <button
        type="button"
        onClick={() => setFlipped(f => !f)}
        className="w-full rounded-lg border border-border bg-surface p-8 text-center min-h-[150px] flex flex-col items-center justify-center gap-2 hover:border-accent/40 transition-colors"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          {flipped ? 'Answer' : 'Question'}
        </span>
        <span className={cn('text-base font-medium', flipped ? 'text-accent' : 'text-fg')}>
          {flipped ? back : front}
        </span>
      </button>
      <div className="mt-3 flex items-center justify-center gap-2">
        <Button size="sm" variant="ghost" onClick={onPrev} disabled={index === 0} leftIcon={<ChevronLeft className="w-4 h-4" />}>
          Prev
        </Button>
        <Button size="sm" variant="ghost" onClick={onNext} disabled={index === total - 1} leftIcon={<ChevronRight className="w-4 h-4" />}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** The full Study view: YouTube link → transcript → notes, quiz, flashcards. */
export function StudyView() {
  const tr = useT();
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<StudyResult | null>(null);
  const [tab, setTab] = useState<Tab>('notes');
  const [history, setHistory] = useState<StudyResult[]>([]);
  const [answered, setAnswered] = useState<Record<number, number>>({});
  const [flashIndex, setFlashIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHistory(loadStudyCache());
  }, []);

  const languageName = useMemo(() => {
    return getLanguage() === 'hi' ? 'Hindi' : 'English';
  }, []);

  const runGenerate = async (target: string) => {
    const videoId = parseVideoId(target);
    if (!videoId) {
      toast({ title: tr('Paste a valid YouTube link or video id.'), tone: 'error' });
      inputRef.current?.focus();
      return;
    }
    setStatus('loading');
    setError('');
    setResult(null);
    setAnswered({});
    setFlashIndex(0);
    try {
      // The Edge Function fetches the transcript and builds the pack in one call;
      // the staged label just makes the wait honest about what is happening.
      const response = await fetchStudyPack({ url: target, language: languageName });
      setStatus('generating');
      const next = rememberStudyResult(response);
      setHistory(next);
      setResult(response);
      setTab(response.pack.notes.length ? 'notes' : response.pack.quiz.length ? 'quiz' : 'flashcards');
      toast({ title: tr('Study pack ready'), tone: 'success' });
      setStatus('done');
    } catch (e) {
      const message = e instanceof Error ? e.message : tr('The study pack could not be generated. Please try again.');
      setError(message);
      setStatus('error');
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'loading' || status === 'generating') return;
    void runGenerate(url);
  };

  const loadFromHistory = (entry: StudyResult) => {
    setResult(entry);
    setError('');
    setStatus('done');
    setAnswered({});
    setFlashIndex(0);
    setTab(entry.pack.notes.length ? 'notes' : entry.pack.quiz.length ? 'quiz' : 'flashcards');
  };

  const removeFromHistory = (videoId: string) => {
    const next = forgetStudyResult(videoId);
    setHistory(next);
    if (result?.videoId === videoId) setResult(null);
  };

  const busy = status === 'loading' || status === 'generating';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-accent" />
          <h1 className="text-base font-semibold">{tr('Study')}</h1>
        </div>
        <p className="text-xs text-fg-subtle mt-1">
          {tr('Paste a YouTube link — Solo pulls the transcript and builds notes, a quiz and flashcards with timestamps.')}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* History strip */}
        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{tr('Recent')}</span>
            {history.map(entry => (
              <div key={entry.videoId} className="group inline-flex items-center gap-1 rounded-full border border-border bg-canvas pl-3 pr-1.5 py-1">
                <button
                  type="button"
                  onClick={() => loadFromHistory(entry)}
                  className="max-w-[220px] truncate text-xs text-fg-muted hover:text-accent"
                  title={entry.pack.title}
                >
                  {entry.pack.title}
                </button>
                <button
                  type="button"
                  onClick={() => removeFromHistory(entry.videoId)}
                  className="rounded-full p-1 text-fg-subtle hover:text-danger hover:bg-surface-2"
                  title={tr('Remove')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input card */}
        <form onSubmit={onSubmit} className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{tr('YouTube link')}</span>
            <div className="mt-1 flex items-center gap-2">
              <PlayCircle className="w-4 h-4 text-fg-subtle shrink-0" />
              <input
                ref={inputRef}
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=… or a video id"
                className="w-full rounded-md border border-border bg-canvas px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={busy || !url.trim()}
              leftIcon={!busy ? <Sparkles className="w-4 h-4" /> : undefined}>
              {status === 'loading' ? tr('Fetching transcript…')
                : status === 'generating' ? tr('Building study pack…')
                : tr('Generate study pack')}
            </Button>
            {status === 'error' && (
              <button type="button" onClick={() => void runGenerate(url)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 h-9 text-sm text-fg-muted hover:bg-surface-2">
                <RefreshCw className="w-4 h-4" />
                {tr('Try again')}
              </button>
            )}
          </div>
          {status === 'error' && error && (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}
        </form>

        {status === 'loading' && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            <Spinner className="w-4 h-4" />
            {tr('Fetching the transcript from YouTube…')}
          </div>
        )}

        {status === 'generating' && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            {tr('Building the study pack with the free study model…')}
          </div>
        )}

        {/* Result */}
        {result && status === 'done' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{result.pack.title}</h2>
                  <a
                    href={watchUrl(result.videoId)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {tr('Watch video')}
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => removeFromHistory(result.videoId)}
                  className="rounded-md p-1.5 text-fg-subtle hover:text-danger hover:bg-surface-2"
                  title={tr('Remove')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {result.pack.summary && (
                <p className="mt-2 text-sm text-fg-muted">{result.pack.summary}</p>
              )}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
              {(Object.keys(TAB_ICONS) as Tab[]).map(key => {
                const Icon = TAB_ICONS[key];
                const count = key === 'notes' ? result.pack.notes.length
                  : key === 'quiz' ? result.pack.quiz.length
                  : result.pack.flashcards.length;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      tab === key ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-surface-2',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {key === 'notes' ? tr('Notes') : key === 'quiz' ? tr('Quiz') : tr('Flashcards')}
                    <span className={cn('text-xs', tab === key ? 'text-accent-fg/70' : 'text-fg-subtle')}>{count}</span>
                  </button>
                );
              })}
            </div>

            {tab === 'notes' && (
              <div className="space-y-4">
                {result.pack.notes.map((note, i) => <NoteBlock key={i} note={note} videoId={result.videoId} />)}
                {!result.pack.notes.length && <Empty text={tr('No notes were generated for this video.')} />}
              </div>
            )}

            {tab === 'quiz' && (
              <div className="space-y-3">
                {result.pack.quiz.map((q, i) => (
                  <QuizCard
                    key={i}
                    question={q.question}
                    options={q.options}
                    answerIndex={q.answerIndex}
                    explanation={q.explanation}
                    timestamp={q.timestamp}
                    videoId={result.videoId}
                    picked={answered[i]}
                    onAnswer={pick => setAnswered(prev => ({ ...prev, [i]: pick }))}
                  />
                ))}
                {!result.pack.quiz.length && <Empty text={tr('No quiz questions were generated for this video.')} />}
                {result.pack.quiz.length > 0 && (
                  <p className="text-xs text-fg-subtle">
                    {tr('Answered')} {Object.keys(answered).length} / {result.pack.quiz.length}
                  </p>
                )}
              </div>
            )}

            {tab === 'flashcards' && (
              <div className="space-y-4">
                {result.pack.flashcards.length > 0 && (
                  <Flashcard
                    front={result.pack.flashcards[flashIndex].front}
                    back={result.pack.flashcards[flashIndex].back}
                    timestamp={result.pack.flashcards[flashIndex].timestamp}
                    videoId={result.videoId}
                    index={flashIndex}
                    total={result.pack.flashcards.length}
                    onPrev={() => setFlashIndex(i => Math.max(0, i - 1))}
                    onNext={() => setFlashIndex(i => Math.min(result.pack.flashcards.length - 1, i + 1))}
                  />
                )}
                {!result.pack.flashcards.length && <Empty text={tr('No flashcards were generated for this video.')} />}
              </div>
            )}
          </div>
        )}

        {status === 'idle' && !result && (
          <div className="rounded-lg border border-dashed border-border bg-surface/50 p-8 text-center">
            <BookOpen className="mx-auto w-8 h-8 text-fg-subtle" />
            <p className="mt-3 text-sm text-fg-muted max-w-md mx-auto">
              {tr('Paste any YouTube video link with captions. Solo fetches the transcript for free and builds structured study notes, a multiple-choice quiz and flashcards — each tied to the moment in the video it came from.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function NoteBlock({ note, videoId }: { note: StudyNote; videoId: string }) {
  const html = useNoteHtml(note.body);
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-fg">{note.heading}</h3>
        <Timestamp videoId={videoId} seconds={note.timestamp} label="Jump to this moment" />
      </div>
      {html
        ? <div className="note-body text-sm text-fg-muted [&_a]:text-accent [&_a]:underline [&_code]:bg-surface-2 [&_code]:rounded [&_code]:px-1 [&_pre]:bg-surface-2 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_strong]:text-fg" dangerouslySetInnerHTML={{ __html: html }} />
        : <Spinner className="w-4 h-4" />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border bg-surface/50 p-6 text-center text-sm text-fg-subtle">{text}</p>;
}
