import { Zap, Code, Brain, Globe, Search, MessageCircle, Cpu, Sparkles, FileText, Pencil } from 'lucide-react';

interface Props {
  onSuggestion: (text: string) => void;
  userName?: string;
}

const SUGGESTIONS = [
  { icon: Code,          text: 'Build a REST API with authentication in Node.js',   label: 'Code',     color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { icon: Brain,         text: 'Explain transformer architecture in deep learning',  label: 'Research', color: 'text-violet-400',  bg: 'bg-violet-500/10' },
  { icon: Search,        text: 'Compare React vs Vue vs Svelte in 2026',             label: 'Compare',  color: 'text-cyan-400',    bg: 'bg-cyan-500/10' },
  { icon: MessageCircle, text: 'Help me write a professional email to my team',      label: 'Write',    color: 'text-blue-400',    bg: 'bg-blue-500/10' },
  { icon: Cpu,           text: 'Debug this Python error: TypeError: NoneType',       label: 'Debug',    color: 'text-amber-400',   bg: 'bg-amber-500/10' },
  { icon: Globe,         text: 'AI ka future kya hai? Hindi mein batao',             label: 'Hindi',    color: 'text-amber-300',   bg: 'bg-amber-500/10' },
  { icon: FileText,      text: 'Summarize: provide a PDF or paste article text',     label: 'Summarize',color: 'text-pink-400',    bg: 'bg-pink-500/10' },
  { icon: Pencil,        text: 'Write a compelling blog post about AI ethics',       label: 'Creative', color: 'text-rose-400',    bg: 'bg-rose-500/10' },
];

const MODELS = [
  { name: 'GPT-4o',    color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  { name: 'Claude',    color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/20' },
  { name: 'Gemini',    color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20' },
  { name: 'DeepSeek',  color: 'text-sky-400',     bg: 'bg-sky-500/10 border-sky-500/20' },
  { name: 'Llama',     color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' },
  { name: '+7 more',   color: 'text-zinc-400',    bg: 'bg-zinc-800/60 border-zinc-700/40' },
];

export function WelcomeScreen({ onSuggestion, userName }: Props) {
  const greeting = userName ? `Hello, ${userName.split('@')[0]}` : 'Hello';

  return (
    <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
      <div className="max-w-2xl w-full text-center">
        {/* Hero */}
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center shadow-2xl shadow-amber-500/25 mb-6" style={{ animation: 'pulse-glow 3s ease-in-out infinite' }}>
            <Zap className="w-10 h-10 text-black" fill="black" />
          </div>

          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-2">
            <span className="gradient-text">{greeting}</span>
          </h2>
          <p className="text-zinc-500 text-base mb-1">What can I help you with today?</p>

          {/* Model pills */}
          <div className="flex items-center justify-center gap-2 flex-wrap mt-5">
            {MODELS.map(m => (
              <span key={m.name} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold ${m.bg} ${m.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full bg-current animate-pulse`} />
                {m.name}
              </span>
            ))}
          </div>
        </div>

        {/* Suggestions grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestion(s.text)}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/60 hover:border-zinc-700 hover:bg-zinc-800/60 text-left transition-all duration-200 group animate-fade-up stagger-${Math.min(i + 1, 5)}`}
            >
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-200`}>
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold mb-0.5">{s.label}</p>
                <p className="text-sm text-zinc-300 group-hover:text-zinc-100 transition-colors duration-200 leading-snug">{s.text}</p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-zinc-700 text-xs mt-6 flex items-center justify-center gap-1.5">
          <Sparkles className="w-3 h-3" />
          Auto-routing selects the best model for each query
        </p>
      </div>
    </div>
  );
}
