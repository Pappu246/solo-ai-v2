import { memo, useMemo, useState } from 'react';
import { Copy, Check, ShieldCheck } from 'lucide-react';
import { sanitizeSvg } from '../../lib/svgSanitize';
import { cn } from '../../lib/cn';
import { CodeBlock } from './CodeBlock';

interface Props {
  code: string;
  /** Fenced-block language tag (svg/xml), for the fallback code header. */
  language?: string;
  /** While streaming, show the raw code — the graphic appears once complete. */
  live?: boolean;
}

/**
 * A model-provided SVG rendered as a graphic. The markup passes through a
 * strict allowlist sanitizer first (see `lib/svgSanitize`); only that inert
 * output is injected via `dangerouslySetInnerHTML`. Anything that fails to
 * parse or sanitize falls back to a plain code block — never raw markup.
 */
export const SvgFigure = memo(function SvgFigure({ code, language = 'svg', live }: Props) {
  const [copied, setCopied] = useState(false);
  const sanitized = useMemo(() => sanitizeSvg(code), [code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  if (live) return <CodeBlock code={code} language={language} live />;
  if (!sanitized) return <CodeBlock code={code} language={language} />;

  return (
    <figure className="my-3 rounded-xl border border-border bg-surface overflow-hidden" data-testid="svg-figure">
      <figcaption className="flex items-center justify-between px-3.5 h-9 border-b border-border bg-surface-2/60">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-muted font-mono lowercase">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
          svg · sanitized preview
        </span>
        <button
          type="button"
          onClick={copy}
          className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium rounded px-1.5 py-0.5 transition-colors', copied ? 'text-success' : 'text-fg-muted hover:text-fg')}
          aria-label={copied ? 'Copied SVG source' : 'Copy SVG source'}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <div
        className="p-4 flex items-center justify-center [&>svg]:max-h-[420px] overflow-auto"
        role="img"
        aria-label="Assistant-generated SVG graphic"
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    </figure>
  );
});
