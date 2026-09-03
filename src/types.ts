// ─── Core Data Types ────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  user_id: string;
  folder_id?: string | null;
  pinned: boolean;
  archived: boolean;
  model_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  model?: string | null;
  model_name?: string | null;
  category?: string | null;
  attachments?: Attachment[] | null;
  tokens_used?: number | null;
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

/** Wire format sent to the chat Edge Function. */
export interface ChatMessage {
  role: MessageRole;
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

/** Model metadata attached to a streamed response. */
export interface ModelInfo {
  id: string;
  name: string;
  category: string;
}

export const MODEL_CATEGORIES: Record<ModelCategory, { label: string }> = {
  coding:       { label: 'Coding' },
  conversation: { label: 'Chat' },
  fast:         { label: 'Quick' },
  research:     { label: 'Research' },
  reasoning:    { label: 'Reasoning' },
  free:         { label: 'Free' },
  vision:       { label: 'Vision' },
  creative:     { label: 'Creative' },
};

// ─── Settings ────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light' | 'system';
export type AccentColor = 'amber' | 'blue' | 'violet' | 'emerald' | 'rose' | 'cyan';
export type FontSize = 'sm' | 'base' | 'lg';

/**
 * Every key here is consumed somewhere in the UI. Do not add a setting
 * without wiring it to a real effect.
 */
export interface UserSettings {
  // Appearance
  theme: Theme;
  accent: AccentColor;
  font_size: FontSize;
  show_model_badges: boolean;
  // General
  send_on_enter: boolean;
  auto_title: boolean;
  // AI
  /** `null` = Auto (router picks the model). */
  preferred_model: string | null;
  // Voice
  tts_enabled: boolean;
  tts_rate: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  accent: 'amber',
  font_size: 'base',
  show_model_badges: true,
  send_on_enter: true,
  auto_title: true,
  preferred_model: null,
  tts_enabled: true,
  tts_rate: 1,
};

export const ACCENT_OPTIONS: { value: AccentColor; label: string }[] = [
  { value: 'amber', label: 'Amber' },
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'rose', label: 'Rose' },
  { value: 'cyan', label: 'Cyan' },
];
