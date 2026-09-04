/**
 * Persistence layer for the Phase 2 knowledge tables: files, file_chunks,
 * projects and memories. Mirrors the style of `lib/chat/api.ts`.
 *
 * Every query goes through the user's Supabase session, so Row Level Security
 * is the real authorization boundary; the `user_id` filters here only keep
 * result sets tight and make intent obvious.
 */
import { supabase } from '../supabase';
import { AppError } from '../errors';
import type { FileChunk, FileMetadata, FileStatus, KnowledgeFile, Memory, MemorySource, MemoryType, Project } from '../../types';

export const KNOWLEDGE_BUCKET = 'knowledge';

function throwIf(error: { message: string; code?: string } | null, context: string): void {
  if (error) throw new AppError(`${context} failed`, undefined, `${error.code ? `[${error.code}] ` : ''}${error.message}`);
}

/** Storage keys must be ASCII-safe; keep the original name in the row. */
export function safeStorageName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(-120);
  return cleaned || 'file';
}

export function storagePathFor(userId: string, fileId: string, name: string): string {
  return `${userId}/${fileId}/${safeStorageName(name)}`;
}

// ── Files ────────────────────────────────────────────────────────────────────

export interface NewFileRow {
  id: string;
  user_id: string;
  project_id: string | null;
  conversation_id: string | null;
  name: string;
  mime_type: string;
  size: number;
  storage_path: string;
  metadata: FileMetadata;
}

export const filesApi = {
  async list(userId: string, scope: { projectId?: string | null; conversationId?: string | null } = {}): Promise<KnowledgeFile[]> {
    let query = supabase.from('files').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (scope.projectId) query = query.eq('project_id', scope.projectId);
    if (scope.conversationId) query = query.eq('conversation_id', scope.conversationId);
    const { data, error } = await query;
    throwIf(error, 'Loading files');
    return (data ?? []).map(normalizeFile);
  },

  async get(id: string): Promise<KnowledgeFile | null> {
    const { data, error } = await supabase.from('files').select('*').eq('id', id).maybeSingle();
    throwIf(error, 'Loading file');
    return data ? normalizeFile(data) : null;
  },

  async insert(row: NewFileRow): Promise<KnowledgeFile> {
    const { data, error } = await supabase
      .from('files')
      .insert({ ...row, status: 'uploading' satisfies FileStatus, chunk_count: 0, char_count: 0 })
      .select()
      .single();
    throwIf(error, 'Registering file');
    return normalizeFile(data);
  },

  async update(id: string, patch: Partial<Pick<KnowledgeFile, 'status' | 'error' | 'chunk_count' | 'char_count' | 'preview' | 'metadata' | 'project_id' | 'conversation_id' | 'name'>>): Promise<void> {
    const { error } = await supabase.from('files').update(patch).eq('id', id);
    throwIf(error, 'Updating file');
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('files').delete().eq('id', id);
    throwIf(error, 'Deleting file');
  },

  async upload(path: string, blob: Blob, contentType: string): Promise<void> {
    const { error } = await supabase.storage.from(KNOWLEDGE_BUCKET).upload(path, blob, { contentType, upsert: false });
    if (error) throw new AppError('Uploading file failed', undefined, error.message);
  },

  async download(path: string): Promise<Blob> {
    const { data, error } = await supabase.storage.from(KNOWLEDGE_BUCKET).download(path);
    if (error || !data) throw new AppError('Downloading file failed', undefined, error?.message);
    return data;
  },

  async removeObject(path: string): Promise<void> {
    const { error } = await supabase.storage.from(KNOWLEDGE_BUCKET).remove([path]);
    if (error) throw new AppError('Removing stored file failed', undefined, error.message);
  },

  /** Short-lived link for the user to download their own original. */
  async signedUrl(path: string, expiresInSeconds = 60): Promise<string> {
    const { data, error } = await supabase.storage.from(KNOWLEDGE_BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) throw new AppError('Creating download link failed', undefined, error?.message);
    return data.signedUrl;
  },
};

function normalizeFile(row: Record<string, unknown>): KnowledgeFile {
  return {
    ...(row as unknown as KnowledgeFile),
    project_id: (row.project_id as string | null) ?? null,
    conversation_id: (row.conversation_id as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    preview: (row.preview as string | null) ?? null,
    chunk_count: Number(row.chunk_count ?? 0),
    char_count: Number(row.char_count ?? 0),
    size: Number(row.size ?? 0),
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as FileMetadata,
  };
}

// ── Chunks ───────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  file_id: string;
  file_name: string;
  chunk_index: number;
  content: string;
  rank: number;
}

export const chunksApi = {
  async replaceForFile(fileId: string, userId: string, chunks: string[]): Promise<void> {
    const { error: delError } = await supabase.from('file_chunks').delete().eq('file_id', fileId);
    throwIf(delError, 'Clearing previous chunks');
    const BATCH = 100;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const rows = chunks.slice(i, i + BATCH).map((content, j) => ({
        file_id: fileId, user_id: userId, chunk_index: i + j, content, char_count: content.length,
      }));
      const { error } = await supabase.from('file_chunks').insert(rows);
      throwIf(error, 'Saving file content');
    }
  },

  async listForFile(fileId: string, limit = 5): Promise<FileChunk[]> {
    const { data, error } = await supabase
      .from('file_chunks')
      .select('id, file_id, chunk_index, content')
      .eq('file_id', fileId)
      .order('chunk_index', { ascending: true })
      .limit(limit);
    throwIf(error, 'Loading file content');
    return (data ?? []) as FileChunk[];
  },

  /** Ranked full-text match over the caller's own ready files (RPC, RLS-enforced). */
  async match(words: string[], fileIds: string[], limit = 24): Promise<RetrievedChunk[]> {
    if (!words.length || !fileIds.length) return [];
    const { data, error } = await supabase.rpc('match_file_chunks', { p_words: words, p_file_ids: fileIds, p_limit: limit });
    throwIf(error, 'Searching file content');
    return (data ?? []) as RetrievedChunk[];
  },
};

// ── Projects ─────────────────────────────────────────────────────────────────

export const projectsApi = {
  async list(userId: string): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('archived', { ascending: true })
      .order('updated_at', { ascending: false });
    throwIf(error, 'Loading projects');
    return (data ?? []).map(normalizeProject);
  },

  async create(userId: string, input: { name: string; description?: string; instructions?: string }): Promise<Project> {
    const name = input.name.trim();
    if (!name) throw new AppError('Project name is required');
    if (name.length > 120) throw new AppError('Project name is too long', undefined, 'Keep it under 120 characters.');
    const id = crypto.randomUUID();
    const { data, error } = await supabase
      .from('projects')
      .insert({ id, user_id: userId, name, description: (input.description ?? '').trim().slice(0, 2000), instructions: (input.instructions ?? '').trim().slice(0, 4000), archived: false })
      .select()
      .single();
    throwIf(error, 'Creating project');
    return normalizeProject(data);
  },

  async update(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'instructions' | 'archived'>>): Promise<void> {
    const { error } = await supabase.from('projects').update(patch).eq('id', id);
    throwIf(error, 'Updating project');
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    throwIf(error, 'Deleting project');
  },
};

function normalizeProject(row: Record<string, unknown>): Project {
  return {
    ...(row as unknown as Project),
    description: String(row.description ?? ''),
    instructions: String(row.instructions ?? ''),
    archived: Boolean(row.archived),
  };
}

// ── Memories ─────────────────────────────────────────────────────────────────

/** Matches the CHECK constraint in the migration. */
export const MEMORY_MAX_CHARS = 1000;

export interface NewMemory {
  content: string;
  type?: MemoryType;
  project_id?: string | null;
  source?: MemorySource;
  source_conversation_id?: string | null;
  importance?: number;
}

export const memoriesApi = {
  async list(userId: string): Promise<Memory[]> {
    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .order('updated_at', { ascending: false });
    throwIf(error, 'Loading memories');
    return (data ?? []).map(normalizeMemory);
  },

  async create(userId: string, input: NewMemory): Promise<Memory> {
    const content = input.content.trim();
    if (!content) throw new AppError('Memory text is required');
    if (content.length > MEMORY_MAX_CHARS) throw new AppError('Memory is too long', undefined, `Keep it under ${MEMORY_MAX_CHARS} characters.`);
    const id = crypto.randomUUID();
    const { data, error } = await supabase
      .from('memories')
      .insert({
        id,
        user_id: userId,
        content,
        type: input.type ?? 'fact',
        project_id: input.project_id ?? null,
        source: input.source ?? 'user',
        source_conversation_id: input.source_conversation_id ?? null,
        importance: clampImportance(input.importance),
      })
      .select()
      .single();
    throwIf(error, 'Saving memory');
    return normalizeMemory(data);
  },

  async update(id: string, patch: Partial<Pick<Memory, 'content' | 'type' | 'project_id' | 'importance'>>): Promise<void> {
    const next = { ...patch };
    if (typeof next.importance === 'number') next.importance = clampImportance(next.importance);
    if (typeof next.content === 'string') next.content = next.content.trim();
    const { error } = await supabase.from('memories').update(next).eq('id', id);
    throwIf(error, 'Updating memory');
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('memories').delete().eq('id', id);
    throwIf(error, 'Deleting memory');
  },
};

export function clampImportance(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 3;
  return Math.min(5, Math.max(1, n));
}

function normalizeMemory(row: Record<string, unknown>): Memory {
  return {
    ...(row as unknown as Memory),
    project_id: (row.project_id as string | null) ?? null,
    source_conversation_id: (row.source_conversation_id as string | null) ?? null,
    importance: clampImportance(row.importance),
  };
}
