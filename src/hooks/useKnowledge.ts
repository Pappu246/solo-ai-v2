import { useState, useCallback, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { KnowledgeFile } from '../types';
import { filesApi } from '../lib/knowledge/api';
import { fileService, FileValidationError } from '../lib/knowledge/fileService';
import { toFriendlyError, type FriendlyError } from '../lib/errors';
import type { LoadStatus } from './useChat';

export interface UploadTarget {
  projectId?: string | null;
  conversationId?: string | null;
  /** Optional observer for each lifecycle transition (uploading → processing → ready | failed). */
  onChange?: (file: KnowledgeFile) => void;
}

export interface UploadOutcome {
  files: KnowledgeFile[];
  /** Validation problems (unsupported type, too large…) keyed by file name. */
  rejected: string[];
}

/**
 * All of the user's knowledge files, kept in one place so the file library,
 * project views and the composer share a single source of truth.
 */
export function useKnowledge(user: User | null) {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState<FriendlyError | null>(null);
  // Mirror of the latest list: concurrent uploads and optimistic updates read
  // and write through it so no update ever depends on a stale closure.
  const filesRef = useRef<KnowledgeFile[]>([]);
  const commit = useCallback((next: KnowledgeFile[]) => { filesRef.current = next; setFiles(next); }, []);
  const upsert = useCallback((file: KnowledgeFile) => {
    const prev = filesRef.current;
    commit(prev.some(f => f.id === file.id) ? prev.map(f => (f.id === file.id ? file : f)) : [file, ...prev]);
  }, [commit]);

  const load = useCallback(async () => {
    if (!user) return;
    setStatus('loading');
    try {
      commit(await filesApi.list(user.id));
      setStatus('ready');
      setError(null);
    } catch (e) {
      setError(toFriendlyError(e));
      setStatus('error');
    }
  }, [user, commit]);

  useEffect(() => {
    if (!user) { commit([]); setStatus('idle'); return; }
    load();
  }, [user, load, commit]);

  /** Upload several files concurrently; each one reports its own lifecycle. */
  const uploadFiles = useCallback(async (list: File[], target: UploadTarget = {}): Promise<UploadOutcome> => {
    if (!user) return { files: [], rejected: ['Sign in to upload files.'] };
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of list) {
      const problem = fileService.validate(f);
      if (problem) rejected.push(problem); else accepted.push(f);
    }
    const onChange = (file: KnowledgeFile) => { upsert(file); target.onChange?.(file); };
    const results = await Promise.all(accepted.map(async f => {
      try {
        return await fileService.upload(f, { userId: user.id, projectId: target.projectId, conversationId: target.conversationId, onChange });
      } catch (e) {
        rejected.push(e instanceof FileValidationError ? e.message : `${f.name}: ${toFriendlyError(e).message}`);
        return null;
      }
    }));
    return { files: results.filter((r): r is KnowledgeFile => r !== null), rejected };
  }, [user, upsert]);

  const retryProcessing = useCallback(async (file: KnowledgeFile) => {
    if (!file.metadata.uploaded) throw new Error('The upload never completed. Please upload the file again.');
    return fileService.process(file, undefined, upsert);
  }, [upsert]);

  const deleteFile = useCallback(async (file: KnowledgeFile) => {
    const snapshot = filesRef.current;
    commit(snapshot.filter(f => f.id !== file.id));
    try { await fileService.remove(file); }
    catch (e) { commit(snapshot); throw e; }
  }, [commit]);

  /** Move a file into / out of a project. */
  const assignProject = useCallback(async (file: KnowledgeFile, projectId: string | null) => {
    const previous = file.project_id;
    upsert({ ...file, project_id: projectId });
    try { await filesApi.update(file.id, { project_id: projectId }); }
    catch (e) { upsert({ ...file, project_id: previous }); throw e; }
  }, [upsert]);

  /** Attach an existing library file to a conversation (used when a file is picked in the composer). */
  const attachToConversation = useCallback(async (fileIds: string[], conversationId: string) => {
    const targets = filesRef.current.filter(f => fileIds.includes(f.id) && !f.conversation_id);
    await Promise.all(targets.map(async f => {
      upsert({ ...f, conversation_id: conversationId });
      try { await filesApi.update(f.id, { conversation_id: conversationId }); } catch { upsert(f); }
    }));
  }, [upsert]);

  /** Files that should be considered for a chat: attached to it, or in its project. */
  const filesForChat = useCallback((conversationId: string | null, projectId: string | null): KnowledgeFile[] => {
    return filesRef.current.filter(f =>
      (conversationId && f.conversation_id === conversationId) || (projectId && f.project_id === projectId));
  }, []);

  return { files, status, error, reload: load, uploadFiles, retryProcessing, deleteFile, assignProject, attachToConversation, filesForChat };
}

export type KnowledgeController = ReturnType<typeof useKnowledge>;
