import { useState, useCallback, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { KnowledgeFile } from '../types';
import { filesApi } from '../lib/knowledge/api';
import { fileService, FileValidationError, UploadCancelled } from '../lib/knowledge/fileService';
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
  /** Ids of uploads the user cancelled before they finished. */
  cancelled: string[];
}

/** Byte-level progress for an upload that is still in flight. */
export interface UploadProgress {
  sent: number;
  total: number;
}

/**
 * All of the user's knowledge files, kept in one place so the file library,
 * project views and the composer share a single source of truth.
 */
export function useKnowledge(user: User | null) {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState<FriendlyError | null>(null);
  /** Progress per file id while its bytes are being uploaded. */
  const [progress, setProgress] = useState<Record<string, UploadProgress>>({});
  // Mirror of the latest list: concurrent uploads and optimistic updates read
  // and write through it so no update ever depends on a stale closure.
  const filesRef = useRef<KnowledgeFile[]>([]);
  // One AbortController per in-flight upload so any of them can be cancelled.
  const controllersRef = useRef(new Map<string, AbortController>());
  const commit = useCallback((next: KnowledgeFile[]) => { filesRef.current = next; setFiles(next); }, []);
  const upsert = useCallback((file: KnowledgeFile) => {
    const prev = filesRef.current;
    commit(prev.some(f => f.id === file.id) ? prev.map(f => (f.id === file.id ? file : f)) : [file, ...prev]);
  }, [commit]);
  const removeLocal = useCallback((id: string) => { commit(filesRef.current.filter(f => f.id !== id)); }, [commit]);
  const clearProgress = useCallback((id: string) => {
    setProgress(prev => { if (!(id in prev)) return prev; const next = { ...prev }; delete next[id]; return next; });
  }, []);

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

  // Abandon in-flight uploads when the hook unmounts (sign-out, navigation away).
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => { for (const c of controllers.values()) c.abort(); controllers.clear(); };
  }, []);

  /** Upload several files concurrently; each one reports its own lifecycle. */
  const uploadFiles = useCallback(async (list: File[], target: UploadTarget = {}): Promise<UploadOutcome> => {
    if (!user) return { files: [], rejected: ['Sign in to upload files.'], cancelled: [] };
    const rejected: string[] = [];
    const cancelled: string[] = [];
    const accepted: File[] = [];
    for (const f of list) {
      const problem = fileService.validate(f);
      if (problem) rejected.push(problem); else accepted.push(f);
    }
    const results = await Promise.all(accepted.map(async f => {
      const controller = new AbortController();
      let id: string | null = null;
      const onChange = (file: KnowledgeFile) => {
        if (!id) { id = file.id; controllersRef.current.set(id, controller); }
        upsert(file);
        target.onChange?.(file);
      };
      try {
        return await fileService.upload(f, {
          userId: user.id,
          projectId: target.projectId,
          conversationId: target.conversationId,
          onChange,
          signal: controller.signal,
          onProgress: (file, sent, total) => setProgress(prev => ({ ...prev, [file.id]: { sent, total } })),
        });
      } catch (e) {
        if (e instanceof UploadCancelled) {
          if (e.fileId) { cancelled.push(e.fileId); removeLocal(e.fileId); }
          return null;
        }
        rejected.push(e instanceof FileValidationError ? e.message : `${f.name}: ${toFriendlyError(e).message}`);
        return null;
      } finally {
        if (id) { controllersRef.current.delete(id); clearProgress(id); }
      }
    }));
    return { files: results.filter((r): r is KnowledgeFile => r !== null), rejected, cancelled };
  }, [user, upsert, removeLocal, clearProgress]);

  /** Cancel an upload that is still sending bytes. No-op once processing has begun. */
  const cancelUpload = useCallback((fileId: string) => {
    const controller = controllersRef.current.get(fileId);
    const file = filesRef.current.find(f => f.id === fileId);
    if (!controller || file?.status !== 'uploading') return false;
    controller.abort();
    return true;
  }, []);

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

  return { files, status, error, progress, reload: load, uploadFiles, cancelUpload, retryProcessing, deleteFile, assignProject, attachToConversation, filesForChat };
}

export type KnowledgeController = ReturnType<typeof useKnowledge>;
