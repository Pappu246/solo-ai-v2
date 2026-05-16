import { useState } from 'react';
import { ChevronDown, Zap, Code, MessageCircle, Search, Brain, Gift, Sparkles, X } from 'lucide-react';
import type { AIModel } from '../types';
import { MODEL_COLORS, DEFAULT_MODEL_COLORS } from '../types';

interface ModelSelectorProps {
  models: AIModel[];
  selectedModel: string | null;
  autoRoute: boolean;
  onSelectModel: (id: string | null) => void;
  onToggleAutoRoute: () => void;
}

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  coding: { label: 'Coding', icon: <Code className="w-3.5 h-3.5" />, color: 'text-emerald-400' },
  conversation: { label: 'Chat', icon: <MessageCircle className="w-3.5 h-3.5" />, color: 'text-blue-400' },
  fast: { label: 'Quick', icon: <Zap className="w-3.5 h-3.5" />, color: 'text-amber-400' },
  research: { label: 'Research', icon: <Search className="w-3.5 h-3.5" />, color: 'text-cyan-400' },
  reasoning: { label: 'Reasoning', icon: <Brain className="w-3.5 h-3.5" />, color: 'text-sky-400' },
  free: { label: 'Free', icon: <Gift className="w-3.5 h-3.5" />, color: 'text-green-400' },
};

function SpeedDots({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i <= level ? 'bg-amber-400' : 'bg-zinc-700'}`}
        />
      ))}
    </div>
  );
}

export function ModelSelector({ models, selectedModel, autoRoute, onSelectModel, onToggleAutoRoute }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectedModelData = models.find((m) => m.id === selectedModel);
  const colors = selectedModel ? (MODEL_COLORS[selectedModel] || DEFAULT_MODEL_COLORS) : { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' };

  const categories = [...new Set(models.map((m) => m.category))];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200 hover:scale-[1.02] ${
          autoRoute && !selectedModel
            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            : `${colors.bg} ${colors.text} ${colors.border}`
        }`}
      >
        {autoRoute && !selectedModel ? (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto Route</span>
          </>
        ) : selectedModelData ? (
          <>
            <span>{selectedModelData.name}</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto Route</span>
          </>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-80 bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">AI Models</h3>
              <button onClick={() => setIsOpen(false)} className="text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Auto Route Toggle */}
            <div className="p-3 border-b border-zinc-800">
              <button
                onClick={() => { onToggleAutoRoute(); onSelectModel(null); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                  autoRoute && !selectedModel
                    ? 'bg-amber-500/15 border border-amber-500/30'
                    : 'hover:bg-zinc-800/60 border border-transparent'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-zinc-200">Auto Route</p>
                  <p className="text-[10px] text-zinc-500">Smart model selection based on your query</p>
                </div>
                {autoRoute && !selectedModel && (
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>
            </div>

            {/* Model Categories */}
            <div className="max-h-80 overflow-y-auto p-2">
              {categories.map((cat) => {
                const catModels = models.filter((m) => m.category === cat);
                const meta = CATEGORY_META[cat];
                if (!meta || catModels.length === 0) return null;

                return (
                  <div key={cat} className="mb-2">
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <span className={meta.color}>{meta.icon}</span>
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{meta.label}</span>
                    </div>
                    {catModels.map((model) => {
                      const mColors = MODEL_COLORS[model.id] || DEFAULT_MODEL_COLORS;
                      const isSelected = selectedModel === model.id;

                      return (
                        <button
                          key={model.id}
                          onClick={() => { onSelectModel(model.id); setIsOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
                            isSelected
                              ? `${mColors.bg} ${mColors.text} border ${mColors.border}`
                              : 'hover:bg-zinc-800/60 border border-transparent'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-md ${mColors.bg} flex items-center justify-center text-[10px] font-bold ${mColors.text}`}>
                            {model.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="text-xs font-medium text-zinc-200 truncate">{model.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[9px] text-zinc-500">Spd</span>
                              <SpeedDots level={model.speed} />
                              {model.free && (
                                <span className="text-[9px] text-green-500 font-medium ml-1">FREE</span>
                              )}
                            </div>
                          </div>
                          {isSelected && (
                            <div className={`w-2 h-2 rounded-full ${mColors.text.replace('text-', 'bg-')} animate-pulse`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
