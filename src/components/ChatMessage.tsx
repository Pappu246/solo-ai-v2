import { User, Zap } from 'lucide-react';
import type { Message } from '../types';
import { MODEL_COLORS, DEFAULT_MODEL_COLORS } from '../types';

interface ChatMessageProps {
  message: Message;
}

function ModelBadge({ modelId, modelName }: { modelId?: string; modelName?: string }) {
  if (!modelId) return null;
  const colors = MODEL_COLORS[modelId] || DEFAULT_MODEL_COLORS;

  return (
    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold ${colors.bg} ${colors.text} border ${colors.border} mt-1`}>
      <span className="w-1 h-1 rounded-full bg-current animate-pulse" />
      {modelName || modelId}
    </div>
  );
}

function formatContent(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const lines = part.slice(3, -3).split('\n');
      const lang = lines[0]?.trim() || '';
      const code = lang ? lines.slice(1).join('\n') : lines.join('\n');

      return (
        <div key={i} className="my-3 rounded-lg overflow-hidden border border-zinc-700/50">
          {lang && (
            <div className="bg-zinc-800 px-3 py-1.5 text-[10px] text-zinc-400 font-mono uppercase tracking-wider border-b border-zinc-700/50">
              {lang}
            </div>
          )}
          <pre className="bg-zinc-900/80 p-4 overflow-x-auto text-sm leading-relaxed">
            <code className="text-amber-200/90 font-mono">{code}</code>
          </pre>
        </div>
      );
    }

    return (
      <span key={i}>
        {part.split(/(`[^`]+`)/g).map((segment, j) => {
          if (segment.startsWith('`') && segment.endsWith('`')) {
            return (
              <code key={j} className="bg-zinc-800 text-amber-300 px-1.5 py-0.5 rounded text-sm font-mono">
                {segment.slice(1, -1)}
              </code>
            );
          }
          return segment.split(/(\*\*[^*]+\*\*)/g).map((s, k) => {
            if (s.startsWith('**') && s.endsWith('**')) {
              return <strong key={k} className="text-amber-300 font-semibold">{s.slice(2, -2)}</strong>;
            }
            return <span key={k}>{s}</span>;
          });
        })}
      </span>
    );
  });
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const modelColors = !isUser && message.model ? (MODEL_COLORS[message.model] || DEFAULT_MODEL_COLORS) : null;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-1 transition-all duration-300 ${
          isUser
            ? 'bg-zinc-700 text-zinc-300'
            : modelColors
              ? `bg-gradient-to-br ${modelColors.bg.replace('/15', '/30')} ${modelColors.text} shadow-lg ${modelColors.glow}`
              : 'bg-gradient-to-br from-amber-400 to-amber-600 text-black'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? '' : ''}`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-amber-500/15 text-amber-50 border border-amber-500/20 rounded-tr-md'
              : modelColors
                ? `bg-zinc-800/80 text-zinc-200 border ${modelColors.border} rounded-tl-md`
                : 'bg-zinc-800/80 text-zinc-200 border border-zinc-700/50 rounded-tl-md'
          }`}
        >
          <div className="whitespace-pre-wrap break-words">{formatContent(message.content)}</div>
        </div>
        {!isUser && <ModelBadge modelId={message.model} modelName={message.modelName} />}
      </div>
    </div>
  );
}

export function StreamingMessage({ content, model }: { content: string; model?: { id: string; name: string; category: string } | null }) {
  const colors = model ? (MODEL_COLORS[model.id] || DEFAULT_MODEL_COLORS) : { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', glow: 'shadow-amber-500/20' };

  return (
    <div className="flex gap-3 animate-in fade-in duration-200">
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br ${colors.bg.replace('/15', '/30')} ${colors.text} flex items-center justify-center mt-1 shadow-lg ${colors.glow} transition-all duration-500`}>
        <Zap className="w-4 h-4" />
      </div>
      <div className="max-w-[80%]">
        <div className={`px-4 py-3 rounded-2xl rounded-tl-md bg-zinc-800/80 text-zinc-200 border ${colors.border} text-sm leading-relaxed transition-colors duration-500`}>
          <div className="whitespace-pre-wrap break-words">
            {formatContent(content)}
            <span className="inline-block w-2 h-4 bg-amber-400 ml-0.5 animate-pulse" />
          </div>
        </div>
        {model && <ModelBadge modelId={model.id} modelName={model.name} />}
      </div>
    </div>
  );
}
