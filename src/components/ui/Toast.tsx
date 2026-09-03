import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastItem, type ToastOptions } from './toastContext';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems(prev => prev.filter(t => t.id !== id)), []);

  const toast = useCallback((opts: ToastOptions) => {
    const id = ++counter.current;
    const tone = opts.tone ?? 'info';
    setItems(prev => [...prev.slice(-3), { ...opts, id, tone }]);
    const duration = opts.duration ?? (tone === 'error' ? 6000 : 4000);
    if (duration > 0) window.setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
        {items.map(t => <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? AlertCircle : Info;
  const iconTone = item.tone === 'success' ? 'text-success' : item.tone === 'error' ? 'text-danger' : 'text-accent';
  return (
    <div role={item.tone === 'error' ? 'alert' : 'status'} className={cn('pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-surface shadow-lg p-3.5 animate-fade-up')}>
      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', iconTone)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-fg">{item.title}</p>
        {item.description && <p className="text-xs text-fg-muted mt-0.5 break-words">{item.description}</p>}
        {item.action && (
          <button onClick={() => { item.action?.onClick(); onDismiss(); }} className="mt-2 text-xs font-medium text-accent hover:underline">
            {item.action.label}
          </button>
        )}
      </div>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-fg-subtle hover:text-fg p-0.5 rounded"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}
