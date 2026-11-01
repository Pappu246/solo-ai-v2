import { useState } from 'react';
import { Star, MessageSquareHeart } from 'lucide-react';
import { Button } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { sendFeedback, FEEDBACK_MAX, type FeedbackCategory } from '../../lib/feedback';

const CATEGORIES: { id: FeedbackCategory; label: string }[] = [
  { id: 'idea', label: 'Idea' },
  { id: 'bug', label: 'Bug' },
  { id: 'praise', label: 'Praise' },
  { id: 'other', label: 'Other' },
];

/** Lets any signed-in user tell the owner what to improve. Stored privately in Supabase. */
export function FeedbackCard() {
  const t = useT();
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const submit = async () => {
    setStatus('sending');
    setError('');
    const res = await sendFeedback({ category, message, rating });
    if (res.ok) { setStatus('sent'); setMessage(''); setRating(0); return; }
    setStatus('idle');
    setError(res.error);
  };

  if (status === 'sent') {
    return (
      <div role="status" className="rounded-xl border border-border p-4 text-sm text-fg">
        <p className="font-medium">{t('Thank you! Your feedback was sent.')}</p>
        <button type="button" className="mt-1 text-xs text-fg-subtle underline" onClick={() => setStatus('idle')}>{t('Send more feedback')}</button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <MessageSquareHeart className="w-4 h-4" aria-hidden="true" />
        {t('Send feedback')}
      </div>
      <p className="text-xs text-fg-subtle">{t('Tell us what to fix or add. Only the app owner can read this.')}</p>
      <div role="radiogroup" aria-label={t('Feedback type')} className="flex flex-wrap gap-1.5">
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={category === c.id}
            onClick={() => setCategory(c.id)}
            className={cn('px-3 py-1 rounded-full text-xs border transition-colors', category === c.id ? 'bg-accent text-white border-accent' : 'border-border text-fg-muted hover:bg-surface-2/60')}
          >{t(c.label)}</button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t('Rating')} className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} / 5`} onClick={() => setRating(rating === n ? 0 : n)} className="p-0.5">
            <Star className={cn('w-5 h-5', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-fg-subtle')} />
          </button>
        ))}
      </div>
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value.slice(0, FEEDBACK_MAX))}
        rows={4}
        aria-label={t('Your feedback')}
        placeholder={t('What worked well? What was confusing or missing?')}
        className="w-full rounded-lg border border-border bg-transparent p-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      {error && <p role="alert" className="text-xs text-red-500">{t(error)}</p>}
      <Button size="md" onClick={submit} disabled={status === 'sending' || message.trim().length < 3}>
        {status === 'sending' ? t('Sending…') : t('Send')}
      </Button>
    </div>
  );
}
