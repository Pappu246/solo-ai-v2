import { useState, useCallback, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Memory } from '../types';
import { memoriesApi, MEMORY_MAX_CHARS, type NewMemory } from '../lib/knowledge/api';
import { toFriendlyError, type FriendlyError } from '../lib/errors';
import type { LoadStatus } from './useChat';

/**
 * Memories are only ever created by an explicit user action (the Memory view,
 * or "Remember this" on a message). Nothing is saved automatically.
 */
export function useMemories(user: User | null) {
  const [memories, setMemoriesState] = useState<Memory[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState<FriendlyError | null>(null);
  // Mirror of the latest list so optimistic updates can snapshot/rollback
  // without depending on when React runs a state updater.
  const ref = useRef<Memory[]>([]);
  const setMemories = useCallback((next: Memory[]) => { ref.current = next; setMemoriesState(next); }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setStatus('loading');
    try {
      setMemories(await memoriesApi.list(user.id));
      setStatus('ready');
      setError(null);
    } catch (e) {
      setError(toFriendlyError(e));
      setStatus('error');
    }
  }, [user, setMemories]);

  useEffect(() => {
    if (!user) { setMemories([]); setStatus('idle'); return; }
    load();
  }, [user, load, setMemories]);

  const addMemory = useCallback(async (input: NewMemory): Promise<Memory> => {
    if (!user) throw new Error('Not signed in');
    const content = input.content.trim();
    if (!content) throw new Error('Write something to remember.');
    if (content.length > MEMORY_MAX_CHARS) throw new Error('Keep a memory under 1,000 characters.');
    const memory = await memoriesApi.create(user.id, { ...input, content });
    setMemories([memory, ...ref.current]);
    return memory;
  }, [user, setMemories]);

  const updateMemory = useCallback(async (id: string, patch: Partial<Pick<Memory, 'content' | 'type' | 'project_id' | 'importance'>>) => {
    if (typeof patch.content === 'string' && !patch.content.trim()) throw new Error('Write something to remember.');
    const snapshot = ref.current;
    setMemories(snapshot.map(m => (m.id === id ? { ...m, ...patch, updated_at: new Date().toISOString() } : m)));
    try { await memoriesApi.update(id, patch); }
    catch (e) { setMemories(snapshot); throw e; }
  }, [setMemories]);

  const deleteMemory = useCallback(async (id: string) => {
    const snapshot = ref.current;
    setMemories(snapshot.filter(m => m.id !== id));
    try { await memoriesApi.remove(id); }
    catch (e) { setMemories(snapshot); throw e; }
  }, [setMemories]);

  return { memories, status, error, reload: load, addMemory, updateMemory, deleteMemory };
}

export type MemoriesController = ReturnType<typeof useMemories>;
