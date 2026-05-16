import { Zap, Code, Brain, Sparkles, Globe, Cpu, Search, MessageCircle } from 'lucide-react';

interface WelcomeScreenProps {
  onSuggestion: (text: string) => void;
}

const suggestions = [
  { icon: Code, text: 'Build a React dashboard with charts', label: 'Coding', route: 'Claude 3.7 Sonnet', color: 'text-orange-400' },
  { icon: MessageCircle, text: 'Tell me about yourself, SOLO AI', label: 'Chat', route: 'GPT-4o', color: 'text-emerald-400' },
  { icon: Zap, text: 'Quick summary of blockchain', label: 'Quick', route: 'GPT-4o Mini', color: 'text-amber-400' },
  { icon: Search, text: 'Research: AI trends in 2026', label: 'Research', route: 'Gemini 2.0 Flash', color: 'text-blue-400' },
  { icon: Brain, text: 'Solve this logic puzzle step by step', label: 'Reasoning', route: 'DeepSeek R1', color: 'text-sky-400' },
  { icon: Globe, text: 'Hindi mein AI ka future batao', label: 'Hindi', route: 'Llama 3.3 70B', color: 'text-amber-300' },
  { icon: Cpu, text: 'Compare Python vs Rust performance', label: 'Compare', route: 'Qwen 2.5 72B', color: 'text-rose-400' },
  { icon: Sparkles, text: 'Why are you better than ChatGPT?', label: 'Challenge', route: 'Auto-Routed', color: 'text-amber-400' },
];

export function WelcomeScreen({ onSuggestion }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
      <div className="max-w-2xl w-full text-center">
        <div className="mb-10">
          <div className="w-24 h-24 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center shadow-2xl shadow-amber-500/30 mb-6 animate-pulse-slow">
            <Zap className="w-12 h-12 text-black" />
          </div>
          <h2 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 mb-3 tracking-tight">
            SOLO AI
          </h2>
          <p className="text-zinc-400 text-lg mb-1">
            Bold. Smart. Unapologetic. / Bold. Smart. Nirdosh.
          </p>
          <p className="text-zinc-500 text-sm">
            Created by Dara | 12 AI Models | Auto-Routing Intelligence
          </p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-medium">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              GPT-4o
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-500/10 border border-orange-500/20 text-[10px] text-orange-400 font-medium">
              <span className="w-1 h-1 rounded-full bg-orange-400 animate-pulse" />
              Claude
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-400 font-medium">
              <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />
              Gemini
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-medium">
              <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
              +9 More
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => onSuggestion(s.text)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-amber-500/30 hover:bg-zinc-800/60 text-left transition-all duration-200 group"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-amber-500/20 transition-colors duration-200">
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-amber-500/70 uppercase tracking-wider font-medium">{s.label}</p>
                  <span className="text-[8px] text-zinc-600">→ {s.route}</span>
                </div>
                <p className="text-sm text-zinc-300 group-hover:text-zinc-100 transition-colors duration-200 truncate">{s.text}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
