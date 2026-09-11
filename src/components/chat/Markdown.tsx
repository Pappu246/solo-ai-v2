import { memo, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex, { type Options as KatexOptions } from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { CodeBlock } from './CodeBlock';
import { SvgFigure } from './SvgFigure';
import { isSvgSource } from '../../lib/svgSanitize';
import { normalizeMathDelimiters, splitMarkdownSegments } from '../../lib/markdown';

interface MarkdownProps {
  content: string;
  /** While streaming, code blocks are rendered without highlighting. */
  live?: boolean;
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) return extractText((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

function buildComponents(live?: boolean): Components {
  return {
    // Fenced blocks arrive as <pre><code class="language-x">; inline code has no <pre> parent.
    pre({ children }) {
      const child = Array.isArray(children) ? children[0] : children;
      const props = (child && typeof child === 'object' && 'props' in child ? child.props : {}) as { className?: string; children?: ReactNode };
      const language = /language-([\w+-]+)/.exec(props.className || '')?.[1];
      const code = extractText(props.children).replace(/\n$/, '');
      // An SVG document in a fenced block renders as a sanitized graphic,
      // not as source code.
      if (isSvgSource(code, language)) return <SvgFigure code={code} language={language} live={live} />;
      return <CodeBlock code={code} language={language} live={live} />;
    },
    a({ href, children }) {
      return <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
    },
    img({ src, alt }) {
      // Never render model-generated placeholder/relative image paths. Smart
      // Image Search results are rendered separately by ImageSearchGallery.
      if (!src || !/^https?:\/\//i.test(src)) return null;
      return <img src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" className="max-w-full rounded-lg" />;
    },
  };
}

const liveComponents = buildComponents(true);
const staticComponents = buildComponents(false);

const remarkPlugins = [remarkGfm, remarkMath];
// rehype-katex never throws on bad LaTeX (it renders the source in red);
// `strict: false` additionally silences non-fatal warnings mid-stream, and
// `trust` stays off so KaTeX features that take URLs are disabled.
const katexPlugin: [typeof rehypeKatex, KatexOptions] = [rehypeKatex, { strict: false, errorColor: '#f87171' }];
const rehypePlugins = [katexPlugin];

/**
 * GFM + math + SVG renderer for assistant output.
 *
 * Math: `$…$` inline and `$$…$$` display formulas (plus `\(`…`\)` / `\[`…`\]`,
 * normalized first) render via KaTeX.
 *
 * SVG: fenced ```svg blocks and block-level `<svg>` regions render as
 * graphics — always through the strict allowlist sanitizer. All other raw
 * HTML is never rendered (`skipHtml`).
 */
export const Markdown = memo(function Markdown({ content, live }: MarkdownProps) {
  const segments = useMemo(() => splitMarkdownSegments(content), [content]);
  const components = live ? liveComponents : staticComponents;
  return (
    <div className="prose-chat text-[0.95rem]">
      {segments.map((segment, i) => (
        segment.kind === 'svg'
          ? <SvgFigure key={i} code={segment.text} live={live} />
          : (
            <ReactMarkdown key={i} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} skipHtml>
              {normalizeMathDelimiters(segment.text)}
            </ReactMarkdown>
          )
      ))}
    </div>
  );
});
