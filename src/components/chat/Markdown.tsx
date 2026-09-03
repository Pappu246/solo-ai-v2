import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

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
      return <CodeBlock code={code} language={language} live={live} />;
    },
    a({ href, children }) {
      return <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
    },
  };
}

const liveComponents = buildComponents(true);
const staticComponents = buildComponents(false);

/** GFM markdown renderer for assistant output. Raw HTML is never rendered. */
export const Markdown = memo(function Markdown({ content, live }: MarkdownProps) {
  return (
    <div className="prose-chat text-[0.95rem]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={live ? liveComponents : staticComponents} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
});
