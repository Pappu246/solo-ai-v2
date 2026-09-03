import { useState, useCallback, useRef, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Conversation, Message, Attachment, AIModel, ModelInfo, UserSettings } from '../types';
import { conversationsApi, messagesApi } from '../lib/chat/api';
import { streamChat, fetchModels } from '../lib/chat/stream';
import { toFriendlyError, type FriendlyError } from '../lib/errors';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

const NEW_CHAT_TITLE = 'New chat';
const MAX_HISTORY = 40;

export function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48).trimEnd()}…` : oneLine || NEW_CHAT_TITLE;
}

interface Options {
  settings: Pick<UserSettings, 'auto_title' | 'preferred_model'>;
}

export function useChat(user: User | null, { settings }: Options) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsStatus, setConversationsStatus] = useState<LoadStatus>('idle');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesStatus, setMessagesStatus] = useState<LoadStatus>('idle');

  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingModel, setStreamingModel] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);

  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  /** Explicit model id, or null for Auto. Seeded from settings. */
  const [selectedModel, setSelectedModel] = useState<string | null>(settings.preferred_model);

  const abortRef = useRef<AbortController | null>(null);
  // Refs mirror state synchronously so async flows (send → stream → persist)
  // never read a stale value between a setState call and the next render.
  const messagesRef = useRef<Message[]>([]);
  const activeRef = useRef<Conversation | null>(null);
  const setMessagesSync = useCallback((next: Message[] | ((prev: Message[]) => Message[])) => {
    const value = typeof next === 'function' ? next(messagesRef.current) : next;
    messagesRef.current = value;
    setMessages(value);
  }, []);
  const setActiveSync = useCallback((next: Conversation | null) => {
    activeRef.current = next;
    setActiveConversation(next);
  }, []);

  // Keep the model selection in sync when the user changes the preference in Settings.
  useEffect(() => { setSelectedModel(settings.preferred_model); }, [settings.preferred_model]);

  // ── Loading ────────────────────────────────────────────────────────────────

  const loadModels = useCallback(async () => {
    try { setAvailableModels(await fetchModels()); }
    catch { /* model list is optional; Auto still works without it */ }
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setConversationsStatus('loading');
    try {
      setConversations(await conversationsApi.list(user.id));
      setConversationsStatus('ready');
    } catch (e) {
      setError(toFriendlyError(e));
      setConversationsStatus('error');
    }
  }, [user]);

  // Initial load — runs once per signed-in user.
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
    setActiveSync(conversation);
    setMessagesSync([]);
    if (!conversation) { setMessagesStatus('idle'); return; }
    setMessagesStatus('loading');
    try {
      const rows = await messagesApi.list(conversation.id);
      // Guard against a race where the user switched chats while loading.
      if (activeRef.current?.id === conversation.id) { setMessagesSync(rows); setMessagesStatus('ready'); }
    } catch (e) {
      setError(toFriendlyError(e));
      setMessagesStatus('error');
    }
  }, [stopGeneration, setActiveSync, setMessagesSync]);

  const startNewChat = useCallback(() => {
    stopGeneration();
    setError(null);
    setActiveSync(null);
    setMessagesSync([]);
    setMessagesStatus('idle');
  }, [stopGeneration, setActiveSync, setMessagesSync]);

  // ── Conversation mutations ─────────────────────────────────────────────────

  const patchLocal = useCallback((id: string, patch: Partial<Conversation>) => {
    setConversations(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    if (activeRef.current?.id === id) setActiveSync({ ...activeRef.current, ...patch });
  }, [setActiveSync]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    patchLocal(id, { title: trimmed });
    try { await conversationsApi.update(id, { title: trimmed }); }
    catch (e) { setError(toFriendlyError(e)); loadConversations(); }
  }, [patchLocal, loadConversations]);

  const pinConversation = useCallback(async (id: string, pinned: boolean) => {
    patchLocal(id, { pinned });
    try { await conversationsApi.update(id, { pinned }); }
    catch (e) { setError(toFriendlyError(e)); loadConversations(); }
  }, [patchLocal, loadConversations]);

  const archiveConversation = useCallback(async (id: string, archived: boolean) => {
    patchLocal(id, { archived });
    if (archived && activeRef.current?.id === id) startNewChat();
    try { await conversationsApi.update(id, { archived }); }
    catch (e) { setError(toFriendlyError(e)); loadConversations(); }
  }, [patchLocal, loadConversations, startNewChat]);

  const deleteConversation = useCallback(async (id: string) => {
    const snapshot = conversations;
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeRef.current?.id === id) startNewChat();
    try { await conversationsApi.remove(id); }
    catch (e) { setError(toFriendlyError(e)); setConversations(snapshot); }
  }, [conversations, startNewChat]);

  // ── Generation core ────────────────────────────────────────────────────────

  /**
   * Stream an assistant reply for `history` (which must end with a user turn),
   * persist it, and update local state. Shared by send / regenerate / retry / edit.
   */
  const generate = useCallback(async (conversation: Conversation, history: Message[], attachments?: Attachment[]) => {
    if (!user) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setStreamingContent('');
    setStreamingModel(null);
    setError(null);

    let content = '';
    let model: ModelInfo | null = null;
    try {
      const wire = history.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }));
      const handle = await streamChat({ messages: wire, model: selectedModel, attachments, signal: controller.signal });
      model = handle.model;
      setStreamingModel(model);
      for await (const delta of handle.deltas) {
        content += delta;
        setStreamingContent(content);
      }
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError' || controller.signal.aborted;
      if (!aborted) setError(toFriendlyError(e));
    } finally {
      abortRef.current = null;
    }

    // Persist whatever was produced — including a partial reply after Stop.
    if (content) {
      const assistant: Message = {
        id: crypto.randomUUID(),
        conversation_id: conversation.id,
        role: 'assistant',
        content,
        model: model?.id ?? null,
        model_name: model?.name ?? null,
        category: model?.category ?? null,
        created_at: new Date().toISOString(),
      };
      if (activeRef.current?.id === conversation.id) setMessagesSync(prev => [...prev, assistant]);
      try {
        await messagesApi.insert({ ...assistant, user_id: user.id });
        await conversationsApi.touch(conversation.id);
        setConversations(prev => {
          const updated = prev.map(c => (c.id === conversation.id ? { ...c, updated_at: assistant.created_at } : c));
          return [...updated].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
        });
      } catch (e) {
        setError(toFriendlyError(e));
      }
    }

    setStreamingContent('');
    setStreamingModel(null);
    setIsGenerating(false);
  }, [user, selectedModel, setMessagesSync]);

  // ── Public actions ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    const text = content.trim();
    if ((!text && !attachments?.length) || isGenerating || !user) return;
    setError(null);

    let conversation = activeRef.current;
    if (!conversation) {
      try {
        conversation = await conversationsApi.create(user.id, settings.auto_title ? deriveTitle(text) : NEW_CHAT_TITLE);
      } catch (e) { setError(toFriendlyError(e)); return; }
      setConversations(prev => [conversation!, ...prev]);
      setActiveSync(conversation);
      setMessagesSync([]);
      setMessagesStatus('ready');
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

  /**
   * Regenerate the reply to the last user turn. Removes the trailing assistant
   * message (locally and in the database) so no duplicates are created.
   */
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

  /** Retry after an error: re-request a reply for the existing last user turn. */
  const retry = useCallback(async () => {
    const conversation = activeRef.current;
    const current = messagesRef.current;
    if (!conversation || isGenerating || current[current.length - 1]?.role !== 'user') return;
    await generate(conversation, current, current[current.length - 1].attachments ?? undefined);
  }, [isGenerating, generate]);

  /**
   * Edit a user message in place and regenerate from that point.
   * Everything after the edited message is removed (no branching in Phase 1).
   */
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

  const canRetry = !isGenerating && messages.length > 0 && messages[messages.length - 1].role === 'user';

  return {
    // data
    conversations, conversationsStatus,
    activeConversation, messages, messagesStatus,
    availableModels, selectedModel, setSelectedModel,
    // generation state
    isGenerating, streamingContent, streamingModel, error, clearError, canRetry,
    // actions
    loadConversations, selectConversation, startNewChat,
    renameConversation, pinConversation, archiveConversation, deleteConversation,
    sendMessage, regenerate, retry, editMessage, stopGeneration,
  };
}

export type ChatController = ReturnType<typeof useChat>;
