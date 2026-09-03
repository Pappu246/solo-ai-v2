import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '../../lib/cn';

type Hljs = typeof import('highlight.js/lib/common').default;
let hljsPromise: Promise<Hljs> | null = null;

/** Lazy-load highlight.js (common languages only, ~40) on first use so the main bundle stays small. */
function loadHljs(): Promise<Hljs> {
  if (!hljsPromise) hljsPromise = import('highlight.js/lib/common').then(m => m.default);
  return hljsPromise;
}

interface CodeBlockProps {
  code: string;
  language?: string;
  /** Skip highlighting while streaming to avoid re-tokenising on every delta. */
  live?: boolean;
}

export function CodeBlock({ code, language, live }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (live || !code) { setHtml(null); return; }
    let cancelled = false;
    loadHljs().then(hljs => {
      if (cancelled) return;
      try {
        const result = language && hljs.getLanguage(language)
          ? hljs.highlight(code, { language, ignoreIllegals: true })
          : hljs.highlightAuto(code);
        setHtml(result.value);
      } catch { setHtml(null); }
    }).catch(() => setHtml(null));
    return () => { cancelled = true; };
  }, [code, language, live]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden text-[0.9em]">
      <div className="flex items-center justify-between px-3.5 h-9 border-b border-border bg-surface-2/60">
        <span className="text-[11px] font-medium text-fg-muted font-mono lowercase">{language || 'text'}</span>
        <button
          type="button"
          onClick={copy}
          className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium rounded px-1.5 py-0.5 transition-colors', copied ? 'text-success' : 'text-fg-muted hover:text-fg')}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto leading-relaxed">
        {html ? (
          <code className={cn('hljs', language && `language-${language}`)} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="hljs">{code}</code>
        )}
      </pre>
    </div>
  );
}
