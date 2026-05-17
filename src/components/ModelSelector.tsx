import { useState } from 'react';
import { ChevronDown, Zap, Code, MessageCircle, Search, Brain, Gift, Sparkles, X, Eye, Pencil } from 'lucide-react';
import type { AIModel } from '../types';
import { MODEL_COLORS, DEFAULT_MODEL_COLORS } from '../types';

interface Props {
  models: AIModel[];
  selectedModel: string | null;
  autoRoute: boolean;
  onSelectModel: (id: string | null) => void;
  onToggleAutoRoute: () => void;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  coding:       <Code className="w-3.5 h-3.5" />,
  conversation: <MessageCircle className="w-3.5 h-3.5" />,
  fast:         <Zap className="w-3.5 h-3.5" />,
  research:     <Search className="w-3.5 h-3.5" />,
  reasoning:    <Brain className="w-3.5 h-3.5" />,
  free:         <Gift className="w-3.5 h-3.5" />,
  vision:       <Eye className="w-3.5 h-3.5" />,
  creative:     <Pencil className="w-3.5 h-3.5" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  coding: 'text-emerald-400', conversation: 'text-blue-400', fast: 'text-amber-400',
  research: 'text-cyan-400', reasoning: 'text-violet-400', free: 'text-green-400',
  vision: 'text-pink-400', creative: 'text-rose-400',
};

function SpeedDots({ level, max = 5 }: { level: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < level ? 'bg-amber-400' : 'bg-zinc-700'}`} />
      ))}
    </div>
  );
}

export function ModelSelector({ models, selectedModel, autoRoute, onSelectModel, onToggleAutoRoute }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedData = models.find(m => m.id === selectedModel);
  const colors = selectedModel ? (MODEL_COLORS[selectedModel] || DEFAULT_MODEL_COLORS) : { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' };
  const categories = [...new Set(models.map(m => m.category))];

  const isAuto = autoRoute && !selectedModel;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-200 hover:scale-[1.02] ${
          isAuto ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : `${colors.bg} ${colors.text} ${colors.border}`
        }`}
      >
        {isAuto ? <Sparkles className="w-3 h-3" /> : null}
        <span className="max-w-[100px] truncate">{isAuto ? 'Auto Route' : (selectedData?.name || 'Auto Route')}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full right-0 mt-2 w-80 bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl shadow-black/60 z-50 overflow-hidden animate-scale-in">
            {/* Header */}
            <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-100">AI Models</h3>
              <button onClick={() => setIsOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Auto Route */}
            <div className="p-2 border-b border-zinc-800">
              <button
                onClick={() => { onToggleAutoRoute(); onSelectModel(null); setIsOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                  isAuto ? 'bg-amber-500/10 border border-amber-500/20' : 'hover:bg-zinc-800/60 border border-transparent'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-amber-600/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-zinc-200">Auto Route</p>
                  <p className="text-[10px] text-zinc-500">Smart routing based on query type</p>
                </div>
                {isAuto && <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
              </button>
            </div>

            {/* Models by category */}
            <div className="max-h-[380px] overflow-y-auto p-2">
              {categories.map(cat => {
                const catModels = models.filter(m => m.category === cat);
                if (!catModels.length) return null;
                return (
                  <div key={cat} className="mb-1">
                    <div className={`flex items-center gap-1.5 px-2 py-1.5 ${CATEGORY_COLORS[cat] || 'text-zinc-500'}`}>
                      {CATEGORY_ICONS[cat]}
                      <span className="text-[10px] uppercase tracking-wider font-semibold capitalize">{cat}</span>
                    </div>
                    {catModels.map(model => {
                      const mc = MODEL_COLORS[model.id] || DEFAULT_MODEL_COLORS;
                      const isSel = selectedModel === model.id;
                      return (
                        <button
                          key={model.id}
                          onClick={() => { onSelectModel(model.id); setIsOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 ${
                            isSel ? `${mc.bg} ${mc.text} border ${mc.border}` : 'hover:bg-zinc-800/60 border border-transparent'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-lg ${mc.bg} flex items-center justify-center text-[9px] font-black ${mc.text}`}>
                            {model.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium text-zinc-200 truncate">{model.name}</p>
                              {model.free && <span className="text-[8px] bg-green-500/15 text-green-400 border border-green-500/20 px-1 py-0.5 rounded font-semibold">FREE</span>}
                              {model.tag && <span className="text-[8px] bg-amber-500/15 text-amber-400 border border-amber-500/20 px-1 py-0.5 rounded font-semibold">{model.tag}</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[9px] text-zinc-600">Speed</span>
                              <SpeedDots level={model.speed} />
                              <span className="text-[9px] text-zinc-600 ml-1">{(model.context_length / 1000).toFixed(0)}K ctx</span>
                            </div>
                          </div>
                          {isSel && <div className={`w-2 h-2 rounded-full ${mc.text.replace('text-', 'bg-')} animate-pulse`} />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {models.length === 0 && (
                <p className="text-zinc-600 text-xs text-center py-6">Loading models…</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
