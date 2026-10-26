// ─── Core Data Types ────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  user_id: string;
  /** Phase 2: conversations can live inside a project. */
  project_id?: string | null;
  pinned: boolean;
  archived: boolean;
  model_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

/** A web image returned by Solo AI's Smart Image Search. */
export interface ImageSearchImage {
  url: string;
  thumbnail: string;
  title: string;
  sourceUrl: string;
  sourceName: string;
  width?: number;
  height?: number;
}

/** A web source cited by Solo AI's web research (Phase 5). */
export interface WebSearchSource {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  rank: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  model?: string | null;
  model_name?: string | null;
  category?: string | null;
  attachments?: Attachment[] | null;
  /** Phase 2: knowledge sources that were provided to the model for this reply. */
  sources?: KnowledgeSource[] | null;
  /** Smart Image Search results attached to this assistant reply. */
  images?: ImageSearchImage[] | null;
  /** Web research sources attached to this assistant reply (Phase 5). */
  web_sources?: WebSearchSource[] | null;
  created_at: string;
}

export type AttachmentType = 'image' | 'pdf' | 'docx' | 'txt' | 'md' | 'csv' | 'json' | 'code' | 'audio' | 'video';

export interface Attachment {
  id: string;
  name: string;
  type: AttachmentType;
  url?: string;
  base64?: string;
  size: number;
  extracted_text?: string;
  mime_type?: string;
  /** Phase 2: set when the attachment is a stored knowledge file. */
  file_id?: string;
  status?: FileStatus;
  error?: string;
}

// ─── Phase 2: Knowledge layer ───────────────────────────────────────────────

export type FileStatus = 'uploading' | 'processing' | 'ready' | 'failed';
export type FileKind = 'pdf' | 'text' | 'markdown' | 'csv' | 'json' | 'code' | 'docx';

export interface FileMetadata {
  kind?: FileKind;
  extension?: string;
  /** True once the object exists in Storage (needed for "Retry processing"). */
  uploaded?: boolean;
  pages?: number;
  lines?: number;
  rows?: number;
  truncated?: boolean;
  processed_at?: string;
  processing_ms?: number;
}

export interface KnowledgeFile {
  id: string;
  user_id: string;
  project_id: string | null;
  conversation_id: string | null;
  name: string;
  mime_type: string;
  size: number;
  storage_path: string;
  status: FileStatus;
  error: string | null;
  chunk_count: number;
  char_count: number;
  preview: string | null;
  metadata: FileMetadata;
  created_at: string;
  updated_at: string;
}

export interface FileChunk {
  id: string;
  file_id: string;
  chunk_index: number;
  content: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string;
  /** Project-specific instructions sent to the model for chats in the project. */
  instructions: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export type MemoryType = 'fact' | 'preference' | 'instruction' | 'context';
export type MemorySource = 'user' | 'chat';

export interface Memory {
  id: string;
  user_id: string;
  /** null = applies to every chat; otherwise only chats in that project. */
  project_id: string | null;
  type: MemoryType;
  content: string;
  source: MemorySource;
  source_conversation_id: string | null;
  /** 1 (low) – 5 (high). Higher memories are included first when context is limited. */
  importance: number;
  created_at: string;
  updated_at: string;
}

export const MEMORY_TYPES: Record<MemoryType, { label: string; hint: string }> = {
  fact:        { label: 'Fact',        hint: 'Something true about you or your work' },
  preference:  { label: 'Preference',  hint: 'How you like answers to be written' },
  instruction: { label: 'Instruction', hint: 'A standing rule the assistant should follow' },
  context:     { label: 'Context',     hint: 'Background that helps with this project or topic' },
};

/** A file the model was given excerpts from while answering. */
export interface KnowledgeSource {
  file_id: string;
  file_name: string;
  chunk_indexes: number[];
}

/** Context sent alongside the messages to the chat Edge Function. */
export interface ChatContext {
  project?: { name: string; instructions?: string };
  memories?: Array<{ type: MemoryType; content: string }>;
  knowledge?: Array<{ file_id: string; file_name: string; chunk_index: number; content: string }>;
}

export type SearchKind = 'conversation' | 'message' | 'project' | 'file' | 'memory';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string | null;
  conversation_id: string | null;
  project_id: string | null;
  updated_at: string;
  rank: number;
}

/** Wire format sent to the chat Edge Function. */
export interface ChatMessage {
  role: MessageRole;
  content: string;
}

// ─── AI Model Types ──────────────────────────────────────────────────────────

export type ModelProvider = 'google' | 'groq' | 'openrouter';
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
  /** Phase 15: false while the server is routing around this model (provider cooldown or retired catalog entry). Missing counts as available. */
  available?: boolean;
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
  language: 'en' | 'hi';
  show_model_badges: boolean;
  // General
  send_on_enter: boolean;
  auto_title: boolean;
  /** Phase 8: propose saving durable statements from your messages as memories. */
  suggest_memories: boolean;
  // AI
  /** `null` = Auto (router picks the model). */
  preferred_model: string | null;
  // Voice
  tts_enabled: boolean;
  tts_rate: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  accent: 'amber',
  font_size: 'base',
  language: 'en',
  show_model_badges: true,
  send_on_enter: true,
  auto_title: true,
  suggest_memories: true,
  preferred_model: null,
  tts_enabled: true,
  tts_rate: 1,
};

export const ACCENT_OPTIONS: { value: AccentColor; label: string }[] = [
  { value: 'amber', label: 'Clay' },
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'rose', label: 'Rose' },
  { value: 'cyan', label: 'Cyan' },
];
