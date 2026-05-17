import { useState, useCallback } from 'react';
import { User, Zap, Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, Volume2 } from 'lucide-react';
import type { Message } from '../types';
import { MODEL_COLORS, DEFAULT_MODEL_COLORS } from '../types';
import { speak, stop, isSpeaking } from '../lib/tts';

interface Props {
  message: Message;
  onRegenerate?: () => void;
  showModelBadge?: boolean;
}

function ModelBadge({ modelId, modelName }: { modelId?: string; modelName?: string }) {
  if (!modelId) return null;
  const colors = MODEL_COLORS[modelId] || DEFAULT_MODEL_COLORS;
  return (
    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold ${colors.bg} ${colors.text} border ${colors.border} mt-1.5`}>
      <span className="w-1 h-1 rounded-full bg-current animate-pulse" />
      {modelName || modelId}
    </div>
  );
}

// ── Markdown renderer ──────────────────────────────────────────────────────────
function renderMarkdown(content: string): React.ReactNode[] {
  const blocks = content.split(/(```[\s\S]*?```)/g);
  return blocks.map((block, i) => {
    // Fenced code block
    if (block.startsWith('```') && block.endsWith('```')) {
      const inner = block.slice(3, -3);
      const lines = inner.split('\n');
      const lang = lines[0]?.trim() || '';
      const code = (lang ? lines.slice(1) : lines).join('\n').trim();
      return <CodeBlock key={i} lang={lang} code={code} />;
    }

    // Inline rendering
    const paragraphs = block.split(/\n\n+/);
    return paragraphs.map((para, j) => {
      if (!para.trim()) return null;

      // Headings
      if (para.startsWith('### ')) return <h3 key={`${i}-${j}`} className="text-base font-bold text-zinc-100 mt-3 mb-1">{para.slice(4)}</h3>;
      if (para.startsWith('## '))  return <h2 key={`${i}-${j}`} className="text-lg font-bold text-zinc-100 mt-4 mb-1">{para.slice(3)}</h2>;
      if (para.startsWith('# '))   return <h1 key={`${i}-${j}`} className="text-xl font-bold text-zinc-100 mt-4 mb-2">{para.slice(2)}</h1>;

      // Bullet list
      if (para.split('\n').every(l => l.match(/^[-*•]\s/))) {
        return (
          <ul key={`${i}-${j}`} className="list-none space-y-1 my-2">
            {para.split('\n').map((li, k) => (
              <li key={k} className="flex items-start gap-2 text-zinc-300">
                <span className="text-amber-400/60 mt-0.5 flex-shrink-0">•</span>
                <span>{inlineFormat(li.replace(/^[-*•]\s/, ''))}</span>
              </li>
            ))}
          </ul>
        );
      }

      // Numbered list
      if (para.split('\n').every(l => l.match(/^\d+\.\s/))) {
        return (
          <ol key={`${i}-${j}`} className="list-none space-y-1 my-2">
            {para.split('\n').map((li, k) => {
              const match = li.match(/^(\d+)\.\s(.*)/);
              if (!match) return null;
              return (
                <li key={k} className="flex items-start gap-2 text-zinc-300">
                  <span className="text-amber-400/60 font-mono text-xs mt-0.5 flex-shrink-0 w-4">{match[1]}.</span>
                  <span>{inlineFormat(match[2])}</span>
                </li>
              );
            })}
          </ol>
        );
      }

      // Blockquote
      if (para.startsWith('> ')) {
        return (
          <blockquote key={`${i}-${j}`} className="border-l-2 border-amber-500/40 pl-4 my-2 text-zinc-400 italic">
            {inlineFormat(para.slice(2))}
          </blockquote>
        );
      }

      // Normal paragraph
      return <p key={`${i}-${j}`} className="text-zinc-200 leading-relaxed my-1.5">{inlineFormat(para)}</p>;
    });
  });
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`'))     return <code key={i} className="bg-zinc-800 text-amber-300 px-1.5 py-0.5 rounded text-[0.85em] font-mono">{part.slice(1,-1)}</code>;
    if (part.startsWith('**') && part.endsWith('**'))  return <strong key={i} className="text-zinc-100 font-semibold">{part.slice(2,-2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))    return <em key={i} className="text-zinc-300 italic">{part.slice(1,-1)}</em>;
    if (part.startsWith('__') && part.endsWith('__'))  return <strong key={i} className="text-zinc-100 font-semibold">{part.slice(2,-2)}</strong>;
    if (part.startsWith('_') && part.endsWith('_'))    return <em key={i} className="text-zinc-300 italic">{part.slice(1,-1)}</em>;
    return part;
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="my-3 rounded-xl overflow-hidden border border-zinc-700/50 bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/80 border-b border-zinc-700/50">
        <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">{lang || 'code'}</span>
        <button onClick={handleCopy} className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
          {copied ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied!</span></> : <><Copy className="w-3 h-3" />Copy</>}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
        <code className="text-zinc-300 font-mono">{code}</code>
      </pre>
    </div>
  );
}

export function ChatMessage({ message, onRegenerate, showModelBadge = true }: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const handleSpeak = useCallback(() => {
    if (isSpeaking()) { stop(); setSpeaking(false); return; }
    speak(message.content);
    setSpeaking(true);
    const interval = setInterval(() => {
      if (!isSpeaking()) { setSpeaking(false); clearInterval(interval); }
    }, 500);
  }, [message.content]);

  const modelColors = !isUser && message.model ? (MODEL_COLORS[message.model] || DEFAULT_MODEL_COLORS) : null;

  return (
    <div className={`flex gap-3 animate-fade-up ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5 ${
        isUser
          ? 'bg-zinc-700/80 text-zinc-300'
          : modelColors
            ? `bg-gradient-to-br ${modelColors.bg} ${modelColors.text}`
            : 'bg-gradient-to-br from-amber-400 to-amber-600 text-black'
      }`}>
        {isUser ? <User className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[85%] md:max-w-[78%] group ${isUser ? '' : ''}`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-zinc-800/70 text-zinc-100 border border-zinc-700/40 rounded-tr-md'
            : modelColors
              ? `bg-zinc-900/60 text-zinc-200 border ${modelColors.border} rounded-tl-md`
              : 'bg-zinc-900/60 text-zinc-200 border border-zinc-800 rounded-tl-md'
        }`}>
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="prose-custom">{renderMarkdown(message.content)}</div>
          )}
        </div>

        {/* Actions */}
        {!isUser && (
          <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <ActionBtn icon={copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />} onClick={handleCopy} label="Copy" />
            <ActionBtn icon={<Volume2 className={`w-3 h-3 ${speaking ? 'text-amber-400' : ''}`} />} onClick={handleSpeak} label="Read" />
            {onRegenerate && <ActionBtn icon={<RefreshCw className="w-3 h-3" />} onClick={onRegenerate} label="Regenerate" />}
            <ActionBtn icon={<ThumbsUp className="w-3 h-3" />} onClick={() => {}} label="Good" />
            <ActionBtn icon={<ThumbsDown className="w-3 h-3" />} onClick={() => {}} label="Bad" />
          </div>
        )}

        {!isUser && showModelBadge && message.model && (
          <ModelBadge modelId={message.model} modelName={message.model_name} />
        )}
      </div>
    </div>
  );
}

function ActionBtn({ icon, onClick, label }: { icon: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all duration-150"
    >
      {icon}
    </button>
  );
}

export function StreamingMessage({ content, model }: { content: string; model?: { id: string; name: string; category: string } | null }) {
  const colors = model ? (MODEL_COLORS[model.id] || DEFAULT_MODEL_COLORS) : DEFAULT_MODEL_COLORS;

  return (
    <div className="flex gap-3 animate-fade-up">
      <div className={`flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br ${colors.bg} ${colors.text} flex items-center justify-center mt-0.5`}>
        <Zap className="w-4 h-4" />
      </div>
      <div className="max-w-[85%] md:max-w-[78%]">
        <div className={`px-4 py-3 rounded-2xl rounded-tl-md bg-zinc-900/60 text-zinc-200 border ${colors.border} text-sm leading-relaxed`}>
          <div className="prose-custom">
            {renderMarkdown(content)}
            <span className="typing-cursor" />
          </div>
        </div>
        {model && (
          <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold ${colors.bg} ${colors.text} border ${colors.border} mt-1.5`}>
            <span className="w-1 h-1 rounded-full bg-current animate-pulse" />
            {model.name || model.id}
          </div>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator({ model }: { model?: { id: string; name: string } | null }) {
  const colors = model ? (MODEL_COLORS[model.id] || DEFAULT_MODEL_COLORS) : DEFAULT_MODEL_COLORS;
  return (
    <div className="flex gap-3 animate-fade-up">
      <div className={`flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br ${colors.bg} ${colors.text} flex items-center justify-center mt-0.5`}>
        <Zap className="w-4 h-4" />
      </div>
      <div className={`px-4 py-3 rounded-2xl rounded-tl-md bg-zinc-900/60 border ${colors.border} flex items-center gap-1`}>
        <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
        <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
        <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
        {model && <span className="text-[10px] text-zinc-600 ml-2">{model.name}</span>}
      </div>
    </div>
  );
}
