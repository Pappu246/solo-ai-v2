export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  modelName?: string;
  category?: string;
  created_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  category: string;
  speed: number;
  quality: number;
  cost: number;
  free: boolean;
}

export const MODEL_CATEGORIES: Record<string, { label: string; color: string; icon: string }> = {
  coding: { label: 'Coding', color: 'emerald', icon: 'code' },
  conversation: { label: 'Chat', color: 'blue', icon: 'message' },
  fast: { label: 'Quick', color: 'amber', icon: 'zap' },
  research: { label: 'Research', color: 'cyan', icon: 'search' },
  reasoning: { label: 'Reasoning', color: 'violet', icon: 'brain' },
  free: { label: 'Free', color: 'green', icon: 'gift' },
};

export const MODEL_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  'gpt-4o': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/20' },
  'gpt-4o-mini': { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/20', glow: '' },
  'claude-3.7-sonnet': { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30', glow: 'shadow-orange-500/20' },
  'gemini-2.0-flash': { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', glow: 'shadow-blue-500/20' },
  'llama-3.3-70b': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', glow: 'shadow-amber-500/20' },
  'gpt-oss-20b': { bg: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-500/30', glow: '' },
  'deepseek-r1': { bg: 'bg-sky-500/15', text: 'text-sky-400', border: 'border-sky-500/30', glow: 'shadow-sky-500/20' },
  'qwen-2.5-72b': { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30', glow: '' },
  'mistral-small': { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30', glow: '' },
  'gemma-3-27b': { bg: 'bg-pink-500/15', text: 'text-pink-400', border: 'border-pink-500/30', glow: '' },
  'phi-4-reasoning': { bg: 'bg-indigo-500/15', text: 'text-indigo-400', border: 'border-indigo-500/30', glow: '' },
  'r1-chimera': { bg: 'bg-fuchsia-500/15', text: 'text-fuchsia-400', border: 'border-fuchsia-500/30', glow: '' },
};

export const DEFAULT_MODEL_COLORS = { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/30', glow: '' };
