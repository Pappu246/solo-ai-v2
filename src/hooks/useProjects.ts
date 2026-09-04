import { useState, useCallback, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Project } from '../types';
import { projectsApi } from '../lib/knowledge/api';
import { toFriendlyError, type FriendlyError } from '../lib/errors';
import type { LoadStatus } from './useChat';

export interface ProjectInput { name: string; description?: string; instructions?: string }

/**
 * Projects: create / rename / edit context / archive / delete.
 * Mutations are optimistic and roll back on failure; errors are re-thrown so
 * the caller can decide how to surface them (usually a toast).
 */
export function useProjects(user: User | null) {
  const [projects, setProjectsState] = useState<Project[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState<FriendlyError | null>(null);
  // Mirror of the latest list so optimistic updates can snapshot/rollback
  // without depending on when React runs a state updater.
  const ref = useRef<Project[]>([]);
  const setProjects = useCallback((next: Project[]) => { ref.current = next; setProjectsState(next); }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setStatus('loading');
    try {
      setProjects(await projectsApi.list(user.id));
      setStatus('ready');
      setError(null);
    } catch (e) {
      setError(toFriendlyError(e));
      setStatus('error');
    }
  }, [user, setProjects]);

  useEffect(() => {
    if (!user) { setProjects([]); setStatus('idle'); return; }
    load();
  }, [user, load, setProjects]);

  const createProject = useCallback(async (input: ProjectInput): Promise<Project> => {
    if (!user) throw new Error('Not signed in');
    const name = input.name.trim();
    if (!name) throw new Error('Give the project a name.');
    const project = await projectsApi.create(user.id, { ...input, name });
    setProjects([project, ...ref.current]);
    return project;
  }, [user, setProjects]);

  const updateProject = useCallback(async (id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'instructions' | 'archived'>>) => {
    if (typeof patch.name === 'string') {
      patch = { ...patch, name: patch.name.trim() };
      if (!patch.name) throw new Error('Give the project a name.');
    }
    const snapshot = ref.current;
    setProjects(snapshot.map(p => (p.id === id ? { ...p, ...patch, updated_at: new Date().toISOString() } : p)));
    try { await projectsApi.update(id, patch); }
    catch (e) { setProjects(snapshot); throw e; }
  }, [setProjects]);

  const archiveProject = useCallback((id: string, archived: boolean) => updateProject(id, { archived }), [updateProject]);

  const deleteProject = useCallback(async (id: string) => {
    const snapshot = ref.current;
    setProjects(snapshot.filter(p => p.id !== id));
    try { await projectsApi.remove(id); }
    catch (e) { setProjects(snapshot); throw e; }
  }, [setProjects]);

  return { projects, status, error, reload: load, createProject, updateProject, archiveProject, deleteProject };
}

export type ProjectsController = ReturnType<typeof useProjects>;
