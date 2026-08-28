// ─── Core Data Types ────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  user_id: string;
  folder_id?: string | null;
  pinned: boolean;
  model_id?: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  model_name?: string;
  category?: string;
  attachments?: Attachment[];
  tokens_used?: number;
  reaction?: 'like' | 'dislike' | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: 'image' | 'pdf' | 'docx' | 'txt' | 'csv' | 'audio' | 'video';
  url?: string;
  base64?: string;
  size: number;
  extracted_text?: string;
  mime_type?: string;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  user_id: string;
  created_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ─── AI Model Types ──────────────────────────────────────────────────────────

export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'groq' | 'deepseek' | 'mistral' | 'openrouter';
export type ModelCategory = 'coding' | 'conversation' | 'fast' | 'research' | 'reasoning' | 'free' | 'vision' | 'creative';

export interface AIModel {
  id: string;
  name: string;
  provider: ModelProvider;
  category: ModelCategory;
  speed: number;
  quality: number;
  cost: number;
  free: boolean;
  context_length: number;
  supports_vision: boolean;
  supports_tools: boolean;
  description?: string;
  tag?: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light' | 'system';
export type AccentColor = 'amber' | 'blue' | 'violet' | 'emerald' | 'rose' | 'cyan';

export interface UserSettings {
  theme: Theme;
  accent: AccentColor;
  font_size: 'sm' | 'base' | 'lg';
  send_on_enter: boolean;
  show_model_badges: boolean;
  auto_title: boolean;
  tts_enabled: boolean;
  tts_voice: string;
  memory_enabled: boolean;
  default_model: string;
}

// ─── Model Color Maps ─────────────────────────────────────────────────────────

export const MODEL_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  'gpt-4o':           { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/20' },
  'gpt-4o-mini':      { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/20', glow: '' },
  'claude-sonnet-5':  { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30', glow: 'shadow-orange-500/20' },
  'claude-opus-5':    { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30', glow: 'shadow-red-500/20' },
  'claude-haiku-4-5-20251001': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', glow: '' },
  'gemini-3.7-flash':  { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', glow: 'shadow-blue-500/20' },
  'gemini-3.1-pro':    { bg: 'bg-indigo-500/15', text: 'text-indigo-400', border: 'border-indigo-500/30', glow: 'shadow-indigo-500/20' },
  'llama-3.3-70b':     { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', glow: 'shadow-amber-500/20' },
  'llama-3.1-8b':      { bg: 'bg-yellow-500/10', text: 'text-yellow-300', border: 'border-yellow-500/20', glow: '' },
  'gpt-oss-20b':       { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/20', glow: '' },
  'gpt-oss-120b':      { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/20' },
  'deepseek-v4-pro':   { bg: 'bg-sky-500/15', text: 'text-sky-400', border: 'border-sky-500/30', glow: 'shadow-sky-500/20' },
  'deepseek-v4-flash': { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30', glow: 'shadow-cyan-500/20' },
};

export const DEFAULT_MODEL_COLORS = { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/30', glow: '' };

export const MODEL_CATEGORIES: Record<ModelCategory, { label: string; color: string }> = {
  coding:       { label: 'Coding',    color: 'emerald' },
  conversation: { label: 'Chat',      color: 'blue' },
  fast:          { label: 'Quick',     color: 'amber' },
  research:     { label: 'Research',  color: 'cyan' },
  reasoning:    { label: 'Reasoning', color: 'violet' },
  free:         { label: 'Free',      color: 'green' },
  vision:       { label: 'Vision',    color: 'pink' },
  creative:     { label: 'Creative',  color: 'rose' },
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  accent: 'amber',
  font_size: 'base',
  send_on_enter: true,
  show_model_badges: true,
  auto_title: true,
  tts_enabled: false,
  tts_voice: 'alloy',
  memory_enabled: true,
  default_model: 'gpt-oss-120b',
};
