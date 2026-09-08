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

/**
 * The one ordering used everywhere: pinned first, then most recently updated.
 * It is exactly what `conversationsApi.list` returns, so the sidebar looks the
 * same after an optimistic change as it does after a reload.
 */
export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
}

/**
 * Which chat to show once `removedId` leaves the list (deleted or archived):
 * the one after it in sidebar order, else the one before it, else the top of
 * the list. Stays within the same section (archived chats never surface when
 * an active, unarchived chat goes away). `null` means "show a blank new chat".
 */
export function fallbackAfterRemoval(list: Conversation[], removedId: string): Conversation | null {
  const removed = list.find(c => c.id === removedId);
  if (!removed) return null;
  const section = sortConversations(list).filter(c => Boolean(c.archived) === Boolean(removed.archived));
  const idx = section.findIndex(c => c.id === removedId);
  const neighbour = idx === -1 ? null : section[idx + 1] ?? section[idx - 1] ?? null;
  return neighbour ?? sortConversations(list).find(c => !c.archived && c.id !== removedId) ?? null;
}

/** Result of the Phase 2 knowledge lookup that runs before each generation. */
export interface ResolvedContext {
  context?: ChatContext;
  sources?: KnowledgeSource[];
}

/**
 * Phase 2 hook-in: given the conversation, the user's latest message and any
 * attachments, return the context to send (project instructions, memories,
 * relevant file excerpts). Optional — without it Phase 1 behaviour is unchanged.
 */
export type ContextResolver = (input: { conversation: Conversation; query: string; attachments?: Attachment[] }) => Promise<ResolvedContext>;

interface Options {
  settings: Pick<UserSettings, 'auto_title' | 'preferred_model'>;
  resolveContext?: ContextResolver;
  /** Called after a conversation is created so callers can attach files etc. */
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
  /** True when the last reply was cut short mid-stream but was kept on screen. */
  const [interrupted, setInterrupted] = useState(false);

  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  /** Explicit model id for the open chat, or null for Auto. */
  const [selectedModel, setSelectedModel] = useState<string | null>(settings.preferred_model);
  /**
   * Model picked while no conversation was open yet (blank new chat). Applied
   * when that chat is created, so the very first reply already uses it.
   */
  const pendingModelRef = useRef<string | null>(null);

  /** Project a *new* chat will be created in (set when the user opens a project). */
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Refs mirror state synchronously so async flows (send → stream → persist)
  // never read a stale value between a setState call and the next render.
  const messagesRef = useRef<Message[]>([]);
  const activeRef = useRef<Conversation | null>(null);
  const activeProjectRef = useRef<string | null>(null);
  // Latest callbacks without re-creating the generation pipeline on every render.
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
  // The global preference only steers chats without an explicit per-chat
  // choice (and blank chats where the user hasn't picked anything yet).
  const preferredModel = settings.preferred_model;
  useEffect(() => {
    if (activeRef.current?.model_id || pendingModelRef.current) return;
    setSelectedModel(preferredModel);
  }, [preferredModel]);

  // ── Loading ────────────────────────────────────────────────────────────────

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
      // The open chat must show the same title/flags as its sidebar row.
      // (A chat missing from the list is left alone: it may have been created
      // while this request was in flight.)
      const fresh = activeRef.current ? list.find(c => c.id === activeRef.current!.id) : undefined;
      if (fresh) setActiveSync(fresh);
      setConversationsStatus('ready');
    } catch (e) {
      setError(toFriendlyError(e));
      setConversationsStatus('error');
    }
  }, [user, setActiveSync]);

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
    setInterrupted(false);
    setActiveSync(conversation);
    setMessagesSync([]);
    // Restore this chat's own model choice; chats without one follow the
    // global preference. A blank chat always starts from the preference.
    pendingModelRef.current = null;
    setSelectedModel(conversation?.model_id ?? preferredModel);
    // Follow the opened chat's project so the next "New chat" lands beside it.
    if (conversation) setActiveProject(conversation.project_id ?? null);
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
  }, [stopGeneration, setActiveSync, setMessagesSync, setActiveProject, preferredModel]);

  /** Start a blank chat. Pass a project id to start it inside that project. */
  const startNewChat = useCallback((projectId?: string | null) => {
    stopGeneration();
    setError(null);
    setInterrupted(false);
    setActiveSync(null);
    setMessagesSync([]);
    setMessagesStatus('idle');
    // A blank chat starts from the global preference (Auto by default).
    pendingModelRef.current = null;
    setSelectedModel(preferredModel);
    if (projectId !== undefined) setActiveProject(projectId);
  }, [stopGeneration, setActiveSync, setMessagesSync, setActiveProject, preferredModel]);

  // ── Conversation mutations ─────────────────────────────────────────────────
  // Every mutation follows the same contract: apply optimistically to the list
  // *and* to the open chat (so the header, sidebar highlight and composer all
  // agree), persist, then reconcile with the row the database returned. The
  // list is re-sorted on each step so it never differs from what a reload shows.

  const patchLocal = useCallback((id: string, patch: Partial<Conversation>) => {
    setConversations(prev => sortConversations(prev.map(c => (c.id === id ? { ...c, ...patch } : c))));
    if (activeRef.current?.id === id) setActiveSync({ ...activeRef.current, ...patch });
  }, [setActiveSync]);

  /** The open chat is leaving the list: show its neighbour, or a blank chat if it was the last one. */
  const leaveActive = useCallback((id: string, list: Conversation[]) => {
    if (activeRef.current?.id !== id) return;
    const next = fallbackAfterRemoval(list, id);
    if (next) void selectConversation(next); else startNewChat();
  }, [selectConversation, startNewChat]);

  /** Drop a chat that turned out not to exist any more (deleted elsewhere, or never ours). */
  const evictLocal = useCallback((id: string, list: Conversation[]) => {
    leaveActive(id, list);
    setConversations(prev => prev.filter(c => c.id !== id));
  }, [leaveActive]);

  // Per-chat mutation counter: when two edits race (rename twice, pin/unpin),
  // only the latest one is allowed to write the server's answer back.
  const mutationSeq = useRef(new Map<string, number>());

  const mutateConversation = useCallback(async (id: string, patch: ConversationPatch) => {
    const seq = (mutationSeq.current.get(id) ?? 0) + 1;
    mutationSeq.current.set(id, seq);
    const before = conversations;
    // Optimistic: the database bumps updated_at on every change, so mirror that
    // and let the chat take the position it will have after a reload.
    patchLocal(id, { ...patch, updated_at: new Date().toISOString() });
    try {
      const stored = await conversationsApi.update(id, patch);
      // Reconcile only what this call changed (plus the trigger-set timestamp)
      // so an older response can never overwrite a newer edit to another field.
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
      // Set last: opening the fallback chat clears stale errors, and this one
      // must survive so the user learns the change did not apply.
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
    // Decide the fallback *before* the flag flips so the neighbour is picked
    // from the section the chat is leaving.
    if (archived) leaveActive(id, conversations);
    await mutateConversation(id, { archived });
  }, [conversations, leaveActive, mutateConversation]);

  /** Move a conversation into a project (or out of one with null). */
  const moveConversation = useCallback(async (id: string, projectId: string | null) => {
    await mutateConversation(id, { project_id: projectId });
  }, [mutateConversation]);

  /**
   * Pick the model for the open chat (null = Auto). The choice is persisted on
   * the conversation, so reopening the chat (here or on another device) shows
   * the same model. On a blank chat the choice is remembered and applied when
   * the chat is created. A failed write keeps the local choice — it is a
   * preference, not content, and must never block or alarm mid-chat.
   */
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
    setInterrupted(false);

    let content = '';
    let model: ModelInfo | null = null;
    let sources: KnowledgeSource[] | undefined;
    try {
      const wire = history.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }));
      // Phase 2: look up project instructions, memories and relevant file
      // excerpts. A failed lookup must never block the reply.
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
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError' || controller.signal.aborted;
      if (!aborted) {
        setError(toFriendlyError(e));
        // A stream that died mid-answer keeps whatever was generated (persisted
        // below) and stays retryable instead of losing the partial reply.
        if (content) setInterrupted(true);
      }
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
        sources: sources ?? null,
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

  // ── Public actions ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    const text = content.trim();
    if ((!text && !attachments?.length) || isGenerating || !user) return;
    setError(null);

    let conversation = activeRef.current;
    if (!conversation) {
      try {
        // The model picked before this chat existed becomes its saved choice.
        const modelId = pendingModelRef.current;
        conversation = await conversationsApi.create(user.id, settings.auto_title ? deriveTitle(text) : NEW_CHAT_TITLE, activeProjectRef.current, modelId);
        pendingModelRef.current = null;
      } catch (e) { setError(toFriendlyError(e)); return; }
      // Newest chat tops the "Recent" section — pinned chats stay above it, as after a reload.
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

  /**
   * Retry after an error: re-request a reply for the existing last user turn.
   * After an interrupted stream the partial assistant reply is dropped and the
   * turn is generated again (`regenerate`), so no duplicate rows are created.
   */
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

  const last = messages[messages.length - 1];
  const canRetry = !isGenerating && Boolean(last) && (last.role === 'user' || (interrupted && last.role === 'assistant'));

  return {
    // data
    conversations, conversationsStatus,
    activeConversation, messages, messagesStatus,
    availableModels, selectedModel, selectModel,
    // Phase 2: project scope for new chats
    activeProjectId, setActiveProject, moveConversation,
    // generation state
    isGenerating, streamingContent, streamingModel, error, clearError, canRetry, interrupted,
    // actions
    loadConversations, selectConversation, startNewChat,
    renameConversation, pinConversation, archiveConversation, deleteConversation,
    sendMessage, regenerate, retry, editMessage, stopGeneration,
  };
}

export type ChatController = ReturnType<typeof useChat>;
