import { useState, useCallback, useRef, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Conversation, Message, Attachment, AIModel, ModelInfo, UserSettings, ChatContext, KnowledgeSource } from '../types';
import { conversationsApi, messagesApi, ConversationNotFoundError, type ConversationPatch } from '../lib/chat/api';
import { streamChat, fetchModels } from '../lib/chat/stream';
import { toFriendlyError, type FriendlyError } from '../lib/errors';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

const NEW_CHAT_TITLE = 'New chat';
const MAX_HISTORY = 40;

export function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48).trimEnd()}…` : oneLine || NEW_CHAT_TITLE;
}

export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
}

export function fallbackAfterRemoval(list: Conversation[], removedId: string): Conversation | null {
  const removed = list.find(c => c.id === removedId);
  if (!removed) return null;
  const section = sortConversations(list).filter(c => Boolean(c.archived) === Boolean(removed.archived));
  const idx = section.findIndex(c => c.id === removedId);
  const neighbour = idx === -1 ? null : section[idx + 1] ?? section[idx - 1] ?? null;
  return neighbour ?? sortConversations(list).find(c => !c.archived && c.id !== removedId) ?? null;
}

export interface ResolvedContext {
  context?: ChatContext;
  sources?: KnowledgeSource[];
}

export type ContextResolver = (input: { conversation: Conversation; query: string; attachments?: Attachment[] }) => Promise<ResolvedContext>;

interface Options {
  settings: Pick<UserSettings, 'auto_title' | 'preferred_model'>;
  resolveContext?: ContextResolver;
  onConversationCreated?: (conversation: Conversation) => void;
}

export function useChat(user: User | null, { settings, resolveContext, onConversationCreated }: Options) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsStatus, setConversationsStatus] = useState<LoadStatus>('idle');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesStatus, setMessagesStatus] = useState<LoadStatus>('idle');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingModel, setStreamingModel] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(settings.preferred_model);
  const pendingModelRef = useRef<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const activeRef = useRef<Conversation | null>(null);
  const activeProjectRef = useRef<string | null>(null);
  const resolveContextRef = useRef<ContextResolver | undefined>(resolveContext);
  const onCreatedRef = useRef(onConversationCreated);
  useEffect(() => { resolveContextRef.current = resolveContext; onCreatedRef.current = onConversationCreated; });
  const setMessagesSync = useCallback((next: Message[] | ((prev: Message[]) => Message[])) => {
    const value = typeof next === 'function' ? next(messagesRef.current) : next;
    messagesRef.current = value;
    setMessages(value);
  }, []);
  const setActiveSync = useCallback((next: Conversation | null) => {
    activeRef.current = next;
    setActiveConversation(next);
  }, []);
  const setActiveProject = useCallback((id: string | null) => {
    activeProjectRef.current = id;
    setActiveProjectId(id);
  }, []);
  const preferredModel = settings.preferred_model;
  useEffect(() => {
    if (activeRef.current?.model_id || pendingModelRef.current) return;
    setSelectedModel(preferredModel);
  }, [preferredModel]);

  const loadModels = useCallback(async () => {
    try { setAvailableModels(await fetchModels()); }
    catch { /* model list is optional; Auto still works without it */ }
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setConversationsStatus('loading');
    try {
      const list = await conversationsApi.list(user.id);
      setConversations(list);
      const fresh = activeRef.current ? list.find(c => c.id === activeRef.current!.id) : undefined;
      if (fresh) setActiveSync(fresh);
      setConversationsStatus('ready');
    } catch (e) {
      setError(toFriendlyError(e));
      setConversationsStatus('error');
    }
  }, [user, setActiveSync]);

  useEffect(() => {
    if (!user) {
      setConversations([]); setActiveSync(null); setMessagesSync([]);
      setConversationsStatus('idle');
      return;
    }
    loadConversations();
    loadModels();
  }, [user, loadConversations, loadModels, setActiveSync, setMessagesSync]);

  const stopGeneration = useCallback(() => { abortRef.current?.abort(); }, []);

  const selectConversation = useCallback(async (conversation: Conversation | null) => {
    if (activeRef.current?.id === conversation?.id) return;
    stopGeneration();
    setError(null);
    setInterrupted(false);
    setActiveSync(conversation);
    setMessagesSync([]);
    pendingModelRef.current = null;
    setSelectedModel(conversation?.model_id ?? preferredModel);
    if (conversation) setActiveProject(conversation.project_id ?? null);
    if (!conversation) { setMessagesStatus('idle'); return; }
    setMessagesStatus('loading');
    try {
      const rows = await messagesApi.list(conversation.id);
      if (activeRef.current?.id === conversation.id) { setMessagesSync(rows); setMessagesStatus('ready'); }
    } catch (e) {
      setError(toFriendlyError(e));
      setMessagesStatus('error');
    }
  }, [stopGeneration, setActiveSync, setMessagesSync, setActiveProject, preferredModel]);

  const startNewChat = useCallback((projectId?: string | null) => {
    stopGeneration();
    setError(null);
    setInterrupted(false);
    setActiveSync(null);
    setMessagesSync([]);
    setMessagesStatus('idle');
    pendingModelRef.current = null;
    setSelectedModel(preferredModel);
    if (projectId !== undefined) setActiveProject(projectId);
  }, [stopGeneration, setActiveSync, setMessagesSync, setActiveProject, preferredModel]);

  const patchLocal = useCallback((id: string, patch: Partial<Conversation>) => {
    setConversations(prev => sortConversations(prev.map(c => (c.id === id ? { ...c, ...patch } : c))));
    if (activeRef.current?.id === id) setActiveSync({ ...activeRef.current, ...patch });
  }, [setActiveSync]);

  const leaveActive = useCallback((id: string, list: Conversation[]) => {
    if (activeRef.current?.id !== id) return;
    const next = fallbackAfterRemoval(list, id);
    if (next) void selectConversation(next); else startNewChat();
  }, [selectConversation, startNewChat]);

  const evictLocal = useCallback((id: string, list: Conversation[]) => {
    leaveActive(id, list);
    setConversations(prev => prev.filter(c => c.id !== id));
  }, [leaveActive]);

  const mutationSeq = useRef(new Map<string, number>());

  const mutateConversation = useCallback(async (id: string, patch: ConversationPatch) => {
    const seq = (mutationSeq.current.get(id) ?? 0) + 1;
    mutationSeq.current.set(id, seq);
    const before = conversations;
    patchLocal(id, { ...patch, updated_at: new Date().toISOString() });
    try {
      const stored = await conversationsApi.update(id, patch);
      if (mutationSeq.current.get(id) === seq) {
        const confirmed: Partial<Conversation> = { updated_at: stored.updated_at };
        for (const key of Object.keys(patch) as (keyof ConversationPatch)[]) Object.assign(confirmed, { [key]: stored[key] });
        patchLocal(id, confirmed);
      }
    } catch (e) {
      if (mutationSeq.current.get(id) === seq) {
        if (e instanceof ConversationNotFoundError) evictLocal(id, before);
        else void loadConversations();
      }
      setError(toFriendlyError(e));
    }
  }, [conversations, patchLocal, evictLocal, loadConversations]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await mutateConversation(id, { title: trimmed });
  }, [mutateConversation]);

  const pinConversation = useCallback(async (id: string, pinned: boolean) => {
    await mutateConversation(id, { pinned });
  }, [mutateConversation]);

  const archiveConversation = useCallback(async (id: string, archived: boolean) => {
    if (archived) leaveActive(id, conversations);
    await mutateConversation(id, { archived });
  }, [conversations, leaveActive, mutateConversation]);

  const moveConversation = useCallback(async (id: string, projectId: string | null) => {
    await mutateConversation(id, { project_id: projectId });
  }, [mutateConversation]);

  const selectModel = useCallback((id: string | null) => {
    setSelectedModel(id);
    const conversation = activeRef.current;
    if (!conversation) { pendingModelRef.current = id; return; }
    if ((conversation.model_id ?? null) === id) return;
    patchLocal(conversation.id, { model_id: id });
    conversationsApi.update(conversation.id, { model_id: id })
      .then(stored => { patchLocal(conversation.id, { model_id: stored.model_id ?? null, updated_at: stored.updated_at }); })
      .catch(() => { /* keep the local choice; the next successful write wins */ });
  }, [patchLocal]);

  const deleteConversation = useCallback(async (id: string) => {
    const snapshot = conversations;
    leaveActive(id, snapshot);
    setConversations(prev => prev.filter(c => c.id !== id));
    try { await conversationsApi.remove(id); }
    catch (e) { setError(toFriendlyError(e)); setConversations(sortConversations(snapshot)); }
  }, [conversations, leaveActive]);

  const generate = useCallback(async (conversation: Conversation, history: Message[], attachments?: Attachment[]) => {
    if (!user) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setStreamingContent('');
    setStreamingModel(null);
    setError(null);
    setInterrupted(false);

    let content = '';
    let model: ModelInfo | null = null;
    let sources: KnowledgeSource[] | undefined;
    let imageResults: Message['images'] = undefined;
    try {
      const wire = history.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }));
      let context: ChatContext | undefined;
      const lastUser = [...history].reverse().find(m => m.role === 'user');
      if (resolveContextRef.current && lastUser) {
        try {
          const resolved = await resolveContextRef.current({ conversation, query: lastUser.content, attachments });
          context = resolved.context;
          sources = resolved.sources?.length ? resolved.sources : undefined;
        } catch { /* answer without extra context */ }
      }
      if (controller.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const handle = await streamChat({ messages: wire, model: selectedModel, attachments, context, signal: controller.signal });
      model = handle.model;
      setStreamingModel(model);
      for await (const delta of handle.deltas) {
        content += delta;
        setStreamingContent(content);
      }
      imageResults = handle.images.length ? [...handle.images] : undefined;
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError' || controller.signal.aborted;
      if (!aborted) {
        setError(toFriendlyError(e));
        if (content) setInterrupted(true);
      }
    } finally {
      abortRef.current = null;
    }

    if (content) {
      const assistant: Message = {
        id: crypto.randomUUID(),
        conversation_id: conversation.id,
        role: 'assistant',
        content,
        model: model?.id ?? null,
        model_name: model?.name ?? null,
        category: model?.category ?? null,
        sources: sources ?? null,
        images: imageResults ?? null,
        created_at: new Date().toISOString(),
      };
      if (activeRef.current?.id === conversation.id) setMessagesSync(prev => [...prev, assistant]);
      try {
        await messagesApi.insert({ ...assistant, user_id: user.id });
        await conversationsApi.touch(conversation.id);
        setConversations(prev => sortConversations(prev.map(c => (c.id === conversation.id ? { ...c, updated_at: assistant.created_at } : c))));
      } catch (e) {
        setError(toFriendlyError(e));
      }
    }

    setStreamingContent('');
    setStreamingModel(null);
    setIsGenerating(false);
  }, [user, selectedModel, setMessagesSync]);

  const sendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    const text = content.trim();
    if ((!text && !attachments?.length) || isGenerating || !user) return;
    setError(null);

    let conversation = activeRef.current;
    if (!conversation) {
      try {
        const modelId = pendingModelRef.current;
        conversation = await conversationsApi.create(user.id, settings.auto_title ? deriveTitle(text) : NEW_CHAT_TITLE, activeProjectRef.current, modelId);
        pendingModelRef.current = null;
      } catch (e) { setError(toFriendlyError(e)); return; }
      setConversations(prev => sortConversations([conversation!, ...prev]));
      setActiveSync(conversation);
      setMessagesSync([]);
      setMessagesStatus('ready');
      onCreatedRef.current?.(conversation);
    } else if (settings.auto_title && conversation.title === NEW_CHAT_TITLE && messagesRef.current.length === 0 && text) {
      const title = deriveTitle(text);
      patchLocal(conversation.id, { title });
      conversationsApi.update(conversation.id, { title }).catch(() => { /* non-critical */ });
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      role: 'user',
      content: text,
      attachments: attachments ?? null,
      created_at: new Date().toISOString(),
    };
    const history = [...(activeRef.current?.id === conversation.id ? messagesRef.current : []), userMessage];
    setMessagesSync(history);

    try { await messagesApi.insert({ ...userMessage, user_id: user.id }); }
    catch (e) { setError(toFriendlyError(e)); setMessagesSync(prev => prev.filter(m => m.id !== userMessage.id)); return; }

    await generate(conversation, history, attachments);
  }, [isGenerating, user, settings.auto_title, patchLocal, generate, setActiveSync, setMessagesSync]);

  const regenerate = useCallback(async () => {
    const conversation = activeRef.current;
    if (!conversation || isGenerating) return;
    const current = messagesRef.current;
    const lastUserIdx = current.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx === -1) return;
    const lastUser = current[lastUserIdx];
    const toRemove = current.slice(lastUserIdx + 1).map(m => m.id);
    const history = current.slice(0, lastUserIdx + 1);
    setMessagesSync(history);
    if (toRemove.length) {
      try { await messagesApi.remove(toRemove); }
      catch (e) { setError(toFriendlyError(e)); setMessagesSync(current); return; }
    }
    await generate(conversation, history, lastUser.attachments ?? undefined);
  }, [isGenerating, generate, setMessagesSync]);

  const retry = useCallback(async () => {
    const conversation = activeRef.current;
    const current = messagesRef.current;
    if (!conversation || isGenerating) return;
    const tail = current[current.length - 1];
    if (!tail) return;
    if (tail.role === 'assistant') {
      if (!interrupted) return;
      await regenerate();
      return;
    }
    if (tail.role !== 'user') return;
    await generate(conversation, current, tail.attachments ?? undefined);
  }, [isGenerating, generate, interrupted, regenerate]);

  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    const conversation = activeRef.current;
    const text = newContent.trim();
    if (!conversation || isGenerating || !text) return;
    const current = messagesRef.current;
    const idx = current.findIndex(m => m.id === messageId);
    if (idx === -1 || current[idx].role !== 'user') return;
    const edited: Message = { ...current[idx], content: text };
    const toRemove = current.slice(idx + 1).map(m => m.id);
    const history = [...current.slice(0, idx), edited];
    setMessagesSync(history);
    try {
      await messagesApi.updateContent(messageId, text);
      await messagesApi.remove(toRemove);
    } catch (e) { setError(toFriendlyError(e)); setMessagesSync(current); return; }
    await generate(conversation, history, edited.attachments ?? undefined);
  }, [isGenerating, generate, setMessagesSync]);

  const clearError = useCallback(() => setError(null), []);
  const last = messages[messages.length - 1];
  const canRetry = !isGenerating && Boolean(last) && (last.role === 'user' || (interrupted && last.role === 'assistant'));

  return {
    conversations, conversationsStatus,
    activeConversation, messages, messagesStatus,
    availableModels, selectedModel, selectModel,
    activeProjectId, setActiveProject, moveConversation,
    isGenerating, streamingContent, streamingModel, error, clearError, canRetry, interrupted,
    loadConversations, selectConversation, startNewChat,
    renameConversation, pinConversation, archiveConversation, deleteConversation,
    sendMessage, regenerate, retry, editMessage, stopGeneration,
  };
}

export type ChatController = ReturnType<typeof useChat>;
